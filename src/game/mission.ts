/**
 * The mission: fly AB 101 and its 162 passengers home from Kuala Lumpur to Kuching, smoothly.
 * A renderer-independent state machine that owns the aircraft, weather, route tracking, markers,
 * passenger comfort, prompts and scoring. The 3D world, HUD, audio and phone link all read from it.
 */
import { Aircraft, V1_KT, VR_KT, ias, type FlightContext, type FlightInput } from './flight';
import { DEG, KCH, KLIA, Route, designator, lineupPoint, type P3, type Track } from './route';
import { WeatherSystem, type Alert, type Weather } from './hazards';
import { Scorer, type Grade, type Summary } from './scoring';
import { kchLandingFrame, type Frame } from './layout';
import type { Reaction } from './comfort';
import { CABIN_STORIES, lineFor } from './stories';
import { line } from '../audio/lines';
import type { FlapSetting, Phase, Want } from '../net/protocol';

export type MissionEvent =
  | { type: 'phase'; phase: Phase }
  | { type: 'callout'; text: string; speak?: string }
  | { type: 'atc'; text: string }
  | { type: 'pa'; text: string }
  | { type: 'chime' }
  | { type: 'story'; text: string }
  | { type: 'reaction'; kind: Reaction; text: string }
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
  /** Kuching runway 25, origin at the threshold. */
  readonly kch: Frame;
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
  summary: Summary | null = null;
  crashReason = '';
  events: MissionEvent[] = [];
  /** Height of the ground (or sea) at x, z. Provided by the world; flat by default. */
  ground: (x: number, z: number) => number = () => 0;

  nextMarker = 0;
  private said = new Set<string>();
  private offCourseTime = 0;
  private throttleHighTime = 0;
  private lastAlertId = '';
  private gearUpAt = -1;
  /** The auto-trim's flight path, eased so route changes never jolt the cabin. */
  private trim = 5;
  private seed: number;

  constructor(seed = (Math.random() * 2 ** 31) | 0) {
    this.seed = seed;
    this.weather = new WeatherSystem(this.route, seed);
    this.kch = kchLandingFrame(this.route);
    const st = this.route.stations;
    for (let s = st['climb'] + 150; s < st['final:end'] - 40; s += MARKER_SPACING) {
      const p = this.route.at(s);
      this.markers.push({ s, x: p.x, y: p.y, z: p.z, grade: null });
    }
    this.scorer = new Scorer(this.markers.length);
    this.lineUp();
  }

  get comfort(): number {
    return this.scorer.comfort.value;
  }

  // ------------------------------------------------------------------------------- controls

  /** KLIA's departure runway, e.g. "32R". */
  static readonly depRunway = `${designator(KLIA.runwayHeading)}R`;

  /** Start (from pairing) or restart (from results): straight onto KLIA's runway. */
  start(): void {
    this.reset();
    this.setPhase('lineup');
    this.emit({ type: 'chime' });
    this.say('atc-lineup', { type: 'atc', text: `AirBorneo 101, wind 240 degrees 8 knots, runway ${Mission.depRunway}, cleared for take-off.` });
    this.say('pa-welcome', {
      type: 'pa',
      text: line('pa-welcome'),
    });
  }

  /** The phone's contextual action button / space bar. */
  action(): void {
    if (this.phase === 'results' || this.phase === 'crashed' || this.phase === 'pairing') this.start();
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
        this.ac.prop = 0.3;
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
      case 'results':
      case 'crashed':
        this.ac.prop = Math.max(0, this.ac.prop - dt * 0.3);
        break;
    }
  }

  private lineUp(): void {
    const lu = lineupPoint();
    this.ac.reset(lu.pos, lu.heading);
    this.ac.prop = 0.4;
    this.track = this.route.track(this.ac.pos);
  }

  private updateLineup(input: FlightInput): void {
    this.stage = `RWY ${Mission.depRunway}`;
    this.ac.prop = 0.4;
    this.want = this.ac.flaps === 15 ? 'throttle-up' : 'flaps';
    this.prompt = this.ac.flaps === 15 ? 'Push the throttle to TO' : 'Flaps 15, then throttle to TO';
    if (input.throttle > 0.85) {
      // Forgot the flaps? The first officer sets them; a soft chime, no hold-up.
      if (this.ac.flaps !== 15) {
        this.setFlaps(15);
        this.emit({ type: 'config' });
        this.emit({ type: 'callout', text: 'Flaps 15 set', speak: 'Flaps fifteen' });
      }
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
    if (kt >= 100) this.say('100kt', { type: 'callout', text: '100 knots', speak: 'One hundred knots' });
    if (kt >= V1_KT) this.say('v1', { type: 'callout', text: 'V1', speak: 'V one' });
    if (kt >= VR_KT) this.say('vr', { type: 'callout', text: 'ROTATE', speak: 'Rotate' });
    if (kt >= VR_KT) {
      this.want = 'pitch-up';
      this.prompt = 'ROTATE · nose up gently';
    } else {
      this.want = input.throttle < 0.85 ? 'throttle-up' : 'none';
      this.prompt = input.throttle < 0.85 ? 'Keep the throttle at TO' : 'Accelerating… wait for ROTATE';
    }
    for (const e of events) {
      if (e === 'tailstrike') {
        this.scorer.bonus('Tail strike', `${ac.pitch.toFixed(1)}° pitch`, -400);
        this.reactAll(this.scorer.comfort.jolt(10, 'scream'));
        this.emit({ type: 'tailstrike' });
        this.emit({ type: 'callout', text: 'TAIL STRIKE', speak: 'Tail strike' });
        this.emit({ type: 'haptic', pattern: [80, 40, 80] });
      }
      if (e === 'liftoff') {
        const late = ac.autoRotate;
        if (!ac.tailStruck) this.scorer.bonus('Rotation', late ? 'Late' : `Smooth · ${Math.round(kt)} kt`, late ? -150 : 300);
        this.emit({ type: 'liftoff' });
        this.gearUpAt = this.time + 1.6;
        this.trim = 5;
        this.setPhase('flight');
      }
    }
  }

  private stageTargets(s: number): { speed: number; stage: string } {
    const st = this.route.stations;
    if (s < st['climb:end']) return { speed: 115, stage: 'CLIMB' };
    if (s < st['kl']) return { speed: 140, stage: 'CLIMB' };
    if (s < st['hills']) return { speed: 140, stage: 'KUALA LUMPUR' };
    if (s < st['coast']) return { speed: 160, stage: 'TITIWANGSA' };
    if (s < st['squall']) return { speed: 210, stage: 'CRUISE · FL170' };
    if (s < st['sarawak']) return { speed: 150, stage: 'DESCENT' };
    if (s < st['river']) return { speed: 140, stage: 'SARAWAK COAST' };
    if (s < st['kuching']) return { speed: 130, stage: 'SARAWAK RIVER' };
    if (s < st['base']) return { speed: 120, stage: 'OVER KUCHING' };
    if (s < st['final']) return { speed: 105, stage: 'APPROACH' };
    return { speed: 85, stage: 'FINAL · RWY 25' };
  }

  private updateFlight(dt: number, input: FlightInput): void {
    const ac = this.ac;
    const st = this.route.stations;
    const prevS = this.track.s;
    const landing = this.track.s > st['final'] - 100;
    const runway = landing ? this.kchRunway() : undefined;
    const groundY = landing && this.onKchRunwayArea(ac.pos) ? 0 : this.ground(ac.pos.x, ac.pos.z);
    this.wx = this.weather.sample(this.track.s, ac.pos, this.time);
    const { speed, stage } = this.stageTargets(this.track.s);
    this.stage = stage;
    const ahead = this.route.at(this.track.s + 40);
    let trimTarget = Math.atan(ahead.slope) / DEG;
    // Initial climb: hold a positive climb away from the runway whatever the route says.
    if (this.track.s < st['climb:end'] && ac.pos.y < 40) trimTarget = Math.max(trimTarget, 5);
    // On the glide path the trim follows exactly; elsewhere it eases at up to 1.5°/s.
    const maxStep = (this.track.s > st['final'] - 100 ? 20 : 1.5) * dt;
    this.trim += Math.max(-maxStep, Math.min(maxStep, trimTarget - this.trim));
    const trimGamma = this.trim;
    const ctx: FlightContext = { targetSpeed: speed, trimGamma, groundY, landing, runway };
    const events = ac.step(dt, input, this.wx, ctx);
    this.track = this.route.track(ac.pos, this.track.index);

    // What the cabin feels.
    const reactions = this.scorer.comfort.update(dt, {
      bank: ac.bank,
      pilotRollRate: ac.pilotRollRate,
      load: ac.load,
      turb: this.wx.turb,
      offLine: this.track.dist,
      airborne: !ac.onGround,
    });
    if (this.wx.lightning) {
      this.emit({ type: 'lightning' });
      this.scorer.comfort.flash(reactions);
    }
    this.reactAll(reactions);
    if (this.comfort < 60) {
      this.say('pa-bumps', {
        type: 'pa',
        text: line('pa-bumps'),
      });
    }

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

    // Crew actions, cabin chimes, stories and callouts along the way.
    if (this.gearUpAt > 0 && this.time >= this.gearUpAt) {
      this.gearUpAt = -1;
      ac.gearDown = false;
      this.emit({ type: 'callout', text: 'Positive rate · gear up', speak: 'Positive rate. Gear up.' });
      this.emit({ type: 'gear', down: false });
    }
    const s = this.track.s;
    for (const story of CABIN_STORIES) {
      if (s > st[story.at] + story.offset) this.say(`story-${story.at}`, { type: 'story', text: story.text });
    }
    if (s > st['kl'] && ac.flaps !== 0 && !this.said.has('flaps-up')) {
      this.said.add('flaps-up');
      this.setFlaps(0);
      this.emit({ type: 'callout', text: 'Flaps up', speak: 'Flaps up' });
    }
    if (s > st['kl'] + 200) this.say('atc-kl', { type: 'atc', text: 'AirBorneo 101, Lumpur Departure, Twin Towers off your left, climb on course.' });
    if (s > st['coast']) {
      this.say('atc-cruise', { type: 'atc', text: 'AirBorneo 101, Lumpur Control, climb FL170, direct Kuching.' });
      if (!this.said.has('chime-cruise')) {
        this.said.add('chime-cruise');
        this.emit({ type: 'chime' });
      }
    }
    if (s > st['sarawak']) {
      this.say('atc-kch', { type: 'atc', text: 'AirBorneo 101, Kuching Approach, descend 3000 feet, expect runway 25. Selamat pulang.' });
      this.say('pa-home', {
        type: 'pa',
        text: line('pa-home'),
      });
    }
    if (s > st['base']) {
      this.say('atc-app', { type: 'atc', text: 'AirBorneo 101, Kuching Approach, cleared ILS runway 25.' });
      this.say('pa-descent', { type: 'pa', text: line('pa-descent') });
      if (!this.said.has('chime-descent')) {
        this.said.add('chime-descent');
        this.emit({ type: 'chime' });
      }
    }
    if (s > st['base'] + 500 && !ac.gearDown) {
      ac.gearDown = true;
      this.emit({ type: 'callout', text: 'Gear down', speak: 'Gear down' });
      this.emit({ type: 'gear', down: true });
    }
    if (s > st['final']) this.say('atc-land', { type: 'atc', text: 'AirBorneo 101, wind 240 degrees 10 knots, runway 25, cleared to land.' });
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
        [30, 'Thirty'],
        [10, 'Ten'],
      ] as const) {
        if (aglFt <= ft && aglFt > ft - 60) this.say(`ra${ft}`, { type: 'callout', text: text.toUpperCase(), speak: text });
      }
    }

    // Prompts: comfort first.
    let prompt = 'Fly the dotted line · keep it smooth';
    let want: Want = 'steer';
    if (Math.abs(ac.bank) > 27) prompt = 'Gentle! Ease the bank for the passengers';
    else if (this.wx.turb > 0.5) prompt = 'Rough air · small, smooth inputs';
    if (s > st['base'] && ac.flaps !== 30 && s < st['final'] + 700) {
      prompt = 'Approach: set FLAPS 30';
      want = 'flaps';
    } else if (s > st['final']) prompt = 'Follow the glide path · 3°';
    if (landing && agl < 12) {
      prompt = 'FLARE · nose up gently';
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
    if (this.offCourseTime > 12) return this.crash('Strayed too far from the route');
    if (this.track.s > st['final:end'] + 1000 && !ac.onGround) return this.crash('Floated past the runway');
  }

  private onTouchdown(): void {
    const ac = this.ac;
    const local = this.kch.toLocal(ac.pos.x, ac.pos.z);
    const { grade, reactions } = this.scorer.touchdown({ fpm: ac.touchdownFpm, centreline: local.v, fromAim: local.u - 300 });
    this.emit({ type: 'touchdown', fpm: ac.touchdownFpm, grade });
    this.emit({ type: 'haptic', pattern: grade === 'Hard' ? [120, 40, 120] : 60 });
    this.emit({ type: 'callout', text: `${grade.toUpperCase()} · ${Math.round(ac.touchdownFpm)} fpm`, speak: grade === 'Butter' ? 'Butter!' : grade });
    this.reactAll(reactions);
    this.setAlert(undefined);
    this.setPhase('rollout');
  }

  private updateRollout(dt: number, input: FlightInput): void {
    const ac = this.ac;
    this.stage = 'ROLLOUT';
    const idle = input.throttle < 0.2;
    this.throttleHighTime = idle ? 0 : this.throttleHighTime + dt;
    const throttle = idle || this.throttleHighTime > 3 ? 0 : input.throttle;
    ac.step(dt, { roll: 0, pitch: 0, throttle }, CALM, { targetSpeed: 0, trimGamma: 0, groundY: 0, landing: true, runway: this.kchRunway() });
    this.prompt = idle ? 'Braking · welcome home to Kuching' : 'Throttle to IDLE';
    this.want = idle ? 'none' : 'throttle-idle';
    if (ac.speed < 18) {
      this.say('atc-ground', { type: 'atc', text: 'AirBorneo 101, welcome home. Thanks for bringing them back safely.' });
      this.say('pa-arrival', { type: 'pa', text: line('pa-arrival') });
      this.emit({ type: 'chime' });
      this.finish();
    }
  }

  private finish(): void {
    this.ac.speed = 0;
    this.ac.thrust = 0;
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

  private reactAll(reactions: Reaction[]): void {
    for (const kind of reactions) {
      this.emit({ type: 'reaction', kind, text: lineFor(kind) });
      if (kind === 'vomit' || kind === 'scream') this.emit({ type: 'haptic', pattern: [40, 30, 40] });
    }
  }

  private kchRunway(): { x: number; z: number; heading: number } {
    return { x: this.route.kchThreshold.x, z: this.route.kchThreshold.z, heading: KCH.runwayHeading };
  }

  private onKchRunwayArea(p: P3): boolean {
    const l = this.kch.toLocal(p.x, p.z);
    return l.u > -900 && l.u < KCH.runwayLength + 300 && Math.abs(l.v) < 150;
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
    this.lineUp();
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.phaseTime = 0;
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
    if (this.phase === 'results' || this.phase === 'rollout') return 1;
    if (this.phase === 'pairing' || this.phase === 'lineup') return 0;
    return Math.max(0, Math.min(1, (this.track.s - st['climb']) / (st['final:end'] - st['climb'])));
  }

}
