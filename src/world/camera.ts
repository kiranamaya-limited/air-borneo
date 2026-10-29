/** Third-person chase camera plus the cinematic shots for the intro, taxi-in and results. */
import * as THREE from 'three';
import type { Mission } from '../game/mission';

const DEG = Math.PI / 180;

function headingDir(h: number): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(h * DEG), 0, -Math.cos(h * DEG));
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private hdg = 0;
  private gamma = 0;
  private bank = 0;
  private shake = 0;
  private readonly look = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private orbit = 0;
  private lastPhase = '';

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.5, 70000);
  }

  bump(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  update(dt: number, mission: Mission, turb: number): void {
    const ac = mission.ac;
    const cam = this.camera;
    const p = new THREE.Vector3(ac.pos.x, ac.pos.y + 2.5, ac.pos.z);
    const phase = mission.phase;
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      this.hdg = ac.heading;
      this.gamma = ac.gamma;
      this.orbit = 0;
    }
    cam.up.set(0, 1, 0);
    let fov = 58;

    if (phase === 'pairing') {
      // Slow orbit around the ATR waiting on runway 25.
      this.orbit += dt * 0.06;
      const a = this.orbit + 0.9;
      cam.position.set(p.x + Math.sin(a) * 62, p.y + 14 + Math.sin(this.orbit * 0.7) * 4, p.z + Math.cos(a) * 62);
      cam.lookAt(p.x, p.y + 1, p.z);
    } else if (phase === 'results' || phase === 'crashed') {
      this.orbit += dt * 0.08;
      const a = this.orbit + ((-ac.heading - 120) * DEG);
      const dist = phase === 'crashed' ? 140 : 58;
      cam.position.set(p.x + Math.sin(a) * dist, Math.max(p.y + 16, 18), p.z + Math.cos(a) * dist);
      cam.lookAt(p.x, p.y, p.z);
      fov = 50;
    } else {
      // Chase: offset from a smoothed heading/flight path so turns read, without position lag.
      const k = 1 - Math.exp(-dt * 2.6);
      const dh = ((ac.heading - this.hdg + 540) % 360) - 180;
      this.hdg = (this.hdg + dh * k + 360) % 360;
      this.gamma += (ac.gamma - this.gamma) * k;
      this.bank += (ac.bank - this.bank) * (1 - Math.exp(-dt * 3));
      const ground = ac.onGround;
      const back = ground ? 34 : 42;
      const up = ground ? 8.5 : 10.5;
      const fwd = headingDir(this.hdg);
      const g = this.gamma * DEG * 0.8;
      const offset = fwd.clone().multiplyScalar(-back * Math.cos(g)).add(new THREE.Vector3(0, up - back * Math.sin(g), 0));
      cam.position.copy(p).add(offset);
      this.look.copy(p).addScaledVector(headingDir(ac.heading), 28).add(new THREE.Vector3(0, 2.5 + Math.sin(ac.gamma * DEG) * 28, 0));
      cam.lookAt(this.look);
      // Lean into turns a little.
      cam.rotateZ(-this.bank * DEG * 0.22);
      fov = 58 + Math.min(10, ac.speed / 22);
      if (phase === 'flare' || ac.pos.y < 40) fov -= 2;
    }

    // Turbulence and touchdown shake.
    const s = Math.max(this.shake, turb * 0.35);
    if (s > 0.001) {
      this.tmp.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
      cam.position.add(this.tmp);
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
    }
  }
}
