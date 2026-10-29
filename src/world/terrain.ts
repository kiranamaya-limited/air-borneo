import * as THREE from 'three';
import { Heightfield, SEA_LEVEL } from './heightfield';
import { mulberry32 } from '../game/hazards';
import type { Route } from '../game/route';

const COLORS = {
  sand: new THREE.Color('#d9c8a0'),
  mud: new THREE.Color('#7d7356'),
  padi: new THREE.Color('#9cbf5c'),
  palm: new THREE.Color('#5d8a3a'),
  forest: new THREE.Color('#2f5a2e'),
  forestDeep: new THREE.Color('#22462a'),
  hill: new THREE.Color('#3b5e33'),
  rock: new THREE.Color('#6d6a5d'),
  urban: new THREE.Color('#a7a49c'),
  sgGreen: new THREE.Color('#6f9a58'),
  grass: new THREE.Color('#78a450'),
  seabed: new THREE.Color('#2f7d86'),
};

/** Terrain mesh (low-poly, vertex-coloured) and instanced rainforest along the route corridor. */
export function buildTerrain(field: Heightfield, route: Route): THREE.Group {
  const group = new THREE.Group();
  const b = route.bounds();
  const margin = 9000;
  const minX = b.minX - margin;
  const maxX = b.maxX + margin;
  const minZ = b.minZ - margin;
  const maxZ = b.maxZ + margin;
  const cell = 90;
  const nx = Math.ceil((maxX - minX) / cell);
  const nz = Math.ceil((maxZ - minZ) / cell);

  const geo = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, nx, nz);
  geo.rotateX(-Math.PI / 2);
  geo.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const g = field.info(x, z);
    pos.setY(i, g.h);
    const n = Math.sin(x * 0.0021) * Math.cos(z * 0.0017);
    if (g.region === 'sea' || g.h < SEA_LEVEL - 0.5) c.copy(COLORS.seabed);
    else if (g.airport) c.copy(COLORS.grass);
    else if (g.inland < 0.08) c.copy(COLORS.sand);
    else if (g.urban > 0.35) c.copy(COLORS.urban).lerp(COLORS.grass, 0.4 - g.urban * 0.3);
    else if (g.region === 'singapore') c.copy(COLORS.sgGreen).lerp(COLORS.forest, 0.3 + n * 0.2);
    else if (g.h > 300) c.copy(COLORS.hill).lerp(COLORS.rock, Math.min(1, (g.h - 300) / 500));
    else if (g.inland < 0.25) c.copy(COLORS.mud).lerp(COLORS.palm, g.inland * 4);
    else {
      // Rainforest with patches of oil palm and padi near the city.
      const patch = Math.sin(x / 640 + Math.sin(z / 900) * 2) * Math.cos(z / 520);
      c.copy(COLORS.forest).lerp(COLORS.forestDeep, 0.5 + n * 0.5);
      if (patch > 0.55) c.lerp(COLORS.palm, 0.8);
      if (g.urban > 0.05) c.lerp(COLORS.padi, 0.5);
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true }),
  );
  terrain.receiveShadow = true;
  terrain.name = 'terrain';
  group.add(terrain);

  group.add(buildForest(field, route));
  return group;
}

function buildForest(field: Heightfield, route: Route): THREE.InstancedMesh {
  const rand = mulberry32(7);
  const geo = new THREE.IcosahedronGeometry(1, 0);
  geo.scale(1, 0.8, 1);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
  const max = 14000;
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const col = new THREE.Color();
  const greens = ['#2c5a2b', '#3b6b30', '#25502a', '#4a7a35', '#1f4626', '#557f3b'].map((h) => new THREE.Color(h));
  let count = 0;
  const step = 70;
  for (let s0 = 0; s0 < route.length && count < max; s0 += step) {
    const at = route.at(s0);
    const dx = Math.cos((at.heading * Math.PI) / 180);
    const dz = Math.sin((at.heading * Math.PI) / 180);
    for (let k = -38; k <= 38 && count < max; k++) {
      const off = k * 62 + (rand() - 0.5) * 50;
      const x = at.x + dx * off + (rand() - 0.5) * 60;
      const z = at.z + dz * off + (rand() - 0.5) * 60;
      if (field.keepClear(x, z)) continue;
      const g = field.info(x, z);
      if (g.region === 'sea' || g.river || g.inland < 0.18 || g.urban > 0.3 || g.h < 0.5) continue;
      if (g.region === 'singapore' && rand() < 0.6) continue;
      const r = 9 + rand() * 12;
      p.set(x, g.h + r * 0.45, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
      s.set(r, r * (0.8 + rand() * 0.6), r);
      m.compose(p, q, s);
      mesh.setMatrixAt(count, m);
      col.copy(greens[Math.floor(rand() * greens.length)]);
      mesh.setColorAt(count, col);
      count++;
    }
  }
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.name = 'forest';
  return mesh;
}
