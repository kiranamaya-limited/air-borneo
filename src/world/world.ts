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
    this.airports = new Airports(mission.route);
    this.scene.add(this.airports.group);
    this.scene.add(buildCities(this.field));
    this.scene.add(buildClouds(mission.route, mission.weather.stormCore));
    this.markers = new MarkerTrail(mission.markers);
    this.scene.add(this.markers.group);
    this.scene.add(this.rain.mesh);
    this.lightning = new Lightning(mission.weather.stormCore);
    this.scene.add(this.lightning.group);
    this.scene.add(this.plane.root);

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
    if (e.type === 'phase' && e.phase === 'lineup') this.markers.reset();
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
  }

  render(): void {
    this.renderer.render(this.scene, this.rig.camera);
  }
}
