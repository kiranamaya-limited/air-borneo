/** Low-poly cumulus over Borneo and the sea, and the towering cumulonimbus the route skirts. */
import * as THREE from 'three';
import { mulberry32 } from '../game/hazards';
import type { Route } from '../game/route';

interface Puff {
  x: number;
  y: number;
  z: number;
  r: number;
  dark: number;
}

function clearOfRoute(route: Route, p: Puff, margin: number): boolean {
  const t = route.track(p);
  const at = route.at(t.s);
  const d = Math.hypot(p.x - at.x, (p.y - at.y) * 1.2, p.z - at.z);
  return d > p.r + margin;
}

export function buildClouds(route: Route, stormCore: { x: number; z: number }): THREE.Group {
  const group = new THREE.Group();
  group.name = 'clouds';
  const rand = mulberry32(99);
  const puffs: Puff[] = [];

  // Fair-weather cumulus along the corridor, mostly above the cruise level.
  for (let i = 0; i < 90; i++) {
    const s = rand() * route.length;
    const at = route.at(s);
    const side = (rand() - 0.5) * 9000;
    const cx = at.x + Math.cos((at.heading * Math.PI) / 180) * side;
    const cz = at.z + Math.sin((at.heading * Math.PI) / 180) * side;
    const base = 520 + rand() * 500;
    const size = 90 + rand() * 140;
    const n = 5 + Math.floor(rand() * 6);
    for (let k = 0; k < n; k++) {
      puffs.push({
        x: cx + (rand() - 0.5) * size * 2.6,
        y: base + rand() * size * 0.8,
        z: cz + (rand() - 0.5) * size * 2.6,
        r: size * (0.45 + rand() * 0.6),
        dark: 0,
      });
    }
  }
  // Scattered low scud near the coast and the squall, for a sense of speed.
  for (const tag of ['coast', 'squall', 'storm-out']) {
    for (let i = 0; i < 14; i++) {
      const at = route.at(route.stations[tag] + rand() * 900);
      const side = (rand() < 0.5 ? -1 : 1) * (250 + rand() * 900);
      puffs.push({
        x: at.x + Math.cos((at.heading * Math.PI) / 180) * side,
        y: at.y + (rand() - 0.3) * 160,
        z: at.z + Math.sin((at.heading * Math.PI) / 180) * side,
        r: 40 + rand() * 70,
        dark: tag === 'coast' ? 0 : 0.5,
      });
    }
  }
  // The cumulonimbus: a dark tower with an anvil top.
  for (let i = 0; i < 160; i++) {
    const h = rand();
    const y = 60 + h * 2100;
    const spread = 700 + h * 250 + (h > 0.85 ? (h - 0.85) * 9000 : 0);
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * spread;
    puffs.push({
      x: stormCore.x + Math.cos(a) * r,
      y,
      z: stormCore.z + Math.sin(a) * r,
      r: 220 + rand() * 260,
      dark: 1 - h * 0.7,
    });
  }

  const kept = puffs.filter((p) => clearOfRoute(route, p, p.dark > 0.6 ? 220 : 120));
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, flatShading: true, emissive: '#ffffff', emissiveIntensity: 0.18 });
  const mesh = new THREE.InstancedMesh(geo, mat, kept.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  const white = new THREE.Color('#ffffff');
  const grey = new THREE.Color('#5a636c');
  kept.forEach((p, i) => {
    q.setFromEuler(new THREE.Euler(rand(), rand(), rand()));
    m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.r, p.r * 0.7, p.r));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, col.copy(white).lerp(grey, p.dark));
  });
  mesh.frustumCulled = false;
  group.add(mesh);
  return group;
}
