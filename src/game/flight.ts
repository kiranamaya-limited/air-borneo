/**
 * Arcade flight model for an ATR 72-500, tuned so tilt control feels like a yoke while the numbers
 * the player sees stay real: Vr 110 kt, take-off flaps 15, landing flaps 30, 3° glide path,
 * touchdown sink rate in feet per minute.
 *
 * The world is compressed (707 km becomes ~14 km), so turn rate and cruise speed are scaled up;
 * the instruments map simulated values back to realistic readings (see ias()/altitudeFt()).
 */
import { DEG, dirFromHeading, type P3 } from './route';
import type { FlapSetting } from '../net/protocol';

export const G = 9.81;
export const VR = 57; // m/s ≈ 110 kt
export const VLOF = VR + 3;
export const TURN_GAIN = 4; // compressed world: turns are 4x tighter than real for the same bank
export const MAX_BANK = 35;
/** Fastest roll the fly-by-wire law allows (deg/s). */
export const ROLL_RATE = 45;
/** Tilt changes the flight path by up to this many degrees either side of the trimmed path. */
export const PITCH_AUTHORITY = 9;
export const TAIL_STRIKE_PITCH = 9;
/**
 * Flare model: below `zone` metres the power is at idle and the aircraft cannot climb. Pulling back
 * cuts the sink rate; as speed bleeds off below `fadeSpeed` the lift fades and it settles anyway.
 */
export const FLARE = { zone: 9, base: 0.25, fadeSpeed: 72, fade: 0.2, decel: 2.5 }; // ATR 72 geometric limit is ~9-10° with struts compressed
const GEAR_HEIGHT = 2.45; // fuselage axis above the main wheels' contact point

export interface FlightInput {
  roll: number; // -1..1, + = right
  pitch: number; // -1..1, + = nose up
  throttle: number; // 0..1 (TO = 1)
}

export interface Atmosphere {
  wind: P3;
  /** Extra roll disturbance (deg), from turbulence. */
  rollDisturb: number;
  /** Extra pitch/flight-path disturbance (deg). */
  pitchDisturb: number;
}

export interface FlightContext {
  /** Autothrottle target airspeed in the air (m/s). */
  targetSpeed: number;
  /** Flight-path angle the auto-trim holds with neutral pitch input (deg). */
  trimGamma: number;
  groundY: number;
  /** Flare / landing logic is armed (near the destination runway). */
  landing: boolean;
  /** Runway centreline for the autoland lateral assist, when landing. */
  runway?: { x: number; z: number; heading: number };
}

export type FlightEvent = 'liftoff' | 'tailstrike' | 'touchdown' | 'crash' | 'stall';

export class Aircraft {
  pos: P3 = { x: 0, y: 0, z: 0 };
  heading = 0;
  bank = 0;
  pitch = 0;
  gamma = 0;
  speed = 0;
  vs = 0; // m/s, + up
  onGround = true;
  gear = 1; // 0 = up, 1 = down
  gearDown = true;
  flaps: FlapSetting = 0;
  flapAngle = 0;
  thrust = 0; // spooled throttle 0..1
  prop = 0; // prop rpm fraction for visuals/audio
  load = 1; // g
  touchdownFpm = 0;
  tailStruck = false;
  stallWarning = false;
  autoRotate = false;
  /** Smoothed commanded bank, before turbulence. */
  private bankCmd = 0;
  private rollRateCmd = 0;
  /** Rate of change of the actual bank angle (deg/s), turbulence included. */
  bankRate = 0;

  /** Roll rate the pilot is commanding (deg/s): yanking the yoke shows up here. */
  get pilotRollRate(): number {
    return this.rollRateCmd;
  }
  private flareTime = 0;
  private lastGamma = 0;
  private lastWindY = 0;

  reset(pos: P3, heading: number): void {
    this.pos = { ...pos };
    this.heading = heading;
    this.bank = this.bankCmd = 0;
    this.rollRateCmd = 0;
    this.bankRate = 0;
    this.pitch = this.gamma = this.lastGamma = 0;
    this.speed = this.vs = 0;
    this.onGround = true;
    this.gear = 1;
    this.gearDown = true;
    this.flaps = 0;
    this.flapAngle = 0;
    this.thrust = 0;
    this.prop = 0.2;
    this.load = 1;
    this.touchdownFpm = 0;
    this.tailStruck = false;
    this.stallWarning = false;
    this.autoRotate = false;
    this.flareTime = 0;
    this.lastWindY = 0;
  }

  get altitudeAgl(): number {
    return this.pos.y;
  }

  /** Fuselage axis height above the reference point, for placing the 3D model. */
  get modelLift(): number {
    return GEAR_HEIGHT;
  }

  step(dt: number, input: FlightInput, atmo: Atmosphere, ctx: FlightContext): FlightEvent[] {
    const events: FlightEvent[] = [];
    this.thrust += (input.throttle - this.thrust) * Math.min(1, dt * 1.6);
    this.gear += ((this.gearDown ? 1 : 0) - this.gear) * Math.min(1, dt * 0.6);
    this.flapAngle += (this.flaps - this.flapAngle) * Math.min(1, dt * 0.9);

    if (this.onGround) this.stepGround(dt, input, ctx, events);
    else this.stepAir(dt, input, atmo, ctx, events);

    const propTarget = this.onGround && this.speed < 1 && this.thrust < 0.05 ? 0.25 : 0.35 + this.thrust * 0.65;
    this.prop += (propTarget - this.prop) * Math.min(1, dt * 1.2);
    return events;
  }

  private stepGround(dt: number, input: FlightInput, ctx: FlightContext, events: FlightEvent[]): void {
    const drag = 0.25 + 0.00025 * this.speed * this.speed;
    const braking = ctx.landing ? (this.thrust < 0.15 ? 2.6 : 1.0) : 0;
    const accel = this.thrust * 6.0 - drag - braking;
    this.speed = Math.max(0, this.speed + accel * dt);

    if (!ctx.landing) {
      // Rotation: the elevator only bites near Vr.
      if (this.speed > VR * 0.92) {
        const want = Math.max(0, input.pitch);
        const rate = this.autoRotate ? 3.5 : want * 10;
        if (want > 0.05 || this.autoRotate) this.pitch = Math.min(14, this.pitch + rate * dt);
        else this.pitch = Math.max(0, this.pitch - 3 * dt);
      }
      if (this.speed > 75) this.autoRotate = true;
      if (this.pitch >= TAIL_STRIKE_PITCH && !this.tailStruck) {
        this.tailStruck = true;
        events.push('tailstrike');
      }
      if (this.speed >= VLOF && this.pitch >= 5) {
        this.onGround = false;
        this.gamma = Math.min(this.pitch - 3, 4);
        this.lastGamma = this.gamma;
        events.push('liftoff');
      }
    } else {
      // Landing roll: derotate, track the centreline.
      this.pitch = Math.max(0, this.pitch - 4 * dt);
      if (ctx.runway) {
        const dh = ((ctx.runway.heading - this.heading + 540) % 360) - 180;
        this.heading += dh * Math.min(1, dt * 1.5);
      }
    }
    this.bank += (0 - this.bank) * Math.min(1, dt * 4);
    if (this.onGround) {
      this.gamma = 0;
      this.vs = 0;
    }
    const d = dirFromHeading(this.heading);
    this.pos.x += d.x * this.speed * dt;
    this.pos.z += d.z * this.speed * dt;
    this.pos.y = ctx.groundY;
    this.load = 1;
  }

  private stepAir(dt: number, input: FlightInput, atmo: Atmosphere, ctx: FlightContext, events: FlightEvent[]): void {
    // Roll: tilt sets the bank angle, like a fly-by-wire roll-attitude law. Turbulence adds on top.
    const target = input.roll * MAX_BANK;
    const delta = target - this.bankCmd;
    const step = Math.sign(delta) * Math.min(Math.abs(delta) * 3.5 * dt, ROLL_RATE * dt);
    this.bankCmd += step;
    this.rollRateCmd = step / Math.max(dt, 1e-3);
    const prevBank = this.bank;
    this.bank = Math.max(-60, Math.min(60, this.bankCmd + atmo.rollDisturb));
    this.bankRate = (this.bank - prevBank) / Math.max(dt, 1e-3);

    const v = Math.max(this.speed, 40);
    this.heading = (this.heading + (TURN_GAIN * G * Math.tan(this.bank * DEG) * dt) / v / DEG + 360) % 360;

    // Pitch: auto-trim holds the route's climb/descent; tilt adds up to ±9°.
    const agl = this.pos.y - ctx.groundY;
    let gammaTarget = ctx.trimGamma + input.pitch * PITCH_AUTHORITY + atmo.pitchDisturb;
    if (ctx.landing && agl < FLARE.zone) {
      // Flare: idle power, ground effect. Pulling back cuts the sink rate but cannot stop it,
      // and the aircraft settles within a few seconds however long the flare is held.
      this.flareTime += dt;
      const fade = Math.max(0, FLARE.fadeSpeed - this.speed) * FLARE.fade + Math.max(0, this.flareTime - 3) * 0.35;
      gammaTarget = Math.min(gammaTarget, -FLARE.base - fade);
    } else this.flareTime = 0;
    this.stallWarning = gammaTarget > 12 && this.speed < 75;
    if (this.stallWarning) events.push('stall');
    gammaTarget = Math.max(-10, Math.min(14, gammaTarget));
    this.gamma += (gammaTarget - this.gamma) * Math.min(1, dt * (this.flareTime > 0 ? 3 : 2.2));

    const aoa = 2 + 6 * Math.max(0, Math.min(1, (110 - this.speed) / 55)) + this.flapAngle * -0.05;
    this.pitch = this.gamma + aoa;

    // Autothrottle (idle in the flare).
    const flaring = ctx.landing && agl < FLARE.zone;
    const spdTarget = flaring ? 0 : ctx.targetSpeed;
    const accel = spdTarget > this.speed ? 5 : flaring ? -FLARE.decel : -9;
    this.speed += Math.sign(spdTarget - this.speed) * Math.min(Math.abs(spdTarget - this.speed), Math.abs(accel) * dt);

    const d = dirFromHeading(this.heading);
    const horiz = this.speed * Math.cos(this.gamma * DEG);
    let vx = d.x * horiz + atmo.wind.x;
    let vz = d.z * horiz + atmo.wind.z;
    this.vs = this.speed * Math.sin(this.gamma * DEG) + atmo.wind.y;

    // Autoland lateral assist below 30 m: drift towards the centreline.
    if (ctx.landing && ctx.runway && this.pos.y - ctx.groundY < 30) {
      const rd = dirFromHeading(ctx.runway.heading);
      const rx = -rd.z;
      const rz = rd.x;
      const lateral = (this.pos.x - ctx.runway.x) * rx + (this.pos.z - ctx.runway.z) * rz;
      const pull = Math.max(-2.5, Math.min(2.5, -lateral * 0.5));
      vx += rx * pull;
      vz += rz * pull;
      const dh = ((ctx.runway.heading - this.heading + 540) % 360) - 180;
      this.heading += dh * Math.min(1, dt * 0.8);
    }

    this.pos.x += vx * dt;
    this.pos.z += vz * dt;
    this.pos.y += this.vs * dt;

    const gammaRate = ((this.gamma - this.lastGamma) * DEG) / Math.max(dt, 1e-3);
    this.lastGamma = this.gamma;
    // Vertical gusts are felt too: an updraft pushes you into the seat, a downdraft lifts you out.
    const gustAccel = Math.max(-6, Math.min(6, (atmo.wind.y - this.lastWindY) / Math.max(dt, 1e-3)));
    this.lastWindY = atmo.wind.y;
    this.load = 1 / Math.cos(this.bank * DEG) + (gammaRate * this.speed + gustAccel) / G;

    if (this.pos.y <= ctx.groundY) {
      if (ctx.landing && Math.abs(this.bank) < 20 && this.gear > 0.9) {
        this.touchdownFpm = Math.max(0, -this.vs * 196.85);
        this.pos.y = ctx.groundY;
        this.onGround = true;
        this.gamma = 0;
        events.push('touchdown');
      } else {
        this.pos.y = ctx.groundY;
        events.push('crash');
      }
    }
  }
}

// ------------------------------------------------------------------------- instrument mapping

function piecewise(x: number, pts: [number, number][]): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  const [xa, ya] = pts[pts.length - 2];
  const [xb, yb] = pts[pts.length - 1];
  return yb + ((x - xb) / (xb - xa)) * (yb - ya);
}

/** Indicated airspeed in knots, from simulated m/s. */
export function ias(speed: number): number {
  return piecewise(speed, [
    [0, 0],
    [VR, 110],
    [88, 120],
    [110, 170],
    [150, 210],
    [210, 275],
  ]);
}

/** Displayed altitude in feet, from simulated metres (real scale near the ground). */
export function altitudeFt(y: number): number {
  return piecewise(y, [
    [-10, -30],
    [0, 0],
    [60, 197],
    [140, 3000],
    [250, 12000],
    [300, 17000],
    [400, 19000],
  ]);
}

/** Displayed vertical speed in ft/min: real near the ground, scaled to airliner-like rates above. */
export function verticalSpeedFpm(vs: number, y: number): number {
  const fpm = vs * 196.85 * (y < 60 ? 1 : 0.55);
  return Math.round(Math.max(-3500, Math.min(3500, fpm)) / 10) * 10;
}
