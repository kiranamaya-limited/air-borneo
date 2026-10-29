/** Assembles the 3D world and keeps it in step with the mission. */
import * as THREE from 'three';
import type { Mission, MissionEvent } from '../game/mission';
import type { FlightInput } from '../game/flight';
import { AircraftModel } from './aircraft';
import { Airports } from './airports';
import { CameraRig } from './camera';
import { buildCities } from './cities';
import { buildClouds } from './clouds';
import { Environment } from './environment';
import { Heightfield } from './heightfield';
import { MarkerTrail } from './markers';
import { Ocean } from './ocean';
import { buildTerrain } from './terrain';
import { Lightning, Rain } from './weather';
import { brand } from '../brand/tokens';

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly field: Heightfield;
  readonly plane = new AircraftModel();
  private readonly env: Environment;
  private readonly ocean: Ocean;
  private readonly airports: Airports;
  private readonly markers: MarkerTrail;
  private readonly rain = new Rain();
  private readonly lightning: Lightning;
  private readonly cargo: THREE.Mesh[] = [];
  private unloadTime = -1;

  constructor(canvas: HTMLCanvasElement, private readonly mission: Mission, private quality: 'high' | 'low' = 'high') {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'high', logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(quality === 'high' ? Math.min(window.devicePixelRatio, 2) : 0.75);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.82;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.env = new Environment(this.scene, this.renderer);
    this.field = new Heightfield(mission.route);
    mission.ground = (x, z) => this.field.groundOrSea(x, z);

    this.ocean = new Ocean(this.env.sunDir);
    this.scene.add(this.ocean.mesh);
    this.scene.add(buildTerrain(this.field, mission.route));
    this.airports = new Airports(mission.changi);
    this.scene.add(this.airports.group);
    this.scene.add(buildCities(this.field));
    this.scene.add(buildClouds(mission.route, mission.weather.stormCore));
    this.markers = new MarkerTrail(mission.markers);
    this.scene.add(this.markers.group);
    this.scene.add(this.rain.mesh);
    this.lightning = new Lightning(mission.weather.stormCore);
    this.scene.add(this.lightning.group);
    this.scene.add(this.plane.root);

    // Fresh-produce containers for the unloading scene at Changi.
    const uldMats = [brand.colors.white, '#e8eef3', brand.colors.yellow].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.2 }));
    for (let i = 0; i < 4; i++) {
      const uld = new THREE.Mesh(new THREE.BoxGeometry(1.55, 1.6, 2.0), uldMats[i % uldMats.length]);
      uld.castShadow = true;
      uld.visible = false;
      this.cargo.push(uld);
      this.scene.add(uld);
    }

    window.addEventListener('resize', () => this.resize());
  }

  /** Step down for slower GPUs: lower resolution, no shadows. */
  lowerQuality(): void {
    if (this.quality === 'low') return;
    this.quality = 'low';
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = false;
    this.scene.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) m.needsUpdate = true;
    });
    this.resize();
  }

  resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.rig.camera.aspect = window.innerWidth / window.innerHeight;
    this.rig.camera.updateProjectionMatrix();
  }

  /** React to mission events (markers popping, lightning, touchdown bump). */
  onEvent(e: MissionEvent): void {
    if (e.type === 'marker') this.markers.collect(e.index, e.grade);
    if (e.type === 'lightning') {
      this.lightning.strike();
      this.env.lightning();
    }
    if (e.type === 'touchdown') this.rig.bump(e.grade === 'Hard' ? 1.6 : 0.5);
    if (e.type === 'tailstrike') this.rig.bump(1.2);
    if (e.type === 'crash') this.rig.bump(3);
    if (e.type === 'phase' && e.phase === 'intro') this.markers.reset();
    if (e.type === 'phase') {
      this.unloadTime = e.phase === 'results' ? 0 : -1;
      if (e.phase !== 'results') {
        this.plane.setCargoDoor(0);
        for (const c of this.cargo) c.visible = false;
      }
    }
  }

  update(dt: number, time: number, input: Pick<FlightInput, 'roll' | 'pitch'>): void {
    const m = this.mission;
    this.plane.update(m.ac, dt, time, input);
    const turb = ['flight', 'flare'].includes(m.phase) ? m.wx.turb : 0;
    this.rig.update(dt, m, turb);
    const cam = this.rig.camera;
    const focus = new THREE.Vector3(m.ac.pos.x, m.ac.pos.y, m.ac.pos.z);
    const wx = ['flight', 'flare'].includes(m.phase) ? m.wx : { rain: 0, cloud: 0, wind: { x: 0, y: 0, z: 0 } };
    this.env.update(dt, focus, cam, wx);
    this.ocean.update(time, cam, this.env.storm, this.env.skyColor);
    this.rain.update(time, cam.position, wx.wind, wx.rain);
    this.lightning.update(dt);
    this.airports.update(time, m.ac);
    this.markers.update(dt, cam, m.nextMarker);
    this.updateUnload(dt);
  }

  private updateUnload(dt: number): void {
    if (this.unloadTime < 0) return;
    this.unloadTime += dt;
    const t = this.unloadTime;
    this.plane.setCargoDoor(Math.min(1, t / 1.5));
    const body = this.plane.body;
    body.updateWorldMatrix(true, false);
    const door = body.localToWorld(new THREE.Vector3(-1.2, -0.7, -9.35));
    const out = new THREE.Vector3(-1, 0, 0).transformDirection(body.matrixWorld);
    const along = new THREE.Vector3(0, 0, 1).transformDirection(body.matrixWorld);
    this.cargo.forEach((c, i) => {
      const start = 1.6 + i * 1.3;
      const k = THREE.MathUtils.clamp((t - start) / 1.6, 0, 1);
      c.visible = t > start;
      const ease = k * k * (3 - 2 * k);
      c.position.copy(door).addScaledVector(out, 1 + ease * 7).addScaledVector(along, ease * (i * 2.4 - 3));
      c.position.y = Math.max(0.8, door.y - ease * (door.y - 0.8));
      c.quaternion.copy(this.plane.root.quaternion);
    });
  }

  render(): void {
    this.renderer.render(this.scene, this.rig.camera);
  }
}
