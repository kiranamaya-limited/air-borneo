/**
 * The ground: an analytic height function shared by the terrain mesh, tree placement and the
 * mission's collision checks. Peninsular Malaysia (KLIA's oil palm, Kuala Lumpur, the Titiwangsa
 * hills) gives way to the South China Sea and its islands, then home: the Sarawak coast, Mount
 * Santubong, the Sarawak River, Kuching and its airport.
 */
import { dirFromHeading, type Route } from '../game/route';
import { KCH_LAYOUT, KLIA_LAYOUT, kchFrame, kliaFrame, type Frame } from '../game/layout';
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

export type Region = 'sea' | 'peninsula' | 'borneo' | 'island';

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
  readonly klia: Frame = kliaFrame;
  readonly kch: Frame;
  /** Peninsular Malaysia's east coast: land behind it (against n). */
  readonly eastCoast: { x: number; z: number; nx: number; nz: number };
  /** The Sarawak coast: land ahead of it (along n), as far as `westLimit` along the shore. */
  readonly borneoCoast: { x: number; z: number; nx: number; nz: number };
  readonly santubong: { x: number; z: number };
  readonly kuchingCity: { x: number; z: number };
  readonly klCity: { x: number; z: number };
  readonly titiwangsa: { x: number; z: number };
  readonly islands: { x: number; z: number; r: number }[] = [];
  private readonly river: { x: number; z: number }[] = [];

  constructor(route: Route) {
    this.kch = kchFrame(route);
    const st = route.stations;
    const at = (s: number, rightOff: number, ahead = 0) => {
      const p = route.at(s);
      const d = dirFromHeading(p.heading);
      return { x: p.x - d.z * rightOff + d.x * ahead, z: p.z + d.x * rightOff + d.z * ahead };
    };

    const e = route.at(st['coast'] + 380);
    const de = dirFromHeading(e.heading);
    this.eastCoast = { x: e.x, z: e.z, nx: de.x, nz: de.z };
    // Kuala Lumpur's towers stand off the left wing after the turn out of KLIA.
    this.klCity = at(st['kl'] + 600, -1250);
    this.titiwangsa = at(st['hills'] + 900, 400);

    // Borneo: the shore runs roughly east-west where the route crosses it, curving round so that
    // Kuching and its airport (south-west of the crossing) are well inland.
    const c = route.at(st['sarawak'] + 300);
    const n = { x: 0.0995, z: 0.995 };
    this.borneoCoast = { x: c.x, z: c.z, nx: n.x, nz: n.z };
    // Mount Santubong (810 m) on its peninsula, off the left wing as the coast comes up.
    this.santubong = at(st['sarawak'] + 200, -1800, 300);
    // Kuching sits on the river under the "kuching" leg; the Sarawak River runs from the sea past
    // Santubong, south beneath the "river" leg, through the city and on upstream.
    const city = at(st['kuching'] + 450, 120);
    this.kuchingCity = city;
    const upstream = dirFromHeading(120);
    const riverPts = [
      at(st['sarawak'] + 500, -700),
      at(st['sarawak'] + 1000, -350),
      at(st['river'] + 500, -320),
      at(st['river'] + 1200, -260),
      city,
      { x: city.x + upstream.x * 1800, z: city.z + upstream.z * 1800 + 300 },
      { x: city.x + upstream.x * 4200, z: city.z + upstream.z * 4200 },
    ];
    for (let i = 0; i < riverPts.length - 1; i++) {
      for (let k = 0; k < 20; k++) {
        const t = k / 20;
        this.river.push({ x: riverPts[i].x + (riverPts[i + 1].x - riverPts[i].x) * t, z: riverPts[i].z + (riverPts[i + 1].z - riverPts[i].z) * t });
      }
    }

    // Pulau Tioman and other islands in the South China Sea, kept clear of the route itself.
    const rand = mulberry32(42);
    const s0 = st['coast:end'] + 300;
    const s1 = st['squall'];
    for (let i = 0; i < 40 && this.islands.length < 14; i++) {
      const p = route.at(s0 + (s1 - s0) * rand());
      const d = dirFromHeading(p.heading);
      const side = rand() < 0.5 ? -1 : 1;
      const off = side * (650 + rand() * 3200);
      const isl = { x: p.x - d.z * off, z: p.z + d.x * off, r: 180 + rand() * 520 };
      if (this.peninsulaOut(isl.x, isl.z) < isl.r + 600 || this.borneoIn(isl.x, isl.z) > -isl.r - 600) continue;
      this.islands.push(isl);
    }
    // Tioman itself: big, hilly and off the right wing.
    const tioman = at(st['islands'] + 400, 2600);
    this.islands.push({ x: tioman.x, z: tioman.z, r: 900 });
  }

  /** Metres seaward of Peninsular Malaysia's east coast (negative = on land). */
  private peninsulaOut(x: number, z: number): number {
    const ec = this.eastCoast;
    const along = (x - ec.x) * -ec.nz + (z - ec.z) * ec.nx;
    return (x - ec.x) * ec.nx + (z - ec.z) * ec.nz - (200 * Math.sin(along / 1100) + 110 * Math.sin(along / 370 + 1.3));
  }

  /** Metres inland of the Sarawak coast (negative = at sea). */
  private borneoIn(x: number, z: number): number {
    const bc = this.borneoCoast;
    const along = (x - bc.x) * -bc.nz + (z - bc.z) * bc.nx; // + = west along the shore
    const inland = (x - bc.x) * bc.nx + (z - bc.z) * bc.nz - (120 * Math.sin(along / 900 + 0.7) + 60 * Math.sin(along / 310));
    const westEdge = 7200 + 400 * Math.sin(z / 1300) - along;
    // Santubong's peninsula pushes out to sea.
    const sd = Math.hypot(x - this.santubong.x, z - this.santubong.z);
    return Math.max(Math.min(inland, westEdge), 1700 - sd);
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
    const penOut = this.peninsulaOut(x, z);
    const borIn = this.borneoIn(x, z);
    const sd = Math.hypot(x - this.santubong.x, z - this.santubong.z);

    let island = -Infinity;
    for (const isl of this.islands) {
      const d = Math.hypot(x - isl.x, z - isl.z);
      const wob = 1 + 0.25 * Math.sin(Math.atan2(z - isl.z, x - isl.x) * 3 + isl.r);
      island = Math.max(island, isl.r * wob - d);
    }

    const k = this.kch.toLocal(x, z);
    const l = this.klia.toLocal(x, z);
    const kchAirport = Math.max(0, 1 - Math.max(Math.abs(k.u) - 2250, -k.v - 450, k.v - 750, 0) / 250);
    const kliaAirport = Math.max(0, 1 - Math.max(-l.u - 1000, l.u - 4600, -l.v - 380, l.v - 900, 0) / 250);

    let h: number;
    let region: Region;
    let inland: number;
    if (penOut < 0) {
      region = 'peninsula';
      inland = smooth(0, 1400, -penOut);
      const hills = Math.max(0, fbm(x / 2600, z / 2600)) * 110 + fbm(x / 700, z / 700, 3) * 14;
      h = 0.6 + inland * (6 + hills) - Math.max(0, 1 - -penOut / 160) * 2.4;
      // The Titiwangsa range: forested ridges east of Kuala Lumpur.
      const td = Math.hypot(x - this.titiwangsa.x, z - this.titiwangsa.z);
      h += 120 * Math.exp(-((td / 2200) ** 2)) * (0.75 + 0.25 * fbm(x / 400, z / 400)) * inland;
    } else if (borIn > 0) {
      region = 'borneo';
      inland = smooth(0, 1400, borIn);
      const hills = Math.max(0, fbm(x / 2600, z / 2600)) * 130 + fbm(x / 700, z / 700, 3) * 16;
      h = 0.6 + inland * (6 + hills) - Math.max(0, 1 - borIn / 160) * 2.4;
      h += 810 * Math.exp(-((sd / 900) ** 2)) * (0.85 + 0.15 * fbm(x / 300, z / 300));
    } else if (island > 0) {
      region = 'island';
      inland = smooth(0, 300, island);
      h = 0.4 + inland * (8 + Math.max(0, fbm(x / 500, z / 500)) * 70) - Math.max(0, 1 - island / 80) * 2.2;
    } else {
      region = 'sea';
      inland = 0;
      const shore = Math.max(penOut > 0 ? -penOut : 0, borIn, island);
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
    const flat = Math.max(kchAirport, kliaAirport);
    if (flat > 0) h = h * (1 - flat) - 1.4 * flat;

    let urban = 0;
    if (region === 'borneo') urban = smooth(2600, 800, Math.hypot(x - this.kuchingCity.x, z - this.kuchingCity.z));
    if (region === 'peninsula') urban = smooth(2800, 900, Math.hypot(x - this.klCity.x, z - this.klCity.z));
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
    const k = this.kch.toLocal(x, z);
    if (Math.abs(k.u) < 2600 && k.v > -700 && k.v < 1000) return true;
    const l = this.klia.toLocal(x, z);
    if (l.u > -1300 && l.u < 4900 && l.v > -600 && l.v < 1100) return true;
    return false;
  }

  static readonly kchLayout = KCH_LAYOUT;
  static readonly kliaLayout = KLIA_LAYOUT;
}
