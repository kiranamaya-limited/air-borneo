/**
 * Procedural Boeing 737-800 at real dimensions: 39.47 m long, 35.79 m span with blended winglets,
 * 12.5 m tall. Low wing swept 25° with 6° dihedral, two CFM56-7B engines on pylons, conventional
 * tail with a tall swept fin, main gear folding inwards into the wing root, nose gear forwards.
 *
 * Local axes: nose towards -z, right wing +x, up +y. The fuselage axis is AXIS_HEIGHT above the
 * main wheels' contact point.
 */
import * as THREE from 'three';
import { airfoil, ellipse, loft, type Section } from './geom';
import { paintFanFace, paintFin, paintFuselage } from './livery';
import type { Aircraft } from '../game/flight';

export const AXIS_HEIGHT = 3.2;
const NOSE_Z = -19.73;
const LENGTH = 39.47;
/** Main gear position along the fuselage: the aircraft pivots here on the ground. */
const MAIN_Z = 0.6;

// z, half-width, half-height, centre y
const FUSELAGE: [number, number, number, number][] = [
  [-19.73, 0.08, 0.08, -0.45],
  [-19.55, 0.5, 0.48, -0.42],
  [-19.2, 0.88, 0.86, -0.34],
  [-18.6, 1.25, 1.26, -0.22],
  [-17.8, 1.55, 1.6, -0.1],
  [-16.8, 1.76, 1.86, -0.02],
  [-15.5, 1.86, 1.98, 0.0],
  [-14.0, 1.88, 2.0, 0.0],
  [8.5, 1.88, 2.0, 0.0],
  [10.5, 1.84, 1.95, 0.08],
  [12.5, 1.68, 1.72, 0.32],
  [14.5, 1.4, 1.38, 0.62],
  [16.5, 1.02, 0.98, 0.95],
  [18.3, 0.62, 0.58, 1.22],
  [19.4, 0.32, 0.3, 1.38],
  [19.74, 0.12, 0.12, 1.42],
];

interface WingStation {
  x: number;
  y: number;
  le: number; // leading-edge z
  chord: number;
  t: number; // thickness ratio
}

/** Slice of an airfoil between chord fractions f0..f1, as a closed ring. */
function airfoilSlice(chord: number, t: number, f0: number, f1: number, n = 10): [number, number][] {
  // airfoil() gives the upper surface TE→LE (41 pts) then the lower LE→TE without its ends.
  const full = airfoil(chord, t, 40);
  const upper = full.slice(0, 41).reverse();
  const lower = [upper[0], ...full.slice(41), upper[40]];
  const interp = (pts: [number, number][], x: number) => {
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][0] >= x) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i];
        return y0 + ((x - x0) / Math.max(1e-6, x1 - x0)) * (y1 - y0);
      }
    }
    return pts[pts.length - 1][1];
  };
  const xs: number[] = [];
  for (let i = 0; i <= n; i++) {
    const k = f0 === 0 ? (1 - Math.cos((i / n) * Math.PI * 0.5)) : i / n;
    xs.push((f0 + (f1 - f0) * k) * chord);
  }
  const top = xs.map((x) => [x, interp(upper, x)] as [number, number]);
  const bottom = xs.map((x) => [x, interp(lower, x)] as [number, number]);
  return [...top.reverse(), ...bottom.slice(f0 === 0 ? 1 : 0)];
}

function wingSections(stations: WingStation[], side: 1 | -1, f0: number, f1: number): Section[] {
  return stations.map((s) => ({
    center: new THREE.Vector3(s.x * side, s.y, s.le),
    ring: airfoilSlice(s.chord, s.t, f0, f1),
    ax: new THREE.Vector3(0, 0, 1),
    ay: new THREE.Vector3(0, 1, 0),
  }));
}

/** A hinged control surface (flap, aileron, elevator) built around its hinge line. */
function controlSurface(stations: WingStation[], side: 1 | -1, f0: number, mat: THREE.Material): { pivot: THREE.Group; axis: THREE.Vector3 } {
  const a = stations[0];
  const b = stations[stations.length - 1];
  const hingeA = new THREE.Vector3(a.x * side, a.y, a.le + a.chord * f0);
  const hingeB = new THREE.Vector3(b.x * side, b.y, b.le + b.chord * f0);
  const sections = wingSections(stations, side, f0, 1).map((s) => ({ ...s, center: s.center.clone().sub(hingeA) }));
  const geo = loft(sections, { capStart: true, capEnd: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  const pivot = new THREE.Group();
  pivot.position.copy(hingeA);
  pivot.add(mesh);
  const axis = hingeB.clone().sub(hingeA).normalize();
  if (axis.x < 0) axis.negate();
  return { pivot, axis };
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class AircraftModel {
  /** Placed at the aircraft reference point with heading applied. */
  readonly root = new THREE.Group();
  /** Pitch and bank are applied here. */
  readonly pivot = new THREE.Group();
  /** Fuselage-axis origin. */
  readonly body = new THREE.Group();

  private fans: THREE.Group[] = [];
  private flaps: { pivot: THREE.Group; axis: THREE.Vector3 }[] = [];
  private ailerons: { pivot: THREE.Group; axis: THREE.Vector3; side: number }[] = [];
  private elevators: { pivot: THREE.Group; axis: THREE.Vector3 }[] = [];
  private mainGear: { group: THREE.Group; side: number }[] = [];
  private noseGear!: THREE.Group;
  private strobes: THREE.Sprite[] = [];
  private beacons: THREE.Sprite[] = [];
  private landingLights: THREE.Sprite[] = [];
  private fanAngle = 0;
  private airborne = 0;

  constructor() {
    this.root.add(this.pivot);
    this.pivot.add(this.body);
    this.pivot.rotation.order = 'YXZ';

    const fuselageMat = new THREE.MeshStandardMaterial({ map: paintFuselage(), roughness: 0.3, metalness: 0.05 });
    const plainWhite = new THREE.MeshStandardMaterial({ color: '#f4f5f7', roughness: 0.32, metalness: 0.05 });
    const wingGrey = new THREE.MeshStandardMaterial({ color: '#cdd2d8', roughness: 0.38, metalness: 0.25 });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#1e2024', roughness: 0.55, metalness: 0.2 });
    const metalMat = new THREE.MeshStandardMaterial({ color: '#b9bec6', roughness: 0.3, metalness: 0.7 });
    const tyreMat = new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.9 });

    // ---- fuselage
    const fuselage = loft(
      FUSELAGE.map(([z, rx, ry, cy]) => ({
        center: new THREE.Vector3(0, cy, z),
        ring: ellipse(rx, ry, 64, 0.04),
        ax: new THREE.Vector3(1, 0, 0),
        ay: new THREE.Vector3(0, 1, 0),
      })),
      { uv: (si, ri) => [(FUSELAGE[si][0] - NOSE_Z) / LENGTH, ri / 64] },
    );
    this.addMesh(fuselage, fuselageMat);
    // Wing-to-body fairing under the centre section.
    const fairing = new THREE.Mesh(new THREE.CapsuleGeometry(1.3, 8.5, 8, 20), plainWhite);
    fairing.rotation.x = Math.PI / 2;
    fairing.scale.set(1.45, 1, 0.55);
    fairing.position.set(0, -1.55, -1.2);
    fairing.castShadow = true;
    this.body.add(fairing);

    // ---- wings (low-mounted, swept, with dihedral), flaps, ailerons, blended winglets
    const wing: WingStation[] = [
      { x: 0, y: -1.25, le: -5.3, chord: 7.6, t: 0.15 },
      { x: 1.9, y: -1.05, le: -5.0, chord: 7.3, t: 0.15 },
      { x: 6.0, y: -0.62, le: -2.9, chord: 5.4, t: 0.13 },
      { x: 12.0, y: -0.0, le: 0.16, chord: 3.0, t: 0.11 },
      { x: 17.16, y: 0.55, le: 2.79, chord: 1.25, t: 0.1 },
    ];
    for (const side of [1, -1] as const) {
      this.addMesh(loft(wingSections(wing, side, 0, 0.75), { capEnd: true }), wingGrey);
      const flap = controlSurface(wing.slice(1, 4), side, 0.75, wingGrey);
      this.body.add(flap.pivot);
      this.flaps.push(flap);
      const ail = controlSurface([wing[3], wing[4]], side, 0.75, wingGrey);
      this.body.add(ail.pivot);
      this.ailerons.push({ ...ail, side });

      // Blended winglet: the tip section rolls up through 90° to a near-vertical fin.
      const tip = wing[4];
      const winglet: Section[] = [0, 0.35, 0.7, 1].map((k) => {
        const a = (k * Math.PI) / 2 * 0.92;
        const r = 0.9;
        const chord = tip.chord * (1 - 0.55 * k);
        return {
          center: new THREE.Vector3((tip.x + Math.sin(a) * r * 0.6 + k * 0.4) * side, tip.y + (1 - Math.cos(a)) * r + k * 1.5, tip.le + k * 1.7),
          ring: airfoilSlice(chord, 0.09, 0, 1),
          ax: new THREE.Vector3(0, 0, 1),
          ay: new THREE.Vector3(-Math.sin(a) * side, Math.cos(a), 0),
        };
      });
      this.addMesh(loft(winglet, { capEnd: true }), plainWhite);

      // CFM56-7B: flattened intake, fan, pylon, exhaust cone.
      const x = 4.9 * side;
      const cy = -1.75;
      const nacelleProfile: [number, number][] = [
        [-6.45, 0.74],
        [-6.3, 0.86],
        [-5.9, 0.95],
        [-4.9, 0.97],
        [-3.7, 0.93],
        [-2.7, 0.82],
        [-2.1, 0.68],
        [-2.0, 0.56],
        [-1.1, 0.5],
        [-0.5, 0.36],
        [-0.15, 0.12],
      ];
      const nacelle = loft(
        nacelleProfile.map(([z, r]) => ({
          center: new THREE.Vector3(x, cy, z),
          ring: ellipse(r * 1.04, r * 0.92, 32, 0.18),
          ax: new THREE.Vector3(1, 0, 0),
          ay: new THREE.Vector3(0, 1, 0),
        })),
        { capEnd: true },
      );
      this.addMesh(nacelle, plainWhite);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.07, 10, 32), metalMat);
      lip.position.set(x, cy, -6.42);
      lip.scale.set(1.04, 0.92, 1);
      this.body.add(lip);
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.0, 4.4), plainWhite);
      pylon.position.set(x, cy + 1.0, -3.4);
      pylon.rotation.x = -0.08;
      pylon.castShadow = true;
      this.body.add(pylon);

      const fan = new THREE.Group();
      fan.position.set(x, cy, -6.1);
      const face = new THREE.Mesh(
        new THREE.CircleGeometry(0.76, 40),
        new THREE.MeshStandardMaterial({ map: paintFanFace(), roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }),
      );
      fan.add(face);
      const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.55, 24), new THREE.MeshStandardMaterial({ color: '#2a2d33', roughness: 0.4, metalness: 0.6 }));
      spinner.rotation.x = -Math.PI / 2;
      spinner.position.z = -0.27;
      fan.add(spinner);
      const swirl = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.12, 3, 1, 0, Math.PI * 0.6), new THREE.MeshBasicMaterial({ color: '#f4f5f7', side: THREE.DoubleSide }));
      swirl.position.z = -0.555;
      fan.add(swirl);
      this.body.add(fan);
      this.fans.push(fan);
    }

    // ---- tail: tall swept fin with dorsal fillet, low-set swept stabilisers with elevators
    const finShape = new THREE.Shape();
    const finPts: [number, number][] = [
      [8.0, 1.95],
      [11.5, 2.35],
      [12.9, 3.1],
      [17.7, 9.3],
      [19.5, 9.3],
      [19.65, 8.9],
      [19.35, 1.5],
      [8.0, 1.5],
    ];
    finShape.moveTo(-finPts[0][0], finPts[0][1]);
    for (const [z, y] of finPts.slice(1)) finShape.lineTo(-z, y);
    const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2 });
    finGeo.rotateY(Math.PI / 2);
    finGeo.translate(-0.15, 0, 0);
    finGeo.computeBoundingBox();
    {
      const bb = finGeo.boundingBox!;
      const pos = finGeo.attributes.position;
      const uv = finGeo.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        uv.setXY(i, (pos.getZ(i) - bb.min.z) / (bb.max.z - bb.min.z), (pos.getY(i) - bb.min.y) / (bb.max.y - bb.min.y));
      }
      uv.needsUpdate = true;
    }
    this.addMesh(finGeo, new THREE.MeshStandardMaterial({ map: paintFin(), roughness: 0.32, metalness: 0.05 }));

    const stab: WingStation[] = [
      { x: 0, y: 1.0, le: 14.4, chord: 4.4, t: 0.1 },
      { x: 7.18, y: 1.9, le: 18.6, chord: 1.3, t: 0.09 },
    ];
    for (const side of [1, -1] as const) {
      this.addMesh(loft(wingSections(stab, side, 0, 0.7), { capEnd: true }), plainWhite);
      this.elevators.push(controlSurface(stab, side, 0.7, plainWhite));
      this.body.add(this.elevators[this.elevators.length - 1].pivot);
    }

    // ---- gear: mains fold inwards into the wing root (no doors), nose gear forwards
    const wheelY = -AXIS_HEIGHT + 0.57;
    for (const side of [1, -1] as const) {
      const gear = new THREE.Group();
      gear.position.set(2.86 * side, -1.3, MAIN_Z);
      const len = -1.3 - wheelY;
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, len, 12), metalMat);
      strut.position.y = -len / 2;
      gear.add(strut);
      for (const dx of [-0.43, 0.43]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.57, 0.57, 0.42, 22), tyreMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(dx, -len, 0);
        wheel.castShadow = true;
        gear.add(wheel);
      }
      this.body.add(gear);
      this.mainGear.push({ group: gear, side });
    }
    this.noseGear = new THREE.Group();
    this.noseGear.position.set(0, -1.6, -15.0);
    const noseLen = -1.6 - (-AXIS_HEIGHT + 0.35);
    const noseStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, noseLen, 10), metalMat);
    noseStrut.position.y = -noseLen / 2;
    this.noseGear.add(noseStrut);
    for (const dx of [-0.22, 0.22]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.25, 18), tyreMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(dx, -noseLen, 0);
      wheel.castShadow = true;
      this.noseGear.add(wheel);
    }
    this.body.add(this.noseGear);
    // APU exhaust at the tail cone tip.
    const apu = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.3, 12), darkMat);
    apu.rotation.x = Math.PI / 2;
    apu.position.set(0, 1.42, 19.78);
    this.body.add(apu);

    // ---- lights
    const glow = glowTexture();
    const light = (color: string, pos: [number, number, number], size: number) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.position.set(...pos);
      s.scale.setScalar(size);
      this.body.add(s);
      return s;
    };
    light('#ff2a2a', [-17.3, 0.6, 3.2], 1.0);
    light('#2aff6a', [17.3, 0.6, 3.2], 1.0);
    this.strobes.push(light('#ffffff', [-17.4, 0.6, 3.6], 2.8), light('#ffffff', [17.4, 0.6, 3.6], 2.8), light('#ffffff', [0, 1.42, 19.8], 2.0));
    this.beacons.push(light('#ff3030', [0, 2.05, 1.0], 1.5), light('#ff3030', [0, -2.1, -3.0], 1.5));
    this.landingLights.push(light('#fff6dd', [0.0, -2.6, -15.0], 1.8), light('#fff6dd', [2.4, -1.15, -4.7], 1.6), light('#fff6dd', [-2.4, -1.15, -4.7], 1.6));
  }

  private addMesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.body.add(mesh);
    return mesh;
  }

  update(ac: Aircraft, dt: number, time: number, input: { roll: number; pitch: number }): void {
    this.root.position.set(ac.pos.x, ac.pos.y, ac.pos.z);
    this.root.rotation.y = (-ac.heading * Math.PI) / 180;

    // Rotate about the main wheels on the ground, about the centre of gravity in the air.
    this.airborne += ((ac.onGround ? 0 : 1) - this.airborne) * Math.min(1, dt * 2);
    const h = this.airborne;
    this.pivot.position.set(0, AXIS_HEIGHT * h, MAIN_Z * (1 - h));
    this.body.position.set(0, AXIS_HEIGHT * (1 - h), -MAIN_Z * (1 - h));
    this.pivot.rotation.x = (ac.pitch * Math.PI) / 180;
    this.pivot.rotation.z = (-ac.bank * Math.PI) / 180;

    // Fans: spin slower than real so the eye reads the motion.
    this.fanAngle += dt * (1.5 + ac.prop * 14);
    for (const f of this.fans) f.rotation.z = -this.fanAngle;

    const flap = (ac.flapAngle * Math.PI) / 180;
    for (const f of this.flaps) f.pivot.setRotationFromAxisAngle(f.axis, flap * 0.8);
    for (const a of this.ailerons) a.pivot.setRotationFromAxisAngle(a.axis, a.side * -input.roll * 0.3);
    for (const e of this.elevators) e.pivot.setRotationFromAxisAngle(e.axis, -input.pitch * 0.35);

    const g = ac.gear;
    for (const { group, side } of this.mainGear) {
      group.rotation.z = (-side * (1 - g) * Math.PI) / 2;
      group.visible = g > 0.03;
    }
    this.noseGear.rotation.x = ((1 - g) * Math.PI) / 2;
    this.noseGear.visible = g > 0.03;

    const strobeOn = time % 1.2 < 0.06 || (time % 1.2 > 0.14 && time % 1.2 < 0.2);
    for (const s of this.strobes) s.visible = strobeOn && ac.prop > 0.3;
    const beaconOn = time % 1.0 < 0.15;
    for (const b of this.beacons) b.visible = beaconOn;
    for (const l of this.landingLights) l.visible = g > 0.5 && ac.prop > 0.3;
  }
}
