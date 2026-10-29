/**
 * The flight route: a compressed Kuching → Singapore track, built "turtle" style from straight and
 * curved legs, then sampled every few metres for fast nearest-point lookups.
 *
 * World axes: x = east, y = up, z = south (metres). Headings are degrees true, clockwise from north.
 */

export interface P3 {
  x: number;
  y: number;
  z: number;
}

export interface Leg {
  tag: string;
  length: number;
  /** Heading change across the leg; + is a right turn. */
  turn?: number;
  /** Altitude (world y) at the end of the leg. */
  alt: number;
  /** Linear altitude change (for the glide path) instead of an eased one. */
  linear?: boolean;
}

export interface Track {
  /** Distance along the route of the closest point, metres. */
  s: number;
  /** Signed horizontal offset from the path, + = right of track, metres. */
  lateral: number;
  /** Height above (+) or below (-) the path, metres. */
  vertical: number;
  /** Straight-line distance to the path. */
  dist: number;
  /** Sample index, for incremental tracking. */
  index: number;
}

export const DEG = Math.PI / 180;

export function dirFromHeading(hdgDeg: number): { x: number; z: number } {
  return { x: Math.sin(hdgDeg * DEG), z: -Math.cos(hdgDeg * DEG) };
}

export function headingFromDir(dx: number, dz: number): number {
  const h = Math.atan2(dx, -dz) / DEG;
  return (h + 360) % 360;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------------------------------------
// Real-world anchors, compressed for play.

/** Kuching International (WBGG) runway 07/25: 3,780 m x 46 m, 068°/248° true. */
export const KCH = {
  runwayCenter: { x: 0, y: 0, z: 0 },
  runwayHeading: 248, // runway 25, the preferential runway and the one pointing at Singapore
  runwayLength: 3780,
  runwayWidth: 46,
};

/** Singapore Changi (WSSS) runway 02C/20C: 4,000 m x 60 m, landing on 20C (heading 200°). */
export const CHANGI_RWY = { heading: 200, length: 4000, width: 60 };

export const ROUTE_LEGS: Leg[] = [
  { tag: 'runway', length: 450, alt: 0 },
  { tag: 'climb', length: 800, alt: 140 },
  { tag: 'turnout', length: 900, turn: 20, alt: 260 },
  { tag: 'rainforest', length: 700, alt: 300 },
  { tag: 'coast', length: 600, turn: -10, alt: 300 },
  { tag: 'storm-in', length: 450, turn: 12, alt: 300 },
  { tag: 'storm', length: 900, turn: -24, alt: 290 },
  { tag: 'storm-out', length: 450, turn: 12, alt: 280 },
  { tag: 'squall', length: 700, alt: 190 },
  { tag: 'base', length: 1100, turn: -58, alt: 60 },
  { tag: 'final', length: 1150, alt: 0, linear: true }, // 60 m over 1,150 m = 3° glide path
  { tag: 'rollout', length: 1400, alt: 0 },
];

/** Where the take-off roll starts: 80 m past the runway 25 threshold. */
export function lineupPoint(): { pos: P3; heading: number } {
  const d = dirFromHeading(KCH.runwayHeading);
  const half = KCH.runwayLength / 2;
  return {
    pos: { x: KCH.runwayCenter.x - d.x * (half - 80), y: 0, z: KCH.runwayCenter.z - d.z * (half - 80) },
    heading: KCH.runwayHeading,
  };
}

export class Route {
  readonly step = 5;
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly zs: Float64Array;
  readonly hdg: Float64Array;
  readonly length: number;
  /** Distance along the route where each tagged leg starts (and `${tag}:end`). */
  readonly stations: Record<string, number> = {};
  /** The Changi runway 20C threshold and touchdown aim point (300 m beyond it). */
  readonly changiThreshold: P3;
  readonly changiAim: P3;

  constructor(legs: Leg[] = ROUTE_LEGS) {
    const start = lineupPoint();
    const total = legs.reduce((a, l) => a + l.length, 0);
    const n = Math.floor(total / this.step) + 1;
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    this.zs = new Float64Array(n);
    this.hdg = new Float64Array(n);

    let x = start.pos.x;
    let z = start.pos.z;
    let h = start.heading;
    let alt = 0;
    let s = 0;
    let i = 0;
    this.xs[0] = x;
    this.zs[0] = z;
    this.ys[0] = 0;
    this.hdg[0] = h;
    for (const leg of legs) {
      this.stations[leg.tag] = s;
      const startAlt = alt;
      const startH = h;
      const steps = Math.round(leg.length / this.step);
      for (let k = 1; k <= steps && i < n - 1; k++) {
        const t = k / steps;
        const hNext = startH + (leg.turn ?? 0) * t;
        const hMid = (h + hNext) / 2;
        const d = dirFromHeading(hMid);
        x += d.x * this.step;
        z += d.z * this.step;
        h = hNext;
        const a = startAlt + (leg.alt - startAlt) * (leg.linear ? t : smooth(t));
        i++;
        this.xs[i] = x;
        this.zs[i] = z;
        this.ys[i] = a;
        this.hdg[i] = (h + 360) % 360;
      }
      alt = leg.alt;
      s += steps * this.step;
      this.stations[`${leg.tag}:end`] = s;
    }
    this.length = i * this.step;

    const aim = this.at(this.stations['final:end']);
    const d = dirFromHeading(CHANGI_RWY.heading);
    this.changiAim = { x: aim.x, y: 0, z: aim.z };
    this.changiThreshold = { x: aim.x - d.x * 300, y: 0, z: aim.z - d.z * 300 };
  }

  get count(): number {
    return Math.floor(this.length / this.step) + 1;
  }

  /** Interpolated point on the route at distance s. */
  at(s: number): P3 & { heading: number; slope: number } {
    const f = Math.max(0, Math.min(this.count - 1.0001, s / this.step));
    const i = Math.floor(f);
    const t = f - i;
    const j = Math.min(i + 1, this.count - 1);
    const dh = ((this.hdg[j] - this.hdg[i] + 540) % 360) - 180;
    return {
      x: this.xs[i] + (this.xs[j] - this.xs[i]) * t,
      y: this.ys[i] + (this.ys[j] - this.ys[i]) * t,
      z: this.zs[i] + (this.zs[j] - this.zs[i]) * t,
      heading: (this.hdg[i] + dh * t + 360) % 360,
      slope: (this.ys[j] - this.ys[i]) / this.step,
    };
  }

  /**
   * Closest point on the route to p. Searches a window around the previous index so tracking
   * stays continuous (and cheap) even where the route loops back near itself.
   */
  track(p: P3, prevIndex = -1, window = 400): Track {
    const n = this.count;
    let lo = 0;
    let hi = n - 1;
    if (prevIndex >= 0) {
      lo = Math.max(0, prevIndex - 40);
      hi = Math.min(n - 1, prevIndex + window);
    }
    let best = lo;
    let bestD = Infinity;
    for (let k = lo; k <= hi; k++) {
      const dx = this.xs[k] - p.x;
      const dz = this.zs[k] - p.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    // Project onto the neighbouring segment for sub-sample accuracy.
    const a = Math.max(0, best - 1);
    const b = Math.min(n - 1, best + 1);
    const sx = this.xs[b] - this.xs[a];
    const sz = this.zs[b] - this.zs[a];
    const segLen2 = sx * sx + sz * sz || 1;
    let t = ((p.x - this.xs[a]) * sx + (p.z - this.zs[a]) * sz) / segLen2;
    t = Math.max(0, Math.min(1, t));
    const s = (a + t * (b - a)) * this.step;
    const q = this.at(s);
    const d = dirFromHeading(q.heading);
    // Right of track is the direction (−d.z, d.x) rotated clockwise from the heading.
    const rx = -d.z;
    const rz = d.x;
    const lateral = (p.x - q.x) * rx + (p.z - q.z) * rz;
    const vertical = p.y - q.y;
    return { s, lateral, vertical, dist: Math.hypot(lateral, vertical), index: best };
  }

  /** Bounding box of the route in the horizontal plane. */
  bounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let k = 0; k < this.count; k++) {
      minX = Math.min(minX, this.xs[k]);
      maxX = Math.max(maxX, this.xs[k]);
      minZ = Math.min(minZ, this.zs[k]);
      maxZ = Math.max(maxZ, this.zs[k]);
    }
    return { minX, maxX, minZ, maxZ };
  }
}
