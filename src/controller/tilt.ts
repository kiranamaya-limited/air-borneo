/**
 * Turns phone orientation into yoke inputs.
 *
 * Only the direction of "world up" in the phone's own frame is used. It comes from the fused
 * deviceorientation beta/gamma angles, which iOS and Android report the same way, and it does
 * not depend on which way round the phone is held in landscape.
 *
 * Relative to the pose captured at calibration:
 *  - roll  = how far the right edge of the screen has dropped (turning a steering wheel right),
 *  - pitch = how far the top edge has tipped towards the player (pulling a yoke back = nose up).
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Calibration {
  /** Screen "up" direction in device coordinates at calibration. */
  sUp: Vec3;
  /** Screen "right" direction in device coordinates. */
  sRight: Vec3;
  /** Elevation angle of world-up in the (sUp, normal) plane at calibration, radians. */
  pitch0: number;
}

const DEG = Math.PI / 180;

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const normalise = (a: Vec3): Vec3 => scale(a, 1 / (len(a) || 1));
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

const NORMAL: Vec3 = { x: 0, y: 0, z: 1 };

/** World-up expressed in device coordinates, from W3C deviceorientation beta/gamma (degrees). */
export function upFromBetaGamma(betaDeg: number, gammaDeg: number): Vec3 {
  const b = betaDeg * DEG;
  const g = gammaDeg * DEG;
  return { x: -Math.sin(g) * Math.cos(b), y: Math.sin(b), z: Math.cos(g) * Math.cos(b) };
}

/** Inverse of upFromBetaGamma, keeping gamma within the spec's [-90, 90) range. */
export function betaGammaFromUp(u: Vec3): { beta: number; gamma: number } {
  const n = normalise(u);
  let beta = Math.asin(Math.max(-1, Math.min(1, n.y))) / DEG;
  let gamma = Math.atan2(-n.x, n.z) / DEG;
  if (gamma >= 90 || gamma < -90) {
    gamma = gamma >= 90 ? gamma - 180 : gamma + 180;
    beta = beta >= 0 ? 180 - beta : -180 - beta;
  }
  return { beta, gamma };
}

/** Screen-up in device coordinates for a given screen.orientation.angle. */
export function screenUpFromAngle(angleDeg: number): Vec3 {
  const a = angleDeg * DEG;
  return { x: Math.sin(a), y: Math.cos(a), z: 0 };
}

/** Capture the player's neutral pose. Falls back to the screen angle if the phone is held flat. */
export function calibrate(upAtRest: Vec3, screenAngleDeg = 0): Calibration {
  const u = normalise(upAtRest);
  const inPlane = sub(u, scale(NORMAL, dot(u, NORMAL)));
  const sUp = len(inPlane) > 0.2 ? normalise(inPlane) : screenUpFromAngle(screenAngleDeg);
  const sRight = cross(sUp, NORMAL);
  return { sUp, sRight, pitch0: Math.atan2(dot(u, NORMAL), dot(u, sUp)) };
}

/** Roll and pitch in degrees relative to the calibrated pose. */
export function readTilt(cal: Calibration, upNow: Vec3): { roll: number; pitch: number } {
  const u = normalise(upNow);
  const a = dot(u, cal.sRight);
  const b = dot(u, cal.sUp);
  const c = dot(u, NORMAL);
  const roll = Math.atan2(-a, Math.hypot(b, c)) / DEG;
  let pitch = (Math.atan2(c, b) - cal.pitch0) / DEG;
  if (pitch > 180) pitch -= 360;
  if (pitch < -180) pitch += 360;
  return { roll, pitch };
}

/** Map an angle to -1..1 with a deadzone, saturation and a gentle expo curve for fine control. */
export function shapeAxis(angleDeg: number, deadzoneDeg: number, fullDeg: number, expo = 0.35): number {
  const mag = Math.abs(angleDeg);
  if (mag <= deadzoneDeg) return 0;
  const t = Math.min(1, (mag - deadzoneDeg) / (fullDeg - deadzoneDeg));
  const curved = (1 - expo) * t + expo * t * t * t;
  return Math.sign(angleDeg) * curved;
}

/**
 * Fallback for browsers without deviceorientation: raw accelerometer gravity. Some platforms
 * report it with the opposite sign, so it is flipped when it points away from screen-up.
 */
export function upFromGravity(acc: Vec3, screenAngleDeg = 0): Vec3 {
  const u = normalise(acc);
  return dot(u, screenUpFromAngle(screenAngleDeg)) < 0 ? scale(u, -1) : u;
}

/** Simple exponential smoothing for noisy sensor values. */
export class Smoother {
  private v: number | undefined;
  constructor(private readonly alpha: number) {}
  next(x: number): number {
    this.v = this.v === undefined ? x : this.v + (x - this.v) * this.alpha;
    return this.v;
  }
  reset(): void {
    this.v = undefined;
  }
}
