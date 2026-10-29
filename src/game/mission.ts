/**
 * The mission: Kuching → Singapore with fresh cargo. A renderer-independent state machine that
 * owns the aircraft, weather, route tracking, markers, prompts and scoring. The 3D world, HUD,
 * audio and phone link all read from it.
 */
import { Aircraft, ias, type FlightContext, type FlightInput } from './flight';
import { CHANGI_RWY, DEG, KCH, Route, headingFromDir, lineupPoint, type P3, type Track } from './route';
import { WeatherSystem, type Alert, type Weather } from './hazards';
import { Scorer, type Grade, type Summary } from './scoring';
import { CHANGI_LAYOUT, changiFrame, kchFrame, kchTaxiPath, type Frame } from './layout';
import type { FlapSetting, Phase, Want } from '../net/protocol';

export type MissionEvent =
  | { type: 'phase'; phase: Phase }
  | { type: 'callout'; text: string; speak?: string }
  | { type: 'atc'; text: string }
  | { type: 'marker'; index: number; grade: Grade; points: number }
  | { type: 'liftoff' }
  | { type: 'tailstrike' }
  | { type: 'touchdown'; fpm: number; grade: string }
  | { type: 'crash'; reason: string }
  | { type: 'lightning' }
  | { type: 'config' }
  | { type: 'gear'; down: boolean }
  | { type: 'flaps'; setting: FlapSetting }
  | { type: 'bonus'; label: string; points: number }
  | { type: 'alert'; alert: Alert }
  | { type: 'haptic'; pattern: number | number[] };

export interface Marker {
  s: number;
  x: number;
  y: number;
  z: number;
  grade: Grade | null;
}

export const MARKER_SPACING = 24;
const INTRO_SHOTS = [
  { dur: 3.6, p0: 0.0, p1: 0.07 },
  { dur: 3.4, p0: 0.3, p1: 0.52 },
  { dur: 3.2, p0: 0.8, p1: 1.0 },
];
const TAXI_IN_TIME = 8;

interface PathSample {
  x: number;
  z: number;
  heading: number;
}

/** Sample a smooth path through 2D points (Catmull-Rom), evenly spaced by arc length. */
function smoothPath(pts: { x: number; z: number }[], spacing = 4): PathSample[] {
  const dense: { x: number; z: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < 24; k++) {
      const t = k / 24;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  dense.push(pts[pts.length - 1]);
  const out: PathSample[] = [];
  let carry = 0;
  for (let i = 0; i < dense.length - 1; i++) {
    const a = dense[i];
    const b = dense[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const heading = headingFromDir(b.x - a.x, b.z - a.z);
    let d = carry;
    while (d < len) {
      const t = d / len;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading });
      d += spacing;
    }
    carry = d - len;
  }
  const last = dense[dense.length - 1];
  out.push({ x: last.x, z: last.z, heading: out[out.length - 1]?.heading ?? 0 });
  return out;
}

function samplePath(path: PathSample[], p: number): PathSample {
  const f = Math.max(0, Math.min(1, p)) * (path.length - 1);
  const i = Math.floor(f);
  const j = Math.min(i + 1, path.length - 1);
  const t = f - i;
  const dh = ((path[j].heading - path[i].heading + 540) % 360) - 180;
  return { x: path[i].x + (path[j].x - path[i].x) * t, z: path[i].z + (path[j].z - path[i].z) * t, heading: path[i].heading + dh * t };
}

const CALM: Weather = {
  wind: { x: 0, y: 0, z: 0 },
  rollDisturb: 0,
  pitchDisturb: 0,
  turb: 0,
  rain: 0,
  cloud: 0,
  windFrom: 240,
  windKt: 8,
  gustKt: 0,
  lightning: false,
};

export class Mission {
  readonly route = new Route();
  readonly ac = new Aircraft();
  readonly markers: Marker[] = [];
  readonly changi: Frame;
  weather: WeatherSystem;
  wx: Weather = CALM;
  scorer: Scorer;
  track: Track = { s: 0, lateral: 0, vertical: 0, dist: 0, index: 0 };
  phase: Phase = 'pairing';
  phaseTime = 0;
  time = 0;
  prompt = '';
  want: Want = 'none';
  alert: Alert | undefined;
  stage = 'GROUND';
  shot = 0;
  shotTime = 0;
  summary: Summary | null = null;
  crashReason = '';
  events: MissionEvent[] = [];
  /** Height of the ground (or sea) at x, z. Provided by the world; flat by default. */
  ground: (x: number, z: number) => number = () => 0;

  nextMarker = 0;
  private said = new Set<string>();
  private introPath: PathSample[];
  private taxiInPath: PathSample[] = [];
  private offCourseTime = 0;
  private throttleHighTime = 0;
  private lastAlertId = '';
  private gearUpAt = -1;
  private seed: number;

  constructor(seed = (Math.random() * 2 ** 31) | 0) {
    this.seed = seed;
    this.weather = new WeatherSystem(this.route, seed);
    this.changi = changiFrame(this.route);
    const st = this.route.stations;
    for (let s = st['climb'] + 150; s < st['final:end'] - 40; s += MARKER_SPACING) {
      const p = this.route.at(s);
      this.markers.push({ s, x: p.x, y: p.y, z: p.z, grade: null });
    }
    this.scorer = new Scorer(this.markers.length);
    this.introPath = smoothPath(kchTaxiPath().map((p) => kchFrame.toWorld(p.u, p.v)));
    this.parkAtStand();
  }

  // ------------------------------------------------------------------------------- controls

  /** Start (from pairing) or restart (from results). */
  start(): void {
    this.reset();
    this.setPhase('intro');
  }

  /** The phone's contextual action button / space bar. */
  action(): void {
    if (this.phase === 'intro') this.enterLineup();
    else if (this.phase === 'results' || this.phase === 'crashed' || this.phase === 'pairing') this.start();
  }

  flapsPress(): void {
    if (!['lineup', 'takeoff', 'flight', 'flare'].includes(this.phase)) return;
    const next: FlapSetting = this.ac.flaps === 0 ? 15 : this.ac.flaps === 15 ? 30 : 0;
    this.setFlaps(next);
  }

  private setFlaps(f: FlapSetting): void {
    this.ac.flaps = f;
    this.emit({ type: 'flaps', setting: f });
  }

  // ------------------------------------------------------------------------------- update

  update(dt: number, input: FlightInput): void {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.phaseTime += dt;
    switch (this.phase) {
      case 'pairing':
        this.ac.prop = 0.25;
        break;
      case 'intro':
        this.updateIntro();
        break;
      case 'lineup':
        this.updateLineup(input);
        break;
      case 'takeoff':
        this.updateTakeoff(dt, input);
        break;
      case 'flight':
      case 'flare':
        this.updateFlight(dt, input);
        break;
      case 'rollout':
        this.updateRollout(dt, input);
        break;
      case 'taxiIn':
        this.updateTaxiIn();
        break;
      case 'results':
      case 'crashed':
        this.ac.prop = Math.max(0, this.ac.prop - dt * 0.3);
        break;
    }
  }

  private updateIntro(): void {
    let t = this.phaseTime;
    let shot = 0;
    while (shot < INTRO_SHOTS.length - 1 && t > INTRO_SHOTS[shot].dur) {
      t -= INTRO_SHOTS[shot].dur;
      shot++;
    }
    const s = INTRO_SHOTS[shot];
    if (shot !== this.shot) this.shot = shot;
    this.shotTime = t;
    const k = Math.min(1, t / s.dur);
    const ease = k * k * (3 - 2 * k);
    const p = samplePath(this.introPath, s.p0 + (s.p1 - s.p0) * (shot === 0 ? k * k : ease));
    this.ac.pos = { x: p.x, y: 0, z: p.z };
    this.ac.heading = p.heading;
    this.ac.speed = 7;
    this.ac.thrust = 0.15;
    this.ac.prop = 0.45;
    this.prompt = shot === 0 ? 'Kuching International · stand 4' : shot === 1 ? 'Taxi to runway 25' : 'Lining up runway 25';
    this.want = 'action';
    if (shot === 1 && !this.said.has('atc-taxi')) {
      this.say('atc-taxi', { type: 'atc', text: 'AirBorneo 101, taxi to holding point runway 25 via Alpha.' });
    }
    if (this.phaseTime > INTRO_SHOTS.reduce((a, b) => a + b.dur, 0)) this.enterLineup();
  }

  private enterLineup(): void {
    const lu = lineupPoint();
    this.ac.reset(lu.pos, lu.heading);
    this.ac.prop = 0.4;
    this.track = this.route.track(this.ac.pos);
    this.setPhase('lineup');
    this.say('atc-lineup', { type: 'atc', text: 'AirBorneo 101, wind 240 degrees 8 knots, runway 25, cleared for take-off.' });
  }

  private updateLineup(input: FlightInput): void {
    this.stage = 'RWY 25';
    if (this.ac.flaps !== 15) {
      this.want = 'flaps';
      this.prompt = this.ac.flaps === 0 ? 'Set FLAPS 15 for take-off' : 'Take-off flaps are 15°. Tap FLAPS';
      if (input.throttle > 0.5 && !this.said.has('config')) {
        this.said.add('config');
        this.emit({ type: 'config' });
        this.emit({ type: 'callout', text: 'CONFIG: FLAPS', speak: 'Config. Flaps.' });
      }
      return;
    }
    this.want = 'throttle-up';
    this.prompt = 'Push the throttle to TO';
    if (input.throttle > 0.85) {
      this.setPhase('takeoff');
      this.emit({ type: 'callout', text: 'Power set', speak: 'Power set' });
    }
  }

  private updateTakeoff(dt: number, input: FlightInput): void {
    this.stage = 'TAKE-OFF';
    const ac = this.ac;
    const ctx: FlightContext = { targetSpeed: 0, trimGamma: 0, groundY: 0, landing: false };
    const events = ac.step(dt, input, CALM, ctx);
    this.track = this.route.track(ac.pos, this.track.index);
    const kt = ias(ac.speed);
    if (kt >= 80) this.say('80', { type: 'callout', text: '80 knots', speak: 'Eighty knots' });
    if (kt >= 105) this.say('v1', { type: 'callout', text: 'V1', speak: 'V one' });
    if (kt >= 110) this.say('vr', { type: 'callout', text: 'ROTATE', speak: 'Rotate' });
    if (kt >= 110) {
      this.want = 'pitch-up';
      this.prompt = 'ROTATE · tilt back gently';
    } else {
      this.want = input.throttle < 0.85 ? 'throttle-up' : 'none';
      this.prompt = input.throttle < 0.85 ? 'Keep the throttle at TO' : 'Accelerating… wait for ROTATE';
    }
    for (const e of events) {
      if (e === 'tailstrike') {
        this.scorer.bonus('Tail strike', `${ac.pitch.toFixed(1)}° pitch`, -400);
        this.scorer.freshness -= 6;
        this.emit({ type: 'tailstrike' });
        this.emit({ type: 'callout', text: 'TAIL STRIKE', speak: 'Tail strike' });
        this.emit({ type: 'haptic', pattern: [80, 40, 80] });
      }
      if (e === 'liftoff') {
        const late = ac.autoRotate;
        if (!ac.tailStruck) this.scorer.bonus('Rotation', late ? 'Late' : `Smooth · ${Math.round(kt)} kt`, late ? -150 : 300);
        this.emit({ type: 'liftoff' });
        this.gearUpAt = this.time + 1.6;
        this.setPhase('flight');
      }
    }
  }

  private stageTargets(s: number): { speed: number; stage: string } {
    const st = this.route.stations;
    if (s < st['climb:end']) return { speed: 115, stage: 'CLIMB' };
    if (s < st['turnout:end']) return { speed: 150, stage: 'CLIMB' };
    if (s < st['squall']) return { speed: 210, stage: 'CRUISE · FL170' };
    if (s < st['base']) return { speed: 150, stage: 'DESCENT' };
    if (s < st['final']) return { speed: 100, stage: 'APPROACH' };
    return { speed: 85, stage: 'FINAL · RWY 20C' };
  }

  private updateFlight(dt: number, input: FlightInput): void {
    const ac = this.ac;
    const st = this.route.stations;
    const prevS = this.track.s;
    const landing = this.track.s > st['final'] - 100;
    const runway = landing ? this.changiRunway() : undefined;
    const groundY = landing && this.onChangiRunwayArea(ac.pos) ? 0 : this.ground(ac.pos.x, ac.pos.z);
    this.wx = this.weather.sample(this.track.s, ac.pos, this.time);
    const { speed, stage } = this.stageTargets(this.track.s);
    this.stage = stage;
    const ahead = this.route.at(this.track.s + 40);
    let trimGamma = Math.atan(ahead.slope) / DEG;
    // Initial climb: hold a positive climb away from the runway whatever the route says.
    if (this.track.s < st['climb:end'] && ac.pos.y < 40) trimGamma = Math.max(trimGamma, 5);
    const ctx: FlightContext = {
      targetSpeed: speed,
      trimGamma,
      groundY,
      landing,
      runway,
    };
    const events = ac.step(dt, input, this.wx, ctx);
    this.track = this.route.track(ac.pos, this.track.index);
    this.scorer.handling(dt, this.wx.turb, ac.bank);
    if (this.wx.lightning) this.emit({ type: 'lightning' });

    // Markers crossed this frame.
    while (this.nextMarker < this.markers.length && this.markers[this.nextMarker].s <= this.track.s) {
      const m = this.markers[this.nextMarker];
      if (m.s >= prevS - MARKER_SPACING * 2) {
        const { grade, points } = this.scorer.marker(this.track.dist);
        m.grade = grade;
        this.emit({ type: 'marker', index: this.nextMarker, grade, points });
      } else {
        m.grade = 'MISS';
        this.scorer.marker(999);
      }
      this.nextMarker++;
    }

    // Crew actions and callouts along the way.
    if (this.gearUpAt > 0 && this.time >= this.gearUpAt) {
      this.gearUpAt = -1;
      ac.gearDown = false;
      this.emit({ type: 'callout', text: 'Positive rate · gear up', speak: 'Positive rate. Gear up.' });
      this.emit({ type: 'gear', down: false });
    }
    const s = this.track.s;
    if (s > st['turnout'] && ac.flaps !== 0 && !this.said.has('flaps-up')) {
      this.said.add('flaps-up');
      this.setFlaps(0);
      this.emit({ type: 'callout', text: 'Flaps up', speak: 'Flaps up' });
    }
    if (s > st['rainforest']) this.say('atc-cruise', { type: 'atc', text: 'AirBorneo 101, Kuching Control, climb FL170, direct Singapore.' });
    if (s > st['base']) this.say('atc-app', { type: 'atc', text: 'AirBorneo 101, Singapore Approach, cleared ILS runway 20C.' });
    if (s > st['base'] + 500 && !ac.gearDown) {
      ac.gearDown = true;
      this.emit({ type: 'callout', text: 'Gear down', speak: 'Gear down' });
      this.emit({ type: 'gear', down: true });
    }
    if (s > st['final']) this.say('atc-land', { type: 'atc', text: 'AirBorneo 101, wind 220 degrees 12 knots, runway 20C, cleared to land.' });
    if (ac.flaps === 30 && s > st['base'] && !this.said.has('config-bonus')) {
      this.said.add('config-bonus');
      const onTime = s < st['final'] + 300;
      if (onTime) this.scorer.bonus('Landing config', 'Flaps 30 on time', 200);
      this.emit({ type: 'bonus', label: onTime ? 'Landing config' : 'Flaps 30', points: onTime ? 200 : 0 });
    }
    if (s > st['final'] + 700 && ac.flaps !== 30) {
      this.setFlaps(30);
      this.emit({ type: 'callout', text: 'Flaps 30', speak: 'Flaps thirty' });
    }

    const agl = ac.pos.y - groundY;
    const aglFt = agl * 3.281;
    if (landing) {
      for (const [ft, text] of [
        [200, 'Minimums'],
        [100, 'One hundred'],
        [50, 'Fifty'],
        [40, 'Forty'],
        [30, 'Thirty'],
        [20, 'Twenty'],
        [10, 'Ten'],
      ] as const) {
        if (aglFt <= ft && aglFt > ft - 60) this.say(`ra${ft}`, { type: 'callout', text: text.toUpperCase(), speak: text });
      }
    }

    // Prompts.
    let prompt = 'Follow the dotted line';
    let want: Want = 'steer';
    if (s > st['base'] && ac.flaps !== 30 && s < st['final'] + 700) {
      prompt = 'Approach: set FLAPS 30';
      want = 'flaps';
    } else if (s > st['final']) prompt = 'Follow the glide path · 3°';
    if (landing && agl < 12) {
      prompt = 'FLARE · tilt back gently';
      want = 'pitch-up';
      if (this.phase !== 'flare') this.setPhase('flare');
    }

    // Warnings override weather alerts.
    let alert = this.wx.alert;
    if (!landing && agl < 70 && ac.vs < -2 && s > st['climb:end']) alert = { id: 'terrain', text: 'TERRAIN · PULL UP', level: 'warning' };
    if (this.track.dist > 220) {
      this.offCourseTime += dt;
      alert = { id: 'offcourse', text: 'OFF COURSE · return to the dotted line', level: 'warning' };
      prompt = 'Steer back to the dotted line';
    } else this.offCourseTime = 0;
    if (ac.stallWarning) alert = { id: 'stall', text: 'STALL', level: 'warning' };
    this.setAlert(alert);
    this.prompt = prompt;
    this.want = want;

    for (const e of events) {
      if (e === 'crash') return this.crash(groundY <= -0.5 ? 'Ditched in the sea' : 'Flew into terrain');
      if (e === 'touchdown') return this.onTouchdown();
    }
    if (this.offCourseTime > 9) return this.crash('Strayed too far from the route');
    if (this.track.s > st['final:end'] + 1000 && !ac.onGround) return this.crash('Floated past the runway');
  }

  private onTouchdown(): void {
    const ac = this.ac;
    const local = this.changi.toLocal(ac.pos.x, ac.pos.z);
    const grade = this.scorer.touchdown({ fpm: ac.touchdownFpm, centreline: local.v, fromAim: local.u - 300 });
    this.emit({ type: 'touchdown', fpm: ac.touchdownFpm, grade });
    this.emit({ type: 'haptic', pattern: grade === 'Hard' ? [120, 40, 120] : 60 });
    this.emit({ type: 'callout', text: `${grade.toUpperCase()} · ${Math.round(ac.touchdownFpm)} fpm`, speak: grade === 'Butter' ? 'Butter!' : grade });
    this.setAlert(undefined);
    this.setPhase('rollout');
  }

  private updateRollout(dt: number, input: FlightInput): void {
    const ac = this.ac;
    this.stage = 'ROLLOUT';
    const idle = input.throttle < 0.2;
    this.throttleHighTime = idle ? 0 : this.throttleHighTime + dt;
    const throttle = idle || this.throttleHighTime > 3 ? 0 : input.throttle;
    ac.step(dt, { roll: 0, pitch: 0, throttle }, CALM, { targetSpeed: 0, trimGamma: 0, groundY: 0, landing: true, runway: this.changiRunway() });
    this.prompt = idle ? 'Braking · welcome to Singapore' : 'Throttle to IDLE';
    this.want = idle ? 'none' : 'throttle-idle';
    if (ac.speed < 18) {
      this.say('atc-ground', { type: 'atc', text: 'AirBorneo 101, welcome to Singapore. Taxi to the Changi Airfreight Centre.' });
      this.enterTaxiIn();
    }
  }

  private enterTaxiIn(): void {
    const L = CHANGI_LAYOUT;
    const here = this.changi.toLocal(this.ac.pos.x, this.ac.pos.z);
    const pts = [
      { u: here.u, v: here.v },
      { u: here.u + 90, v: 70 },
      { u: here.u + 130, v: L.taxiwayV },
      { u: L.cargoStand.u + (here.u + 130 > L.cargoStand.u ? 160 : -160), v: L.taxiwayV },
      { u: L.cargoStand.u, v: L.cargoStand.v - 60 },
      { u: L.cargoStand.u, v: L.cargoStand.v },
    ];
    this.taxiInPath = smoothPath(pts.map((p) => this.changi.toWorld(p.u, p.v)));
    this.setPhase('taxiIn');
  }

  private updateTaxiIn(): void {
    const k = Math.min(1, this.phaseTime / TAXI_IN_TIME);
    const ease = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    const p = samplePath(this.taxiInPath, ease);
    this.ac.pos = { x: p.x, y: 0, z: p.z };
    this.ac.heading = p.heading;
    this.ac.speed = k < 1 ? 8 : 0;
    this.ac.thrust = k < 1 ? 0.12 : 0;
    this.ac.pitch = 0;
    this.ac.bank = 0;
    this.shot = k < 0.5 ? 0 : 1;
    this.prompt = 'Taxiing to the cargo stand';
    this.want = 'none';
    this.stage = 'TAXI';
    if (k >= 1) this.finish();
  }

  private finish(): void {
    this.summary = this.scorer.summary();
    this.prompt = `${'★'.repeat(this.summary.stars)}${'☆'.repeat(5 - this.summary.stars)} ${this.summary.rank}`;
    this.want = 'action';
    this.setPhase('results');
  }

  private crash(reason: string): void {
    this.crashReason = reason;
    this.scorer.crashed = true;
    this.summary = this.scorer.summary();
    this.prompt = reason;
    this.want = 'action';
    this.setAlert(undefined);
    this.emit({ type: 'crash', reason });
    this.emit({ type: 'haptic', pattern: [200, 80, 200] });
    this.setPhase('crashed');
  }

  // ------------------------------------------------------------------------------- helpers

  private changiRunway(): { x: number; z: number; heading: number } {
    return { x: this.route.changiThreshold.x, z: this.route.changiThreshold.z, heading: CHANGI_RWY.heading };
  }

  private onChangiRunwayArea(p: P3): boolean {
    const l = this.changi.toLocal(p.x, p.z);
    return l.u > -900 && l.u < CHANGI_RWY.length + 300 && Math.abs(l.v) < 150;
  }

  private parkAtStand(): void {
    const p = samplePath(this.introPath, 0);
    this.ac.reset({ x: p.x, y: 0, z: p.z }, p.heading);
  }

  private reset(): void {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    this.weather = new WeatherSystem(this.route, this.seed);
    this.wx = CALM;
    this.scorer = new Scorer(this.markers.length);
    for (const m of this.markers) m.grade = null;
    this.nextMarker = 0;
    this.said.clear();
    this.offCourseTime = 0;
    this.throttleHighTime = 0;
    this.gearUpAt = -1;
    this.summary = null;
    this.crashReason = '';
    this.alert = undefined;
    this.lastAlertId = '';
    this.shot = 0;
    this.parkAtStand();
    this.track = this.route.track(this.ac.pos);
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.phaseTime = 0;
    this.shot = 0;
    this.emit({ type: 'phase', phase });
  }

  private setAlert(alert: Alert | undefined): void {
    this.alert = alert;
    const id = alert?.id ?? '';
    if (id && id !== this.lastAlertId) {
      this.emit({ type: 'alert', alert: alert! });
      if (alert!.level === 'warning') this.emit({ type: 'haptic', pattern: [60, 60, 60] });
    }
    this.lastAlertId = id;
  }

  private say(key: string, e: MissionEvent): void {
    if (this.said.has(key)) return;
    this.said.add(key);
    this.emit(e);
  }

  private emit(e: MissionEvent): void {
    this.events.push(e);
  }

  /** Drain queued events (the renderer, HUD and audio consume them once per frame). */
  drain(): MissionEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Distance flown as a fraction of the route, for the progress bar. */
  get progress(): number {
    const st = this.route.stations;
    if (this.phase === 'results' || this.phase === 'taxiIn' || this.phase === 'rollout') return 1;
    if (this.phase === 'pairing' || this.phase === 'intro' || this.phase === 'lineup') return 0;
    return Math.max(0, Math.min(1, (this.track.s - st['climb']) / (st['final:end'] - st['climb'])));
  }

  get isKch(): boolean {
    return ['pairing', 'intro', 'lineup'].includes(this.phase);
  }

  /** Expose KCH constants for the world (keeps imports in one place). */
  static readonly kch = KCH;
}
