import * as THREE from 'three';

/** A cross-section for lofting: 2D ring points placed in 3D by a centre and two axes. */
export interface Section {
  center: THREE.Vector3;
  ring: [number, number][];
  /** Axis for the ring's first coordinate. */
  ax: THREE.Vector3;
  /** Axis for the ring's second coordinate. */
  ay: THREE.Vector3;
}

export interface LoftOptions {
  closed?: boolean;
  capStart?: boolean;
  capEnd?: boolean;
  /** Custom UV per vertex, given the section index and ring index. */
  uv?: (si: number, ri: number, p: THREE.Vector3) => [number, number];
  /** Per-vertex colour. */
  color?: (si: number, ri: number, p: THREE.Vector3) => THREE.Color;
}

/**
 * Skin a series of cross-sections into a mesh. All sections must have the same ring length.
 * Normals are made to face outwards (away from each section's centre).
 */
export function loft(sections: Section[], opts: LoftOptions = {}): THREE.BufferGeometry {
  const closed = opts.closed ?? true;
  const n = sections[0].ring.length;
  const ringLen = closed ? n + 1 : n;
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const p = new THREE.Vector3();

  let total = 0;
  const lengths = [0];
  for (let i = 1; i < sections.length; i++) {
    total += sections[i].center.distanceTo(sections[i - 1].center);
    lengths.push(total);
  }

  sections.forEach((sec, si) => {
    for (let k = 0; k < ringLen; k++) {
      const [a, b] = sec.ring[k % n];
      p.copy(sec.center).addScaledVector(sec.ax, a).addScaledVector(sec.ay, b);
      positions.push(p.x, p.y, p.z);
      const uv = opts.uv ? opts.uv(si, k, p) : [lengths[si] / (total || 1), k / n];
      uvs.push(uv[0], uv[1]);
      if (opts.color) {
        const c = opts.color(si, k % n, p);
        colors.push(c.r, c.g, c.b);
      }
    }
  });

  for (let si = 0; si < sections.length - 1; si++) {
    for (let k = 0; k < ringLen - 1; k++) {
      const a = si * ringLen + k;
      const b = (si + 1) * ringLen + k;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const addCap = (si: number, reverse: boolean) => {
    const sec = sections[si];
    const centerIndex = positions.length / 3;
    positions.push(sec.center.x, sec.center.y, sec.center.z);
    uvs.push(si ? 1 : 0, 0.5);
    if (opts.color) {
      const c = opts.color(si, 0, sec.center);
      colors.push(c.r, c.g, c.b);
    }
    for (let k = 0; k < ringLen - 1; k++) {
      const a = si * ringLen + k;
      if (reverse) indices.push(centerIndex, a + 1, a);
      else indices.push(centerIndex, a, a + 1);
    }
  };
  if (opts.capStart) addCap(0, true);
  if (opts.capEnd) addCap(sections.length - 1, false);

  // Orient faces outwards: test the first side triangle against its section centre.
  const pos = (i: number) => new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  const mid = Math.floor(sections.length / 2) - 1;
  const t0 = Math.max(0, mid) * ringLen + Math.floor(n / 4);
  const A = pos(t0);
  const B = pos(t0 + ringLen);
  const C = pos(t0 + 1);
  const normal = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
  const outward = A.clone().sub(sections[Math.max(0, mid)].center);
  if (normal.dot(outward) < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = t;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (opts.color) geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Points around an ellipse, starting at the top (+b) and going towards +a. */
export function ellipse(rx: number, ry: number, n: number, flattenBottom = 0): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const t = (k / n) * Math.PI * 2;
    let y = Math.cos(t) * ry;
    if (y < 0) y *= 1 - flattenBottom;
    out.push([Math.sin(t) * rx, y]);
  }
  return out;
}

/** A closed airfoil outline (chordwise 0..chord from the leading edge, thickness up/down). */
export function airfoil(chord: number, thickness: number, n = 14): [number, number][] {
  const upper: [number, number][] = [];
  const lower: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const x = (1 - Math.cos((i / n) * Math.PI)) / 2; // cosine spacing: dense at the edges
    const t = 5 * thickness * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const camber = 0.02 * Math.sin(Math.PI * x) * chord;
    upper.push([x * chord, camber + t * chord]);
    lower.push([x * chord, camber - t * chord * 0.8]);
  }
  // Trailing edge → leading edge along the top, then back along the bottom.
  return [...upper.reverse(), ...lower.slice(1, -1)];
}

/** Merge geometries that share the same attributes (simple, non-indexed-safe). */
export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const names = Object.keys(prepared[0].attributes);
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const itemSize = prepared[0].attributes[name].itemSize;
    const arrays = prepared.map((g) => g.attributes[name]?.array as Float32Array | undefined);
    if (arrays.some((a) => !a)) continue;
    const len = arrays.reduce((a, b) => a + b!.length, 0);
    const merged = new Float32Array(len);
    let offset = 0;
    for (const a of arrays) {
      merged.set(a!, offset);
      offset += a!.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(merged, itemSize));
  }
  return out;
}

/** Apply a transform to a geometry and return it (chainable). */
export function placed(geo: THREE.BufferGeometry, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
    new THREE.Vector3(...scale),
  );
  geo.applyMatrix4(m);
  return geo;
}
