/**
 * Procedural ATR 72-500F at real dimensions: 27.17 m long, 27.05 m span, 7.65 m tall.
 * High straight wing with black de-icing boots, two PW127 nacelles with six-blade props,
 * T-tail with dorsal fillet, main gear retracting into fuselage sponsons, passenger windows.
 *
 * Local axes: nose towards -z, right wing +x, up +y. The fuselage axis is 2.45 m above the
 * main wheels' contact point.
 */
import * as THREE from 'three';
import { airfoil, ellipse, loft, type Section } from './geom';
import { paintFin, paintFuselage, paintPropDisc } from './livery';
import type { Aircraft } from '../game/flight';

const AXIS_HEIGHT = 2.45;
const NOSE_Z = -13.58;
const LENGTH = 27.16;

// z, half-width, half-height, centre y
const FUSELAGE: [number, number, number, number][] = [
  [-13.58, 0.06, 0.06, -0.22],
  [-13.47, 0.42, 0.38, -0.2],
  [-13.25, 0.7, 0.64, -0.15],
  [-12.9, 0.95, 0.9, -0.08],
  [-12.4, 1.17, 1.14, -0.02],
  [-11.7, 1.33, 1.33, 0.0],
  [-10.6, 1.42, 1.42, 0.02],
  [-6.0, 1.43, 1.43, 0.02],
  [4.6, 1.43, 1.43, 0.02],
  [6.6, 1.37, 1.35, 0.09],
  [8.6, 1.2, 1.12, 0.3],
  [10.6, 0.94, 0.84, 0.6],
  [12.2, 0.64, 0.54, 0.92],
  [13.2, 0.38, 0.3, 1.12],
  [13.58, 0.1, 0.08, 1.2],
];

const BOOT = new THREE.Color('#2a2c30');
const WHITE = new THREE.Color('#f4f5f7');

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

/** Black pneumatic de-icing boots along the leading edge, as on every ATR. */
function bootColor(stations: WingStation[], f1: number) {
  const rings = stations.map((s) => airfoilSlice(s.chord, s.t, 0, f1));
  return (si: number, ri: number) => (rings[si][ri][0] / stations[si].chord < 0.07 ? BOOT : WHITE);
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

  private props: { group: THREE.Group; blades: THREE.Group; disc: THREE.Mesh }[] = [];
  private flaps: { pivot: THREE.Group; axis: THREE.Vector3 }[] = [];
  private ailerons: { pivot: THREE.Group; axis: THREE.Vector3; side: number }[] = [];
  private elevators: { pivot: THREE.Group; axis: THREE.Vector3 }[] = [];
  private mainGear: THREE.Group[] = [];
  private noseGear!: THREE.Group;
  private strobes: THREE.Sprite[] = [];
  private beacons: THREE.Sprite[] = [];
  private landingLights: THREE.Sprite[] = [];
  private cargoDoor!: THREE.Group;
  private propAngle = 0;
  private airborne = 0;

  constructor() {
    this.root.add(this.pivot);
    this.pivot.add(this.body);
    this.pivot.rotation.order = 'YXZ';

    const fuselageMat = new THREE.MeshStandardMaterial({ map: paintFuselage(), roughness: 0.3, metalness: 0.05 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: '#f4f5f7', roughness: 0.32, metalness: 0.05, vertexColors: true });
    const plainWhite = new THREE.MeshStandardMaterial({ color: '#f4f5f7', roughness: 0.32, metalness: 0.05 });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#1e2024', roughness: 0.55, metalness: 0.2 });
    const metalMat = new THREE.MeshStandardMaterial({ color: '#b9bec6', roughness: 0.3, metalness: 0.7 });
    const tyreMat = new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.9 });

    // ---- fuselage
    const fuselage = loft(
      FUSELAGE.map(([z, rx, ry, cy]) => ({
        center: new THREE.Vector3(0, cy, z),
        ring: ellipse(rx, ry, 56, 0.06),
        ax: new THREE.Vector3(1, 0, 0),
        ay: new THREE.Vector3(0, 1, 0),
      })),
      { uv: (si, ri) => [(FUSELAGE[si][0] - NOSE_Z) / LENGTH, ri / 56] },
    );
    this.addMesh(fuselage, fuselageMat);

    // ---- wings (high-mounted), flaps and ailerons
    const wing: WingStation[] = [
      { x: 0, y: 1.55, le: -2.3, chord: 2.6, t: 0.18 },
      { x: 1.5, y: 1.55, le: -2.3, chord: 2.6, t: 0.18 },
      { x: 4.1, y: 1.57, le: -2.25, chord: 2.45, t: 0.17 },
      { x: 9.0, y: 1.78, le: -2.05, chord: 1.95, t: 0.15 },
      { x: 13.52, y: 1.98, le: -1.8, chord: 1.4, t: 0.13 },
    ];
    for (const side of [1, -1] as const) {
      const main = loft(wingSections(wing, side, 0, 0.74), { capEnd: true, color: bootColor(wing, 0.74) });
      this.addMesh(main, whiteMat);
      const flapStations = wing.slice(1, 4);
      const flap = controlSurface(flapStations, side, 0.74, plainWhite);
      this.body.add(flap.pivot);
      this.flaps.push(flap);
      const ail = controlSurface([wing[3], wing[4]], side, 0.74, plainWhite);
      this.body.add(ail.pivot);
      this.ailerons.push({ ...ail, side });

      // nacelle + spinner + propeller
      const x = 4.1 * side;
      const nacelleProfile: [number, number, number][] = [
        [-4.42, 0.36, 1.22],
        [-4.25, 0.5, 1.2],
        [-3.7, 0.6, 1.2],
        [-2.4, 0.62, 1.24],
        [-0.8, 0.6, 1.3],
        [0.6, 0.5, 1.38],
        [1.5, 0.3, 1.45],
        [1.95, 0.06, 1.48],
      ];
      const nacelle = loft(
        nacelleProfile.map(([z, r, cy]) => ({
          center: new THREE.Vector3(x, cy, z),
          ring: ellipse(r * 0.92, r, 28),
          ax: new THREE.Vector3(1, 0, 0),
          ay: new THREE.Vector3(0, 1, 0),
        })),
        { capStart: true },
      );
      this.addMesh(nacelle, plainWhite);
      const intake = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 1.0), darkMat);
      intake.position.set(x, 0.62, -3.6);
      this.body.add(intake);
      // exhaust stub
      const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.5, 12), darkMat);
      exhaust.rotation.x = Math.PI / 2;
      exhaust.position.set(x + 0.45 * side, 1.15, -0.4);
      this.body.add(exhaust);

      const prop = new THREE.Group();
      prop.position.set(x, 1.22, -4.48);
      const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.37, 0.75, 24), plainWhite);
      spinner.rotation.x = -Math.PI / 2;
      spinner.position.z = -0.37;
      prop.add(spinner);
      const bladeGeo = new THREE.BoxGeometry(0.2, 1.6, 0.05);
      bladeGeo.translate(0, 1.1, 0);
      const blades = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const blade = new THREE.Mesh(bladeGeo, darkMat);
        blade.rotation.z = (i / 6) * Math.PI * 2;
        blade.rotateY(0.35);
        blade.castShadow = true;
        blades.add(blade);
      }
      prop.add(blades);
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(1.97, 48),
        new THREE.MeshBasicMaterial({ map: paintPropDisc(), transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0 }),
      );
      disc.position.z = -0.05;
      prop.add(disc);
      this.body.add(prop);
      this.props.push({ group: prop, blades, disc });
    }

    // ---- tail: fin with dorsal fillet (extruded), T-tail stabiliser and elevators
    const finShape = new THREE.Shape();
    const finPts: [number, number][] = [
      [5.4, 1.35],
      [7.6, 1.7],
      [9.2, 2.35],
      [11.75, 5.08],
      [13.35, 5.08],
      [13.62, 4.7],
      [13.3, 1.25],
      [5.4, 1.25],
    ];
    finShape.moveTo(-finPts[0][0], finPts[0][1]);
    for (const [z, y] of finPts.slice(1)) finShape.lineTo(-z, y);
    const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.26, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 });
    finGeo.rotateY(Math.PI / 2);
    finGeo.translate(-0.13, 0, 0);
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
      { x: 0, y: 5.12, le: 11.85, chord: 1.65, t: 0.11 },
      { x: 3.65, y: 5.16, le: 12.55, chord: 1.0, t: 0.1 },
    ];
    for (const side of [1, -1] as const) {
      this.addMesh(loft(wingSections(stab, side, 0, 0.68), { capEnd: true, color: bootColor(stab, 0.68) }), whiteMat);
      this.elevators.push(controlSurface(stab, side, 0.68, plainWhite));
      this.body.add(this.elevators[this.elevators.length - 1].pivot);
    }
    // black boot on the fin leading edge
    const finBoot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 3.7, 8), darkMat);
    finBoot.position.set(0, 3.72, 10.47);
    finBoot.rotation.x = 0.75;
    this.body.add(finBoot);

    // ---- sponsons, gear
    for (const side of [1, -1] as const) {
      const sponson = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 2.9, 8, 16), plainWhite);
      sponson.rotation.x = Math.PI / 2;
      sponson.scale.set(0.62, 1, 0.85);
      sponson.position.set(1.18 * side, -1.02, 0.9);
      sponson.castShadow = true;
      this.body.add(sponson);

      const gear = new THREE.Group();
      gear.position.set(1.42 * side, -1.15, 0.9);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.9, 10), metalMat);
      strut.position.y = -0.45;
      gear.add(strut);
      for (const dz of [-0.25, 0.25]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.26, 20), tyreMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(0.05 * side, -0.88, dz);
        wheel.castShadow = true;
        gear.add(wheel);
      }
      this.body.add(gear);
      this.mainGear.push(gear);
    }
    this.noseGear = new THREE.Group();
    this.noseGear.position.set(0, -1.2, -11.0);
    const noseStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 10), metalMat);
    noseStrut.position.y = -0.45;
    this.noseGear.add(noseStrut);
    for (const dx of [-0.17, 0.17]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.18, 18), tyreMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(dx, -0.95, 0);
      wheel.castShadow = true;
      this.noseGear.add(wheel);
    }
    this.body.add(this.noseGear);

    // ---- forward cargo door (left side), opens upwards for unloading
    this.cargoDoor = new THREE.Group();
    this.cargoDoor.position.set(-1.43, 1.0, -9.35);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.75, 1.9), plainWhite);
    door.position.set(-0.02, -0.88, 0);
    this.cargoDoor.add(door);
    this.body.add(this.cargoDoor);

    // ---- lights
    const glow = glowTexture();
    const light = (color: string, pos: [number, number, number], size: number) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.position.set(...pos);
      s.scale.setScalar(size);
      this.body.add(s);
      return s;
    };
    light('#ff2a2a', [-13.55, 1.98, -1.4], 0.9);
    light('#2aff6a', [13.55, 1.98, -1.4], 0.9);
    this.strobes.push(light('#ffffff', [-13.6, 1.98, -0.6], 2.6), light('#ffffff', [13.6, 1.98, -0.6], 2.6), light('#ffffff', [0, 1.3, 13.62], 1.8));
    this.beacons.push(light('#ff3030', [0, 1.48, 1.5], 1.4), light('#ff3030', [0, -1.42, 0.5], 1.4));
    this.landingLights.push(light('#fff6dd', [0.0, -1.55, -11.0], 1.6), light('#fff6dd', [1.6, 1.3, -2.4], 1.4), light('#fff6dd', [-1.6, 1.3, -2.4], 1.4));
  }

  private addMesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.body.add(mesh);
    return mesh;
  }

  /** Cargo door 0 = closed, 1 = open. */
  setCargoDoor(open: number): void {
    this.cargoDoor.rotation.z = -open * 1.6;
    this.cargoDoor.visible = open > 0.02; // the closed door is painted on the livery
  }

  update(ac: Aircraft, dt: number, time: number, input: { roll: number; pitch: number }): void {
    this.root.position.set(ac.pos.x, ac.pos.y, ac.pos.z);
    this.root.rotation.y = (-ac.heading * Math.PI) / 180;

    // Rotate about the main wheels on the ground, about the centre of gravity in the air.
    this.airborne += ((ac.onGround ? 0 : 1) - this.airborne) * Math.min(1, dt * 2);
    const h = this.airborne;
    this.pivot.position.set(0, AXIS_HEIGHT * h, 0.9 * (1 - h));
    this.body.position.set(0, AXIS_HEIGHT * (1 - h), -0.9 * (1 - h));
    this.pivot.rotation.x = (ac.pitch * Math.PI) / 180;
    this.pivot.rotation.z = (-ac.bank * Math.PI) / 180;

    // Props: spin slower than real so the eye reads the motion, blur disc at speed.
    this.propAngle += dt * (2 + ac.prop * 30);
    const discOpacity = THREE.MathUtils.smoothstep(ac.prop, 0.3, 0.75);
    for (const p of this.props) {
      p.blades.rotation.z = -this.propAngle;
      (p.disc.material as THREE.MeshBasicMaterial).opacity = discOpacity * 0.9;
      p.blades.visible = discOpacity < 0.95;
    }

    const flap = (ac.flapAngle * Math.PI) / 180;
    for (const f of this.flaps) f.pivot.setRotationFromAxisAngle(f.axis, flap);
    for (const a of this.ailerons) a.pivot.setRotationFromAxisAngle(a.axis, a.side * -input.roll * 0.3);
    for (const e of this.elevators) e.pivot.setRotationFromAxisAngle(e.axis, -input.pitch * 0.35);

    const g = ac.gear;
    for (const m of this.mainGear) {
      m.rotation.x = (-(1 - g) * Math.PI) / 2;
      m.visible = g > 0.03;
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
