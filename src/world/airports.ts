/**
 * Kuala Lumpur International (WMKK) and Kuching International (WBGG), built from published
 * dimensions: KLIA's runway 14L/32R is about 4,000 x 60 m; Kuching's 07/25 is 3,780 x 46 m on
 * 068°/248°.
 * Markings follow ICAO Annex 14: threshold piano keys, designators, 30 m centreline dashes with
 * 20 m gaps, aiming point and touchdown zone bars, edge lines. PAPI and approach lights work.
 */
import * as THREE from 'three';
import { brand } from '../brand/tokens';
import { KCH_LAYOUT, KLIA_LAYOUT, kchFrame, kliaFrame, type Frame } from '../game/layout';
import { designator as runwayName, type Route } from '../game/route';
import { AircraftModel } from './aircraft';
import type { Aircraft } from '../game/flight';

/**
 * Surface heights. The logarithmic depth buffer ignores polygon offset, so layers are separated
 * physically: grass < taxiways/aprons < runway < paint. The aircraft rolls on y = 0.
 */
const Y = -0.12;
const GRASS_Y = -0.9;
const PAVEMENT_Y = -0.6;
const RUNWAY_Y = -0.35;

interface Rect {
  u: number;
  v: number;
  lu: number; // length along u
  lv: number; // width along v
}

/** Instanced flat quads in an airport frame. */
function quads(frame: Frame, rects: Rect[], color: string, y: number, opts: { emissive?: boolean } = {}): THREE.InstancedMesh {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = opts.emissive
    ? new THREE.MeshBasicMaterial({ color })
    : new THREE.MeshStandardMaterial({ color, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.InstancedMesh(geo, mat, rects.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (-frame.heading * Math.PI) / 180);
  rects.forEach((r, i) => {
    const w = frame.toWorld(r.u, r.v);
    m.compose(new THREE.Vector3(w.x, y, w.z), q, new THREE.Vector3(r.lv, 1, r.lu));
    mesh.setMatrixAt(i, m);
  });
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Runway designator painted flat, readable to an aircraft approaching along `heading`. */
function designator(frame: Frame, text: string, u: number, reverse: boolean): THREE.Mesh {
  const tex = canvasTexture(256, 512, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${text.length > 2 ? 230 : 300}px ${brand.fonts.instrument}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (text.length > 2) {
      ctx.fillText(text.slice(0, 2), 128, 170);
      ctx.fillText(text.slice(2), 128, 390);
    } else ctx.fillText(text, 128, 256);
  });
  const geo = new THREE.PlaneGeometry(text.length > 2 ? 16 : 14, text.length > 2 ? 34 : 26);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
  );
  const w = frame.toWorld(u, 0);
  mesh.position.set(w.x, Y + 0.03, w.z);
  mesh.rotation.y = (-(frame.heading + (reverse ? 180 : 0)) * Math.PI) / 180;
  mesh.receiveShadow = true;
  return mesh;
}

function asphaltTexture(): THREE.CanvasTexture {
  const t = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#3a3d42';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      const g = 50 + Math.random() * 30;
      ctx.fillStyle = `rgba(${g},${g + 2},${g + 6},0.5)`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export interface RunwaySpec {
  frame: Frame;
  /** u of each end; threshold markings at both. */
  u0: number;
  u1: number;
  width: number;
  /** Designators: at u0 (read along +u) and at u1 (read along -u). */
  names: [string, string];
}

/** Paint a complete runway. Returns the group and the PAPI lights near u0 for live updates. */
function buildRunway(spec: RunwaySpec, asphalt: THREE.Texture): { group: THREE.Group; papi: THREE.Mesh[]; papiAt: { u: number; v: number } } {
  const { frame, u0, u1, width } = spec;
  const g = new THREE.Group();
  const len = u1 - u0;

  const surfTex = asphalt.clone();
  surfTex.needsUpdate = true;
  surfTex.repeat.set(width / 20, len / 20);
  const surface = quads(frame, [{ u: (u0 + u1) / 2, v: 0, lu: len + 60, lv: width + 4 }], '#ffffff', RUNWAY_Y);
  (surface.material as THREE.MeshStandardMaterial).map = surfTex;
  (surface.material as THREE.MeshStandardMaterial).roughness = 0.92;
  g.add(surface);

  const white: Rect[] = [];
  const stripes = width >= 60 ? 16 : 12;
  const stripeW = 1.8;
  const gap = (width - 6 - stripes * stripeW) / (stripes + 2);
  for (const [end, dir] of [
    [u0, 1],
    [u1, -1],
  ] as const) {
    // Piano keys
    for (let i = 0; i < stripes; i++) {
      const half = stripes / 2;
      const side = i < half ? -1 : 1;
      const k = i < half ? i : i - half;
      const v = side * (gap * 1.5 + stripeW / 2 + k * (stripeW + gap));
      white.push({ u: end + dir * 21, v, lu: 30, lv: stripeW });
    }
    // Aiming point (400 m) and touchdown zone bars.
    for (const side of [-1, 1]) {
      white.push({ u: end + dir * 400, v: side * (width / 2 - 9), lu: 50, lv: 7 });
      for (const [d, bars] of [
        [150, 3],
        [300, 2],
        [600, 2],
        [750, 1],
        [900, 1],
      ] as const) {
        for (let b = 0; b < bars; b++) white.push({ u: end + dir * d, v: side * (width / 2 - 4 - b * 3), lu: 22, lv: 1.8 });
      }
    }
  }
  // Centreline: 30 m stripes, 20 m gaps, between the designators.
  for (let u = u0 + 120; u < u1 - 120; u += 50) white.push({ u: u + 15, v: 0, lu: 30, lv: 0.9 });
  // Edge lines
  white.push({ u: (u0 + u1) / 2, v: width / 2 - 0.6, lu: len, lv: 0.9 }, { u: (u0 + u1) / 2, v: -width / 2 + 0.6, lu: len, lv: 0.9 });
  g.add(quads(frame, white, '#f4f4f0', Y));

  g.add(designator(frame, spec.names[0], u0 + 58, false));
  g.add(designator(frame, spec.names[1], u1 - 58, true));

  // Edge lights every 60 m, green threshold bars, red ends.
  const lightGeo = new THREE.SphereGeometry(0.35, 6, 4);
  const lights = (rects: { u: number; v: number }[], color: string) => {
    const mesh = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ color }), rects.length);
    const m = new THREE.Matrix4();
    rects.forEach((r, i) => {
      const w = frame.toWorld(r.u, r.v);
      m.makeTranslation(w.x, 0.45, w.z);
      mesh.setMatrixAt(i, m);
    });
    mesh.frustumCulled = false;
    return mesh;
  };
  const edge: { u: number; v: number }[] = [];
  for (let u = u0; u <= u1; u += 60) for (const s of [-1, 1]) edge.push({ u, v: s * (width / 2 + 1.5) });
  g.add(lights(edge, '#fff8e6'));
  const thr: { u: number; v: number }[] = [];
  const ends: { u: number; v: number }[] = [];
  for (let v = -width / 2; v <= width / 2; v += 3) {
    thr.push({ u: u0 - 2, v });
    ends.push({ u: u1 + 2, v });
  }
  g.add(lights(thr, '#3bff7a'), lights(ends, '#ff3b3b'));

  // PAPI: four units left of the aiming point.
  const papi: THREE.Mesh[] = [];
  const papiAt = { u: u0 + 400, v: -(width / 2 + 15) };
  for (let i = 0; i < 4; i++) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 1.2), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    const w = frame.toWorld(papiAt.u, papiAt.v - i * 9);
    box.position.set(w.x, 0.8, w.z);
    box.rotation.y = (-frame.heading * Math.PI) / 180;
    g.add(box);
    papi.push(box);
  }
  return { group: g, papi, papiAt };
}

function box(w: number, h: number, d: number, mat: THREE.Material, frame: Frame, u: number, v: number, y = 0, rot = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  const p = frame.toWorld(u, v);
  mesh.position.set(p.x, y + h / 2, p.z);
  mesh.rotation.y = (-(frame.heading + rot) * Math.PI) / 180;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Glass curtain wall with mullions and a sign band. */
function facadeTexture(label: string, sub: string): THREE.CanvasTexture {
  return canvasTexture(2048, 256, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#9cc3d8');
    g.addColorStop(1, '#3d6a82');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 2048, 256);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let x = 0; x < 2048; x += 32) ctx.fillRect(x, 0, 3, 256);
    ctx.fillRect(0, 120, 2048, 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 2048, 70);
    ctx.fillStyle = brand.colors.ink;
    ctx.font = `800 46px ${brand.fonts.ui}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 1024, 30);
    ctx.font = `600 22px ${brand.fonts.ui}`;
    ctx.fillStyle = brand.colors.slate;
    ctx.fillText(sub, 1024, 58);
  });
}

function vaultRoof(length: number, depth: number, rise: number, mat: THREE.Material): THREE.Mesh {
  const half = depth / 2;
  const r = (half * half + rise * rise) / (2 * rise);
  const theta = 2 * Math.asin(half / r);
  // The arc is centred on +z around a y axis; turn it so the arc is on top and the axis runs along z.
  const geo = new THREE.CylinderGeometry(r, r, length, 48, 1, true, -theta / 2, theta);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -(r - rise), 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

export class Airports {
  readonly group = new THREE.Group();
  private papi: THREE.Mesh[] = [];
  private papiAt = { x: 0, z: 0 };
  private rabbit!: THREE.InstancedMesh;
  private rabbitCount = 0;
  readonly parked: AircraftModel[] = [];

  private readonly kch: Frame;

  constructor(route: Route) {
    this.kch = kchFrame(route);
    const asphalt = asphaltTexture();
    this.buildKlia(asphalt);
    this.buildKuching(asphalt);
  }

  /** Approach lighting before a threshold at u = thr: 900 m of crossbars and a sequenced "rabbit". */
  private approachLights(g: THREE.Group, f: Frame, thr: number): void {
    const bars: { u: number; v: number }[] = [];
    const rabbit: { u: number; v: number }[] = [];
    for (let u = -900; u <= -30; u += 30) {
      for (let v = -6; v <= 6; v += 3) bars.push({ u: thr + u, v });
      if (u === -300) for (let v = -15; v <= 15; v += 3) if (Math.abs(v) > 6) bars.push({ u: thr + u, v });
      rabbit.push({ u: thr + u, v: 0 });
    }
    const lightGeo = new THREE.SphereGeometry(0.5, 6, 4);
    const barMesh = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ color: '#fff4d6' }), bars.length);
    const m = new THREE.Matrix4();
    bars.forEach((b, i) => {
      const w = f.toWorld(b.u, b.v);
      m.makeTranslation(w.x, 1.2, w.z);
      barMesh.setMatrixAt(i, m);
    });
    barMesh.frustumCulled = false;
    g.add(barMesh);
    this.rabbit = new THREE.InstancedMesh(new THREE.SphereGeometry(1.4, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }), rabbit.length);
    rabbit.forEach((b, i) => {
      const w = f.toWorld(b.u, b.v);
      m.makeTranslation(w.x, 2, w.z);
      this.rabbit.setMatrixAt(i, m);
    });
    this.rabbit.frustumCulled = false;
    this.rabbitCount = rabbit.length;
    g.add(this.rabbit);
    const stanchions = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 3, 0.4), new THREE.MeshStandardMaterial({ color: '#c7c9cc' }), rabbit.length);
    rabbit.forEach((b, i) => {
      const w = f.toWorld(b.u, b.v);
      m.makeTranslation(w.x, 0, w.z);
      stanchions.setMatrixAt(i, m);
    });
    g.add(stanchions);
  }

  /** Kuching International: home. Landing on runway 25, with approach lights and a PAPI. */
  private buildKuching(asphalt: THREE.Texture): void {
    const f = this.kch;
    const L = KCH_LAYOUT;
    const g = new THREE.Group();
    g.name = 'WBGG';
    g.add(quads(f, [{ u: 0, v: 150, lu: 5000, lv: 1500 }], '#6f9a4f', GRASS_Y));
    const rwy = buildRunway({ frame: f, u0: -L.halfLength, u1: L.halfLength, width: L.width, names: ['25', '07'] }, asphalt);
    g.add(rwy.group);
    this.papi = rwy.papi;
    this.papiAt = f.toWorld(rwy.papiAt.u, rwy.papiAt.v);
    this.approachLights(g, f, -L.halfLength);

    // Taxiways, connectors, apron.
    const taxi: Rect[] = [
      { u: -300, v: L.taxiwayV, lu: 3300, lv: 23 },
      { u: -L.halfLength + 40, v: 95, lu: 40, lv: 190 },
      { u: -1150, v: 207, lu: 26, lv: 40 },
      { u: -400, v: 95, lu: 26, lv: 190 },
      { u: 700, v: 95, lu: 26, lv: 190 },
      { u: 1300, v: 95, lu: 26, lv: 190 },
    ];
    g.add(quads(f, taxi, '#45494f', PAVEMENT_Y));
    g.add(quads(f, [{ u: (L.apron.u0 + L.apron.u1) / 2, v: (L.apron.v0 + L.apron.v1) / 2, lu: L.apron.u1 - L.apron.u0, lv: L.apron.v1 - L.apron.v0 }], '#a3a6a8', PAVEMENT_Y + 0.05));
    const yellow: Rect[] = [{ u: -300, v: L.taxiwayV, lu: 3300, lv: 0.5 }];
    for (let u = L.apron.u0 + 100; u < L.apron.u1; u += 100) yellow.push({ u, v: 290, lu: 0.5, lv: 110 });
    g.add(quads(f, yellow, brand.colors.yellow, Y));

    // Terminal: long glass hall under a gently vaulted roof.
    const T = L.terminal;
    const tLen = T.u1 - T.u0;
    const tDep = T.v1 - T.v0;
    const tu = (T.u0 + T.u1) / 2;
    const tv = (T.v0 + T.v1) / 2;
    const facade = new THREE.MeshStandardMaterial({ map: facadeTexture('KUCHING INTERNATIONAL AIRPORT', 'Lapangan Terbang Antarabangsa Kuching · Selamat Datang ke Sarawak'), roughness: 0.25, metalness: 0.2 });
    const plain = new THREE.MeshStandardMaterial({ color: '#e9e6df', roughness: 0.7 });
    // With rotation -heading, local x points along +v and local z along -u; face 1 (-x) faces the runway.
    const hall = new THREE.Mesh(new THREE.BoxGeometry(tDep, 16, tLen), [plain, facade, plain, plain, plain, plain]);
    const hallPos = f.toWorld(tu, tv);
    hall.position.set(hallPos.x, 8, hallPos.z);
    hall.rotation.y = (-f.heading * Math.PI) / 180;
    hall.castShadow = true;
    hall.receiveShadow = true;
    g.add(hall);
    const roofMat = new THREE.MeshStandardMaterial({ color: '#d8dde2', roughness: 0.35, metalness: 0.6, side: THREE.DoubleSide });
    const roof = vaultRoof(tLen + 30, tDep + 26, 7, roofMat);
    const rp = f.toWorld(tu, tv);
    roof.position.set(rp.x, 16, rp.z);
    roof.rotation.y = (-f.heading * Math.PI) / 180;
    g.add(roof);
    // Jet bridges / piers.
    for (let u = T.u0 + 80; u < T.u1; u += 160) g.add(box(4, 5, 30, plain, f, u, T.v0 - 15, 3));

    // Control tower.
    const towerMat = new THREE.MeshStandardMaterial({ color: '#efece6', roughness: 0.6 });
    const tower = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4.4, 40, 16), towerMat);
    shaft.position.y = 20;
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 6, 6, 12), new THREE.MeshStandardMaterial({ color: '#2b4d63', roughness: 0.1, metalness: 0.5 }));
    cab.position.y = 43;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(4, 8.2, 2.5, 12), towerMat);
    cap.position.y = 47.2;
    tower.add(shaft, cab, cap);
    const tp = f.toWorld(L.tower.u, L.tower.v);
    tower.position.set(tp.x, 0, tp.z);
    tower.traverse((o) => (o.castShadow = true));
    g.add(tower);

    // AirBorneo hangar facing the runway.
    const H = L.hangar;
    const hangarFront = canvasTexture(1024, 256, (ctx) => {
      ctx.fillStyle = '#f6f6f4';
      ctx.fillRect(0, 0, 1024, 256);
      ctx.fillStyle = '#c9ccd1';
      for (let x = 40; x < 1000; x += 60) ctx.fillRect(x, 110, 4, 146);
      ctx.fillStyle = brand.colors.yellow;
      ctx.fillRect(0, 80, 1024, 10);
      ctx.fillStyle = brand.colors.red;
      ctx.fillRect(0, 90, 1024, 10);
      ctx.fillStyle = brand.colors.black;
      ctx.fillRect(0, 100, 1024, 10);
      ctx.fillStyle = brand.colors.ink;
      ctx.font = `800 64px ${brand.fonts.ui}`;
      ctx.textAlign = 'center';
      ctx.fillText('AirBorneo', 512, 64);
    });
    const hangarMat = new THREE.MeshStandardMaterial({ map: hangarFront, roughness: 0.6 });
    const hangarSide = new THREE.MeshStandardMaterial({ color: '#e7e8ea', roughness: 0.6 });
    const hangar = new THREE.Mesh(new THREE.BoxGeometry(70, 20, 90), [hangarSide, hangarMat, hangarSide, hangarSide, hangarSide, hangarSide]);
    const hp = f.toWorld(H.u, H.v);
    hangar.position.set(hp.x, 10, hp.z);
    hangar.rotation.y = (-f.heading * Math.PI) / 180;
    hangar.castShadow = true;
    g.add(hangar);
    const hRoof = vaultRoof(92, 72, 9, roofMat);
    hRoof.position.set(hp.x, 20, hp.z);
    hRoof.rotation.y = (-f.heading * Math.PI) / 180;
    g.add(hRoof);

    // Another AirBorneo ATR on stand, nose in towards the terminal, plus ground equipment.
    const parked = new AircraftModel();
    const pp = f.toWorld(-850, 300);
    parked.root.position.set(pp.x, 0, pp.z);
    parked.root.rotation.y = (-(f.heading + 90) * Math.PI) / 180;
    parked.body.position.y = 2.45;
    g.add(parked.root);
    this.parked.push(parked);
    const gse = new THREE.MeshStandardMaterial({ color: brand.colors.yellow, roughness: 0.6 });
    const white = new THREE.MeshStandardMaterial({ color: '#f0f0f0', roughness: 0.6 });
    g.add(box(2.4, 1.6, 4, gse, f, -1130, 268), box(2.2, 2.8, 6, white, f, -1172, 290), box(2.2, 2.8, 6, white, f, -865, 270));
    for (let i = 0; i < 4; i++) g.add(box(1.6, 1.6, 2.2, white, f, -1100 + i * 3, 330));
    this.group.add(g);
  }

  /** Kuala Lumpur International: departure from runway 32R. */
  private buildKlia(asphalt: THREE.Texture): void {
    const f = kliaFrame;
    const L = KLIA_LAYOUT;
    const g = new THREE.Group();
    g.name = 'WMKK';
    g.add(quads(f, [{ u: 1800, v: 250, lu: 6000, lv: 1500 }], '#73a052', GRASS_Y));
    const dep = runwayName(f.heading);
    const opp = runwayName((f.heading + 180) % 360);
    const rwy = buildRunway({ frame: f, u0: 0, u1: L.length, width: L.width, names: [`${dep}R`, `${opp}L`] }, asphalt);
    g.add(rwy.group);

    const taxi: Rect[] = [
      { u: 2000, v: L.taxiwayV, lu: 4300, lv: 23 },
      { u: 1500, v: 105, lu: 30, lv: 210 },
      { u: 2200, v: 105, lu: 30, lv: 210 },
      { u: 3000, v: 105, lu: 30, lv: 210 },
      { u: 3950, v: 105, lu: 30, lv: 210 },
      { u: L.stand.u, v: 245, lu: 30, lv: 60 },
    ];
    g.add(quads(f, taxi, '#45494f', PAVEMENT_Y));
    const A = L.apron;
    g.add(quads(f, [{ u: (A.u0 + A.u1) / 2, v: (A.v0 + A.v1) / 2, lu: A.u1 - A.u0, lv: A.v1 - A.v0 }], '#a5a8aa', PAVEMENT_Y + 0.05));
    const yellow: Rect[] = [{ u: 2000, v: L.taxiwayV, lu: 4300, lv: 0.5 }];
    for (let u = A.u0 + 100; u < A.u1; u += 100) yellow.push({ u, v: 360, lu: 0.5, lv: 160 });
    g.add(quads(f, yellow, brand.colors.yellow, Y));

    // AirBorneo's KLIA hangar.
    const S = L.hangar;
    const shedSign = canvasTexture(2048, 256, (ctx) => {
      ctx.fillStyle = '#dfe4ea';
      ctx.fillRect(0, 0, 2048, 256);
      ctx.fillStyle = '#b8c0c9';
      for (let x = 0; x < 2048; x += 120) ctx.fillRect(x + 10, 120, 100, 136);
      ctx.fillStyle = brand.colors.yellow;
      ctx.fillRect(0, 96, 2048, 8);
      ctx.fillStyle = brand.colors.red;
      ctx.fillRect(0, 104, 2048, 8);
      ctx.fillStyle = brand.colors.black;
      ctx.fillRect(0, 112, 2048, 8);
      ctx.fillStyle = brand.colors.ink;
      ctx.font = `800 64px ${brand.fonts.ui}`;
      ctx.textAlign = 'center';
      ctx.fillText('AirBorneo · Kuala Lumpur', 1024, 78);
    });
    const shedFront = new THREE.MeshStandardMaterial({ map: shedSign, roughness: 0.6 });
    const shedSide = new THREE.MeshStandardMaterial({ color: '#d7dce2', roughness: 0.7 });
    const shed = new THREE.Mesh(new THREE.BoxGeometry(S.v1 - S.v0, 22, S.u1 - S.u0), [shedSide, shedFront, shedSide, shedSide, shedSide, shedSide]);
    const sp = f.toWorld((S.u0 + S.u1) / 2, (S.v0 + S.v1) / 2);
    shed.position.set(sp.x, 11, sp.z);
    shed.rotation.y = (-f.heading * Math.PI) / 180;
    shed.castShadow = true;
    shed.receiveShadow = true;
    g.add(shed);

    // Main terminal under KLIA's forest of square, umbrella-like roof shells.
    const T = L.terminal;
    const glass = new THREE.MeshStandardMaterial({ map: facadeTexture('KUALA LUMPUR INTERNATIONAL AIRPORT', 'Lapangan Terbang Antarabangsa Kuala Lumpur · Jumpa lagi'), roughness: 0.2, metalness: 0.3 });
    const plain = new THREE.MeshStandardMaterial({ color: '#e6e8ea', roughness: 0.6 });
    const term = new THREE.Mesh(new THREE.BoxGeometry(T.v1 - T.v0, 24, T.u1 - T.u0), [plain, glass, plain, plain, plain, plain]);
    const tp = f.toWorld((T.u0 + T.u1) / 2, (T.v0 + T.v1) / 2);
    term.position.set(tp.x, 12, tp.z);
    term.rotation.y = (-f.heading * Math.PI) / 180;
    term.castShadow = true;
    g.add(term);
    const shellMat = new THREE.MeshStandardMaterial({ color: '#d9dde1', metalness: 0.5, roughness: 0.35, side: THREE.DoubleSide, flatShading: true });
    const shellGeo = new THREE.ConeGeometry(52, 10, 4, 1, true);
    shellGeo.rotateX(Math.PI);
    shellGeo.rotateY(Math.PI / 4);
    const nu = Math.floor((T.u1 - T.u0) / 74);
    const nv = Math.floor((T.v1 - T.v0) / 74);
    const shells = new THREE.InstancedMesh(shellGeo, shellMat, nu * nv);
    const sm = new THREE.Matrix4();
    const sq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (-f.heading * Math.PI) / 180);
    let si = 0;
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const w = f.toWorld(T.u0 + 37 + i * 74, T.v0 + 37 + j * 74);
        sm.compose(new THREE.Vector3(w.x, 29, w.z), sq, new THREE.Vector3(1, 1, 1));
        shells.setMatrixAt(si++, sm);
      }
    }
    shells.castShadow = true;
    g.add(shells);

    // KLIA's tall, torch-like control tower.
    const tw = new THREE.Group();
    const towerMat = new THREE.MeshStandardMaterial({ color: '#eef0f2', roughness: 0.5 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 72, 16), towerMat);
    shaft.position.y = 36;
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(12, 6, 10, 16), towerMat);
    cup.position.y = 76;
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(10.5, 11.5, 7, 16), new THREE.MeshStandardMaterial({ color: '#25455e', roughness: 0.1, metalness: 0.6 }));
    cab.position.y = 84.5;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(6, 11, 4, 16), towerMat);
    top.position.y = 90;
    tw.add(shaft, cup, cab, top);
    tw.traverse((o) => (o.castShadow = true));
    const twp = f.toWorld(L.tower.u, L.tower.v);
    tw.position.set(twp.x, 0, twp.z);
    g.add(tw);

    // Parked jets at the terminal.
    for (let i = 0; i < 5; i++) g.add(genericJet(f, T.u0 + 120 + i * 230, T.v0 - 50));

    // An AirBorneo ground vehicle waiting on the apron.
    const truck = new THREE.Group();
    const cabMat = new THREE.MeshStandardMaterial({ color: brand.colors.red, roughness: 0.5 });
    const reefer = canvasTexture(512, 128, (ctx) => {
      ctx.fillStyle = '#f7f7f7';
      ctx.fillRect(0, 0, 512, 128);
      ctx.fillStyle = brand.colors.yellow;
      ctx.fillRect(0, 96, 512, 8);
      ctx.fillStyle = brand.colors.red;
      ctx.fillRect(0, 104, 512, 8);
      ctx.fillStyle = brand.colors.black;
      ctx.fillRect(0, 112, 512, 8);
      ctx.fillStyle = brand.colors.ink;
      ctx.font = `800 40px ${brand.fonts.ui}`;
      ctx.fillText('AirBorneo · Connecting You', 24, 60);
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 3, 9), [new THREE.MeshStandardMaterial({ map: reefer }), new THREE.MeshStandardMaterial({ map: reefer }), plain, plain, plain, plain]);
    body.position.set(0, 2.2, 0);
    const tcab = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.6, 2.4), cabMat);
    tcab.position.set(0, 1.9, -5.9);
    truck.add(body, tcab);
    truck.traverse((o) => (o.castShadow = true));
    const trp = f.toWorld(L.stand.u + 26, L.stand.v + 40);
    truck.position.set(trp.x, 0, trp.z);
    truck.rotation.y = (-f.heading * Math.PI) / 180;
    g.add(truck);

    this.group.add(g);
  }

  /** Update PAPI colours from the aircraft's angle above the aiming point, and run the rabbit. */
  update(time: number, ac: Aircraft): void {
    const dx = ac.pos.x - this.papiAt.x;
    const dz = ac.pos.z - this.papiAt.z;
    const dist = Math.hypot(dx, dz);
    const angle = (Math.atan2(ac.pos.y + 2.5, dist) * 180) / Math.PI;
    const thresholds = [3.5, 3.17, 2.83, 2.5];
    this.papi.forEach((p, i) => {
      (p.material as THREE.MeshBasicMaterial).color.set(angle > thresholds[i] ? '#ffffff' : '#ff2a2a');
    });
    // Sequenced flashers run towards the threshold twice a second.
    const lit = Math.floor((time * 2 * this.rabbitCount) % this.rabbitCount);
    const m = new THREE.Matrix4();
    for (let i = 0; i < this.rabbitCount; i++) {
      this.rabbit.getMatrixAt(i, m);
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      m.compose(p, new THREE.Quaternion(), new THREE.Vector3().setScalar(i === lit || i === lit - 1 ? 1 : 0.001));
      this.rabbit.setMatrixAt(i, m);
    }
    this.rabbit.instanceMatrix.needsUpdate = true;
  }
}

/** A simple twin-jet for the gates at KLIA. */
function genericJet(f: Frame, u: number, v: number): THREE.Group {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: '#f2f3f5', roughness: 0.35 });
  const grey = new THREE.MeshStandardMaterial({ color: '#9aa1a9', roughness: 0.4, metalness: 0.4 });
  const fus = new THREE.Mesh(new THREE.CapsuleGeometry(2, 34, 8, 16), white);
  fus.rotation.x = Math.PI / 2;
  fus.position.y = 4;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(34, 0.5, 6), white);
  wing.position.set(0, 3, 2);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 5), new THREE.MeshStandardMaterial({ color: '#1f3b73' }));
  fin.position.set(0, 9, 17);
  const stab = new THREE.Mesh(new THREE.BoxGeometry(12, 0.4, 3.5), white);
  stab.position.set(0, 5, 17.5);
  g.add(fus, wing, fin, stab);
  for (const s of [-1, 1]) {
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.3, 4.5, 14), grey);
    eng.rotation.x = Math.PI / 2;
    eng.position.set(s * 6, 1.8, 0);
    g.add(eng);
  }
  g.traverse((o) => (o.castShadow = true));
  const p = f.toWorld(u, v);
  g.position.set(p.x, 0, p.z);
  g.rotation.y = (-(f.heading + 90) * Math.PI) / 180;
  return g;
}
