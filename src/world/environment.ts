import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

const FOG_CLEAR = new THREE.Color('#c6dbe6');
const FOG_STORM = new THREE.Color('#6f7c86');
const SKY_TINT = new THREE.Color('#bcd7e4');

/** Sky, sun, haze and lightning. A bright tropical morning, sun behind the westbound aircraft. */
export class Environment {
  readonly sunDir: THREE.Vector3;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fog: THREE.Fog;
  readonly skyColor = SKY_TINT.clone();
  private readonly sky: Sky;
  private readonly stormDome: THREE.Mesh;
  private flash = 0;
  storm = 0;

  constructor(private readonly scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    const elevation = 38;
    const azimuth = 105;
    const e = THREE.MathUtils.degToRad(elevation);
    const a = THREE.MathUtils.degToRad(azimuth);
    this.sunDir = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();

    this.sky = new Sky();
    this.sky.scale.setScalar(80000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4.5;
    u.rayleigh.value = 1.3;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(this.sunDir);
    scene.add(this.sky);

    // Image-based lighting from the sky, so the white fuselage picks up blue reflections.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(1000);
    envSky.material.uniforms.sunPosition.value.copy(this.sunDir);
    envSky.material.uniforms.turbidity.value = 4.5;
    envSky.material.uniforms.rayleigh.value = 1.3;
    envScene.add(envSky);
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    scene.environmentIntensity = 0.4;
    pmrem.dispose();

    this.stormDome = new THREE.Mesh(
      new THREE.SphereGeometry(40000, 24, 12),
      new THREE.MeshBasicMaterial({ color: '#4f5a63', side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, fog: false }),
    );
    this.stormDome.renderOrder = -1;
    scene.add(this.stormDome);

    this.hemi = new THREE.HemisphereLight('#dcecff', '#4d5a3a', 0.85);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff1da', 2.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -90;
    cam.right = cam.top = 90;
    cam.near = 10;
    cam.far = 1600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);

    this.fog = new THREE.Fog(FOG_CLEAR.clone(), 2500, 19000);
    scene.fog = this.fog;
  }

  lightning(): void {
    this.flash = 1;
  }

  update(dt: number, focus: THREE.Vector3, camera: THREE.Camera, weather: { rain: number; cloud: number }): void {
    const target = Math.min(1, Math.max(weather.cloud, weather.rain * 0.7));
    this.storm += (target - this.storm) * Math.min(1, dt * 1.5);
    const s = this.storm;
    this.flash = Math.max(0, this.flash - dt * 4);
    const f = this.flash * (0.6 + 0.4 * Math.sin(this.flash * 40));

    this.fog.color.copy(FOG_CLEAR).lerp(FOG_STORM, s).lerp(new THREE.Color('#dfe6ff'), f * 0.6);
    this.fog.near = THREE.MathUtils.lerp(2500, 90, s);
    this.fog.far = THREE.MathUtils.lerp(19000, 1900, s);
    this.skyColor.copy(SKY_TINT).lerp(FOG_STORM, s);
    (this.stormDome.material as THREE.MeshBasicMaterial).opacity = s * 0.85;
    this.stormDome.position.copy(camera.position);

    this.sun.intensity = 2.3 * (1 - s * 0.75) + f * 3;
    this.hemi.intensity = 0.85 * (1 - s * 0.35) + f * 2.5;

    this.sun.position.copy(focus).addScaledVector(this.sunDir, 800);
    this.sun.target.position.copy(focus);
    this.scene.environmentIntensity = 0.4 * (1 - s * 0.5);
  }
}
