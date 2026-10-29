/**
 * Low-poly cities and sea traffic: Kuala Lumpur's skyline (the Petronas Twin Towers and KL Tower),
 * Kuching on the Sarawak River (with the golden-roofed State Legislative Assembly building), and
 * ships in the South China Sea.
 */
import * as THREE from 'three';
import { mulberry32 } from '../game/hazards';
import { brand } from '../brand/tokens';
import type { Heightfield } from './heightfield';

function windowTexture(lit = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e8e6e0';
  ctx.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 128; y += 8) {
    for (let x = 4; x < 64; x += 8) {
      ctx.fillStyle = lit && Math.random() < 0.3 ? '#f6e7b0' : Math.random() < 0.5 ? '#6f8ea3' : '#8aa7b8';
      ctx.fillRect(x, y, 5, 5);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function towers(field: Heightfield, centre: { x: number; z: number }, radius: number, count: number, minH: number, maxH: number, seed: number, palette: string[], footprint: [number, number]): THREE.InstancedMesh {
  const rand = mulberry32(seed);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ map: windowTexture(), roughness: 0.55, metalness: 0.1 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  let n = 0;
  for (let tries = 0; tries < count * 6 && n < count; tries++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * radius;
    const x = centre.x + Math.cos(a) * r;
    const z = centre.z + Math.sin(a) * r;
    const g = field.info(x, z);
    if (g.region === 'sea' || g.river || g.airport || g.h < 0 || field.keepClear(x, z)) continue;
    const centreFactor = 1 - r / radius;
    const h = minH + (maxH - minH) * Math.pow(rand(), 2) * (0.35 + 0.65 * centreFactor);
    const w = footprint[0] + rand() * (footprint[1] - footprint[0]);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
    m.compose(new THREE.Vector3(x, g.h - 1, z), q, new THREE.Vector3(w, h, w * (0.6 + rand() * 0.8)));
    mesh.setMatrixAt(n, m);
    mesh.setColorAt(n, col.set(palette[Math.floor(rand() * palette.length)]));
    n++;
  }
  mesh.count = n;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** The Sarawak State Legislative Assembly building: a golden, umbrella-like nine-sided roof. */
function goldenRoof(): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(42, 46, 26, 9), new THREE.MeshStandardMaterial({ color: '#efe9dc', roughness: 0.6 }));
  base.position.y = 13;
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(70, 46, 9, 1, true),
    new THREE.MeshStandardMaterial({ color: '#d9a62e', metalness: 0.8, roughness: 0.25, side: THREE.DoubleSide, flatShading: true }),
  );
  roof.position.y = 26 + 23;
  const spire = new THREE.Mesh(new THREE.ConeGeometry(4, 22, 9), new THREE.MeshStandardMaterial({ color: '#d9a62e', metalness: 0.8, roughness: 0.25 }));
  spire.position.y = 26 + 46 + 8;
  g.add(base, roof, spire);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/**
 * The Petronas Twin Towers: two tapering eight-pointed-star towers with stepped setbacks, pinnacle
 * spires and the skybridge between them. Scaled down to suit the compressed world.
 */
function twinTowers(): THREE.Group {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: '#cfd5dc', metalness: 0.85, roughness: 0.22, flatShading: true });
  const star = (r: number) => {
    const shape = new THREE.Shape();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const rr = i % 2 ? r * 0.8 : r;
      const px = Math.cos(a) * rr;
      const py = Math.sin(a) * rr;
      if (i === 0) shape.moveTo(px, py);
      else shape.lineTo(px, py);
    }
    return shape;
  };
  const tower = () => {
    const t = new THREE.Group();
    // Stepped tiers, each a little narrower.
    const tiers: [number, number][] = [
      [14, 120],
      [12.5, 40],
      [11, 26],
      [9, 16],
      [7, 12],
    ];
    let y = 0;
    tiers.forEach(([r, h]) => {
      const geo = new THREE.ExtrudeGeometry(star(r), { depth: h, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, steel);
      m.position.y = y;
      t.add(m);
      y += h;
    });
    const spire = new THREE.Mesh(new THREE.ConeGeometry(2.2, 46, 8), steel);
    spire.position.y = y + 23;
    t.add(spire);
    return t;
  };
  const a = tower();
  const b = tower();
  a.position.x = -26;
  b.position.x = 26;
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(30, 5, 6), steel);
  bridge.position.y = 92;
  g.add(a, b, bridge);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** Menara Kuala Lumpur: a slim shaft with its glass pod and antenna. */
function klTower(): THREE.Group {
  const g = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: '#e6e3dc', roughness: 0.6 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 7, 150, 12), concrete);
  shaft.position.y = 75;
  const pod = new THREE.Mesh(new THREE.SphereGeometry(16, 16, 10), new THREE.MeshStandardMaterial({ color: '#3f6e8c', metalness: 0.6, roughness: 0.2 }));
  pod.scale.y = 0.75;
  pod.position.y = 156;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.6, 40, 8), concrete);
  mast.position.y = 186;
  g.add(shaft, pod, mast);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function ship(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const len = 160 + rand() * 120;
  const hullMat = new THREE.MeshStandardMaterial({ color: rand() < 0.5 ? '#1f3550' : '#2a2d33', roughness: 0.6 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(30, 12, len), hullMat);
  hull.position.y = 2;
  const red = new THREE.Mesh(new THREE.BoxGeometry(30.2, 4, len + 0.2), new THREE.MeshStandardMaterial({ color: '#8f2b23' }));
  red.position.y = -2;
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(26, 16, 14), new THREE.MeshStandardMaterial({ color: '#f1f1ee' }));
  bridge.position.set(0, 16, len / 2 - 14);
  g.add(hull, red, bridge);
  const colors = ['#c43b2f', '#2f6db0', '#e1a92c', '#3f8f4f', '#d7d7d2', '#8b4f9f', brand.colors.red, brand.colors.yellow];
  const stack = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 2.5, 12), new THREE.MeshStandardMaterial({ roughness: 0.7 }), 400);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  let n = 0;
  for (let z = -len / 2 + 14; z < len / 2 - 30 && n < 400; z += 12.5) {
    const rows = 2 + Math.floor(rand() * 4);
    for (let x = -12; x <= 12 && n < 400; x += 2.6) {
      for (let y = 0; y < rows && n < 400; y++) {
        m.makeTranslation(x, 9.5 + y * 2.6, z);
        stack.setMatrixAt(n, m);
        stack.setColorAt(n, col.set(colors[Math.floor(rand() * colors.length)]));
        n++;
      }
    }
  }
  stack.count = n;
  g.add(stack);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

export function buildCities(field: Heightfield): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cities';

  // Kuala Lumpur: a dense cluster of towers with the Twin Towers and KL Tower at its heart.
  const kl = field.klCity;
  group.add(towers(field, kl, 1500, 160, 40, 170, 21, ['#dfe7ee', '#c9d6e2', '#eef1f4', '#b8c8d6', '#f4f4f4'], [22, 46]));
  group.add(towers(field, kl, 2700, 260, 12, 60, 23, ['#f4f1ea', '#e7efe9', '#f2e6dc', '#e5e9f2'], [14, 26]));
  const petronas = twinTowers();
  petronas.position.set(kl.x, field.height(kl.x, kl.z) - 1, kl.z);
  group.add(petronas);
  const menara = klTower();
  menara.position.set(kl.x - 520, field.height(kl.x - 520, kl.z + 260) - 1, kl.z + 260);
  group.add(menara);

  // Kuching: mostly low-rise with a handful of towers, around the river.
  const kc = field.kuchingCity;
  group.add(towers(field, kc, 2600, 520, 8, 70, 11, ['#f2efe8', '#e8e2d6', '#f5f5f2', '#dcd6c9', '#e9eef2'], [14, 40]));
  const dun = goldenRoof();
  dun.position.set(kc.x + 380, field.height(kc.x + 380, kc.z - 420) + 0.5, kc.z - 420);
  group.add(dun);

  // Ships under way in the South China Sea, off the Sarawak coast.
  const rand = mulberry32(5);
  const bc = field.borneoCoast;
  for (let i = 0; i < 12; i++) {
    const s = ship(rand);
    const along = -1500 + rand() * 6000;
    const out = 900 + rand() * 3500;
    const p = { x: bc.x - bc.nz * along - bc.nx * out, z: bc.z + bc.nx * along - bc.nz * out };
    if (field.info(p.x, p.z).region !== 'sea') continue;
    s.position.set(p.x, -2, p.z);
    s.rotation.y = rand() * Math.PI * 2;
    group.add(s);
  }
  return group;
}
