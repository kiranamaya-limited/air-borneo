/**
 * Weather along the route. Each hazard is real for the region:
 *  - gusty crosswind on the climb out of Kuching,
 *  - convective up/downdrafts over the afternoon rainforest,
 *  - a cumulonimbus cell over the South China Sea (the route bends round its core),
 *  - a "Sumatra" squall line near Singapore,
 *  - a microburst windshear on short final.
 */
import { dirFromHeading, type P3, type Route } from './route';
import type { Atmosphere } from './flight';

export type AlertLevel = 'info' | 'caution' | 'warning';

export interface Alert {
  id: string;
  text: string;
  level: AlertLevel;
}

export interface Weather extends Atmosphere {
  /** Turbulence intensity 0..1. */
  turb: number;
  /** Rain intensity 0..1. */
  rain: number;
  /** How deep inside cloud we are, 0..1 (thickens fog). */
  cloud: number;
  /** Wind for display: from-direction (deg) and speed (kt), and gust (kt). */
  windFrom: number;
  windKt: number;
  gustKt: number;
  alert?: Alert;
  lightning: boolean;
}

/** Deterministic PRNG so a seed reproduces a run (and tests are stable). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth band-limited noise: a sum of incommensurate sines with random phases. */
class Noise {
  private readonly f: number[];
  private readonly p: number[];
  constructor(rand: () => number, freqs: number[]) {
    this.f = freqs.map((f) => f * (0.8 + rand() * 0.4));
    this.p = freqs.map(() => rand() * Math.PI * 2);
  }
  at(t: number): number {
    let v = 0;
    for (let i = 0; i < this.f.length; i++) v += Math.sin(t * this.f[i] + this.p[i]);
    return v / Math.sqrt(this.f.length * 0.5);
  }
}

const ramp = (s: number, a: number, b: number, edge = 150) =>
  Math.max(0, Math.min(1, (s - a) / edge, (b - s) / edge));

const KT = 1.944;

export class WeatherSystem {
  readonly stormCore: P3;
  readonly stormRadius = 1500;
  private readonly rand: () => number;
  private readonly rollNoise: Noise;
  private readonly pitchNoise: Noise;
  private readonly gustNoise: Noise;
  private readonly thermalPhase: number;
  private nextLightning = 0;
  private readonly st: Record<string, number>;

  constructor(route: Route, seed: number) {
    this.rand = mulberry32(seed);
    this.rollNoise = new Noise(this.rand, [1.1, 1.9, 3.3, 5.1]);
    this.pitchNoise = new Noise(this.rand, [0.9, 2.3, 4.1]);
    this.gustNoise = new Noise(this.rand, [0.35, 0.8, 1.7]);
    this.thermalPhase = this.rand() * Math.PI * 2;
    this.st = route.stations;
    // The route bulges right round the storm, so its core sits to the left of the bulge.
    const mid = route.at((this.st['storm'] + this.st['storm:end']) / 2);
    const d = dirFromHeading(mid.heading);
    const left = { x: d.z, z: -d.x };
    const offset = 1050 + this.rand() * 150;
    this.stormCore = { x: mid.x + left.x * offset, y: 0, z: mid.z + left.z * offset };
  }

  sample(s: number, pos: P3, t: number): Weather {
    const st = this.st;
    let wx = 0;
    let wy = 0;
    let wz = 0;
    let turb = 0.05;
    let rain = 0;
    let cloud = 0;
    let lightning = false;
    let alert: Alert | undefined;

    // Base wind: 240° at 8 kt, a typical Kuching afternoon headwind for runway 25.
    let windFrom = 240;
    let windKt = 8;
    let gustKt = 0;
    const base = dirFromHeading(60);
    wx += base.x * 4;
    wz += base.z * 4;

    // 1. Gusty crosswind on the climb-out over Kuching.
    const xw = ramp(s, st['turnout'] + 600, st['city:end'] + 200, 300);
    if (xw > 0) {
      const gust = Math.max(0, this.gustNoise.at(t)) * 6;
      const to = dirFromHeading(130);
      const speed = (9 + gust * 0.8) * xw;
      wx += to.x * speed;
      wz += to.z * speed;
      turb = Math.max(turb, 0.3 * xw);
      windFrom = 310;
      windKt = Math.round(24 * xw + 8 * (1 - xw));
      gustKt = Math.round((24 + gust * KT) * xw);
      if (xw > 0.3) alert = { id: 'xwind', text: `CROSSWIND  310° / ${windKt} KT  G${gustKt}`, level: 'caution' };
    }

    // 2. Convective up/downdrafts over the river and rainforest.
    const th = ramp(s, st['river'] + 900, st['coast'] + 100, 250);
    if (th > 0) {
      wy += Math.sin(s / 260 + this.thermalPhase) * 3.2 * th;
      turb = Math.max(turb, 0.36 * th);
      if (!alert) alert = { id: 'thermals', text: 'CONVECTIVE UP & DOWNDRAFTS', level: 'caution' };
    }

    // 2b. Sea-breeze gusts along the Santubong coast, from the north-west.
    const sb = ramp(s, st['coast'] + 200, st['islands'] + 400, 250);
    if (sb > 0) {
      const gust = Math.max(0, this.gustNoise.at(t * 1.6)) * 7;
      const to = dirFromHeading(135);
      const speed = (8 + gust) * sb;
      wx += to.x * speed;
      wz += to.z * speed;
      turb = Math.max(turb, 0.38 * sb);
      windFrom = 315;
      windKt = Math.round(16 * sb + 8 * (1 - sb));
      gustKt = Math.round((16 + gust * KT) * sb);
      if (sb > 0.3) alert = { id: 'seabreeze', text: `SEA BREEZE GUSTS  315° / ${windKt} KT  G${gustKt}`, level: 'caution' };
    }

    // 3. Cumulonimbus: turbulence, inflow towards the core, rain, lightning.
    const toCore = { x: this.stormCore.x - pos.x, z: this.stormCore.z - pos.z };
    const coreDist = Math.hypot(toCore.x, toCore.z);
    const near = Math.max(0, 1 - coreDist / (this.stormRadius * 1.6));
    if (near > 0) {
      const inflow = 5 * near;
      wx += (toCore.x / coreDist) * inflow;
      wz += (toCore.z / coreDist) * inflow;
      wy += -3 * near + Math.sin(t * 0.7) * 2.5 * near;
      turb = Math.max(turb, 0.25 + 0.75 * near);
      rain = Math.max(rain, Math.min(1, near * 1.6));
      cloud = Math.max(cloud, Math.max(0, (near - 0.45) / 0.55));
      if (t > this.nextLightning && near > 0.25) {
        lightning = true;
        this.nextLightning = t + 1.2 + this.rand() * 3.5;
      }
      if (!alert || near > 0.3) alert = { id: 'storm', text: 'CB CELL: SEVERE TURBULENCE, STAY ON TRACK', level: near > 0.55 ? 'warning' : 'caution' };
    }

    // 4. Sumatra squall: strong south-westerly with heavy rain.
    const sq = ramp(s, st['squall'] - 100, st['base'] + 500, 220);
    if (sq > 0) {
      const gust = Math.max(0, this.gustNoise.at(t * 1.3)) * 7;
      const to = dirFromHeading(40);
      const speed = (9 + gust * 0.7) * sq;
      wx += to.x * speed;
      wz += to.z * speed;
      turb = Math.max(turb, 0.45 * sq);
      rain = Math.max(rain, 0.75 * sq);
      windFrom = 220;
      windKt = Math.round(26 * sq + 8 * (1 - sq));
      gustKt = Math.round((26 + gust * KT) * sq);
      if (sq > 0.3) alert = { id: 'squall', text: `SUMATRA SQUALL  220° / ${windKt} KT  G${gustKt}`, level: 'caution' };
    }

    // 5. Microburst on short final: brief updraft, then a strong sink.
    const fs = st['final'];
    const wsA = fs + 450;
    const wsB = fs + 950;
    if (s > wsA - 350 && s < wsA) alert = { id: 'ws-ahead', text: 'WINDSHEAR AHEAD', level: 'caution' };
    if (s >= wsA && s <= wsB) {
      const k = (s - wsA) / (wsB - wsA);
      wy += k < 0.3 ? 2.2 * Math.sin((k / 0.3) * Math.PI) : -4 * Math.sin(((k - 0.3) / 0.7) * Math.PI);
      turb = Math.max(turb, 0.35);
      alert = { id: 'windshear', text: 'WINDSHEAR', level: 'warning' };
    }

    const rollAmp = 1.5 + turb * 7;
    const rollDisturb = this.rollNoise.at(t) * rollAmp * turb;
    const pitchDisturb = this.pitchNoise.at(t) * (0.6 + turb * 3) * turb;

    return {
      wind: { x: wx, y: wy, z: wz },
      rollDisturb,
      pitchDisturb,
      turb,
      rain,
      cloud,
      windFrom,
      windKt,
      gustKt,
      alert,
      lightning,
    };
  }
}
