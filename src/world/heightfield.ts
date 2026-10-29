/**
 * The ground: an analytic height function shared by the terrain mesh, tree placement and the
 * mission's collision checks. Western Sarawak (rainforest, Kuching, Mount Santubong) gives way to
 * the South China Sea, then Singapore's east coast and Changi.
 */
import { dirFromHeading, type Route } from '../game/route';
import { CHANGI_LAYOUT, KCH_LAYOUT, changiFrame, kchFrame, type Frame } from '../game/layout';
import { mulberry32 } from '../game/hazards';

export const SEA_LEVEL = -2;

// ---------------------------------------------------------------------------------- noise

const perm = new Uint8Array(512);
{
  const rand = mulberry32(20260101);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}

function grad(h: number, x: number, y: number): number {
  const g = h & 7;
  const u = g < 4 ? x : y;
  const v = g < 4 ? y : x;
  return (g & 1 ? -u : u) + (g & 2 ? -2 * v : 2 * v);
}

/** Classic 2D Perlin noise, roughly -1..1. */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const aa = perm[perm[xi] + yi];
  const ab = perm[perm[xi] + yi + 1];
  const ba = perm[perm[xi + 1] + yi];
  const bb = perm[perm[xi + 1] + yi + 1];
  const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf));
  const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1));
  return (x1 + v * (x2 - x1)) * 0.5;
}

export function fbm(x: number, y: number, octaves = 4): number {
  let a = 0.5;
  let f = 1;
  let sum = 0;
  for (let i = 0; i < octaves; i++) {
    sum += a * noise2(x * f, y * f);
    f *= 2.03;
    a *= 0.5;
  }
  return sum;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------- terrain

export type Region = 'sea' | 'borneo' | 'singapore' | 'island';

export interface GroundInfo {
  h: number;
  region: Region;
  /** 0..1, how far inland (for colouring beaches vs forest). */
  inland: number;
  airport: boolean;
  urban: number;
  river: boolean;
}

export class Heightfield {
  readonly kch: Frame = kchFrame;
  readonly changi: Frame;
  readonly borneoCoast: { x: number; z: number; nx: number; nz: number };
  readonly sgCoast: { x: number; z: number; nx: number; nz: number };
  readonly santubong: { x: number; z: number };
  readonly kuchingCity: { x: number; z: number };
  readonly islands: { x: number; z: number; r: number }[] = [];
  private readonly river: { x: number; z: number }[] = [];

  constructor(route: Route) {
    this.changi = changiFrame(route);
    const c1 = route.at(route.stations['coast'] + 380);
    const d1 = dirFromHeading(c1.heading);
    this.borneoCoast = { x: c1.x, z: c1.z, nx: d1.x, nz: d1.z };
    // Mount Santubong (810 m) stands on the coast north of the track, to the right when flying west.
    const right = { x: -d1.z, z: d1.x };
    this.santubong = { x: c1.x + right.x * 3200 - d1.x * 500, z: c1.z + right.z * 3200 - d1.z * 500 };

    const thr = route.changiThreshold;
    const f = dirFromHeading(200);
    this.sgCoast = { x: thr.x - f.x * 520, z: thr.z - f.z * 520, nx: f.x, nz: f.z };

    // Kuching sits under the northbound "city" leg; the Sarawak River runs from upstream east of the
    // city, through it, then west beneath the "river" leg to the sea.
    const at = (s: number, rightOff: number) => {
      const p = route.at(s);
      const d = dirFromHeading(p.heading);
      return { x: p.x - d.z * rightOff, z: p.z + d.x * rightOff };
    };
    const st = route.stations;
    const city = at(st['city'] + 750, -250);
    this.kuchingCity = city;
    const upstream = dirFromHeading(100);
    const riverPts = [
      { x: city.x + upstream.x * 4200, z: city.z + upstream.z * 4200 },
      { x: city.x + upstream.x * 1800, z: city.z + upstream.z * 1800 + 300 },
      city,
      at(st['river'] + 700, 380),
      at(st['river'] + 1700, 480),
      at(st['rainforest'] + 300, 520),
      { x: c1.x + right.x * 1700 + d1.x * 120, z: c1.z + right.z * 1700 + d1.z * 120 },
    ];
    for (let i = 0; i < riverPts.length - 1; i++) {
      for (let k = 0; k < 20; k++) {
        const t = k / 20;
        this.river.push({ x: riverPts[i].x + (riverPts[i + 1].x - riverPts[i].x) * t, z: riverPts[i].z + (riverPts[i + 1].z - riverPts[i].z) * t });
      }
    }

    // A few islands in the South China Sea, kept clear of the route itself.
    const rand = mulberry32(42);
    const s0 = route.stations['coast:end'] + 400;
    const s1 = route.stations['base'] + 300;
    for (let i = 0; i < 16; i++) {
      const p = route.at(s0 + (s1 - s0) * rand());
      const d = dirFromHeading(p.heading);
      const side = rand() < 0.5 ? -1 : 1;
      const off = side * (650 + rand() * 3200);
      this.islands.push({ x: p.x - d.z * off, z: p.z + d.x * off, r: 180 + rand() * 520 });
    }
  }

  private riverDist(x: number, z: number): number {
    let best = Infinity;
    for (let i = 0; i < this.river.length; i += 2) {
      const dx = this.river[i].x - x;
      const dz = this.river[i].z - z;
      best = Math.min(best, dx * dx + dz * dz);
    }
    return Math.sqrt(best);
  }

  info(x: number, z: number): GroundInfo {
    // Borneo: land behind a wiggly coastline.
    const bc = this.borneoCoast;
    const along1 = (x - bc.x) * -bc.nz + (z - bc.z) * bc.nx;
    const out1 = (x - bc.x) * bc.nx + (z - bc.z) * bc.nz - (200 * Math.sin(along1 / 1100) + 110 * Math.sin(along1 / 370 + 1.3));
    // Santubong peninsula pushes out to sea.
    const sx = x - this.santubong.x;
    const sz = z - this.santubong.z;
    const sd = Math.hypot(sx, sz);
    const borneoOut = Math.min(out1, sd - 1500);

    // Singapore: land beyond its north-east coast, bounded to the east.
    const sc = this.sgCoast;
    const along2 = (x - sc.x) * -sc.nz + (z - sc.z) * sc.nx;
    const in2 = (x - sc.x) * sc.nx + (z - sc.z) * sc.nz - (90 * Math.sin(along2 / 700) + 50 * Math.sin(along2 / 260 + 2));
    const sgIn = Math.min(in2, along2 + 2600 + 150 * Math.sin((x + z) / 900));

    let island = -Infinity;
    for (const isl of this.islands) {
      const d = Math.hypot(x - isl.x, z - isl.z);
      const wob = 1 + 0.25 * Math.sin(Math.atan2(z - isl.z, x - isl.x) * 3 + isl.r);
      island = Math.max(island, isl.r * wob - d);
    }

    const k = kchFrame.toLocal(x, z);
    const c = this.changi.toLocal(x, z);
    const kchAirport = Math.max(0, 1 - Math.max(Math.abs(k.u) - 2250, -k.v - 450, k.v - 750, 0) / 250);
    const sgAirport = Math.max(0, 1 - Math.max(-c.u - 1000, c.u - 4600, -c.v - 380, c.v - 900, 0) / 250);

    let h: number;
    let region: Region;
    let inland: number;
    if (borneoOut < 0) {
      region = 'borneo';
      inland = smooth(0, 1400, -borneoOut);
      const hills = Math.max(0, fbm(x / 2600, z / 2600)) * 150 + fbm(x / 700, z / 700, 3) * 18;
      h = 0.6 + inland * (6 + hills) - Math.max(0, 1 - -borneoOut / 160) * 2.4;
      h += 810 * Math.exp(-((sd / 900) ** 2)) * (0.85 + 0.15 * fbm(x / 300, z / 300));
    } else if (sgIn > 0) {
      region = 'singapore';
      inland = smooth(0, 900, sgIn);
      h = 0.6 + inland * (4 + Math.max(0, fbm(x / 1800, z / 1800)) * 40) - Math.max(0, 1 - sgIn / 120) * 2.4;
    } else if (island > 0) {
      region = 'island';
      inland = smooth(0, 300, island);
      h = 0.4 + inland * (8 + Math.max(0, fbm(x / 500, z / 500)) * 70) - Math.max(0, 1 - island / 80) * 2.2;
    } else {
      region = 'sea';
      inland = 0;
      const shore = Math.max(-borneoOut, sgIn, island);
      h = SEA_LEVEL - 1 - Math.min(30, -shore / 60);
    }

    // River channel through Kuching.
    let river = false;
    if (region === 'borneo') {
      const rd = this.riverDist(x, z);
      if (rd < 140) {
        const w = smooth(140, 60, rd);
        h = h * (1 - w) + (SEA_LEVEL - 3) * w;
        river = rd < 75;
      }
    }

    // Flatten the airports exactly to y = 0.
    const flat = Math.max(kchAirport, sgAirport);
    if (flat > 0) h = h * (1 - flat) - 1.4 * flat;

    const cityD = Math.hypot(x - this.kuchingCity.x, z - this.kuchingCity.z);
    let urban = region === 'borneo' ? smooth(2600, 800, cityD) : 0;
    if (region === 'singapore') urban = Math.max(0, Math.min(1, (fbm(x / 1500, z / 1500) + 0.25) * 2)) * smooth(400, 1500, sgIn);
    if (urban > 0 && !river && flat === 0) h = Math.min(h, 2 + urban * 4 + (1 - urban) * h);

    return { h, region, inland, airport: flat > 0.5, urban, river };
  }

  height(x: number, z: number): number {
    return this.info(x, z).h;
  }

  /** What the aircraft would hit: the ground, or the sea surface. */
  groundOrSea(x: number, z: number): number {
    return Math.max(this.height(x, z), SEA_LEVEL);
  }

  /** Zones where nothing should be planted. */
  keepClear(x: number, z: number): boolean {
    const k = kchFrame.toLocal(x, z);
    if (Math.abs(k.u) < 2600 && k.v > -700 && k.v < 1000) return true;
    const c = this.changi.toLocal(x, z);
    if (c.u > -1300 && c.u < 4900 && c.v > -600 && c.v < 1100) return true;
    return false;
  }

  static readonly kchLayout = KCH_LAYOUT;
  static readonly changiLayout = CHANGI_LAYOUT;
}
