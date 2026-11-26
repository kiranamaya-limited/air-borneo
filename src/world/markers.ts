/** The dotted line: glowing markers along the route, popping with a grade-coloured ring when flown through. */
import * as THREE from 'three';
import { brand } from '../brand/tokens';
import type { Marker } from '../game/mission';
import type { Grade } from '../game/scoring';

const GRADE_COLORS: Record<Grade, string> = {
  PERFECT: brand.colors.yellow,
  GOOD: '#ffffff',
  OK: '#ff9a3d',
  MISS: brand.colors.red,
};

interface Pop {
  sprite: THREE.Sprite;
  life: number;
}

function ringTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.stroke();
  return new THREE.CanvasTexture(c);
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class MarkerTrail {
  readonly group = new THREE.Group();
  private readonly dots: THREE.InstancedMesh;
  private readonly halos: THREE.InstancedMesh;
  private readonly pops: Pop[] = [];
  private readonly ring = ringTexture();
  private readonly base = new THREE.Color(brand.colors.yellow);
  private readonly next = new THREE.Color('#fff3c4');
  private readonly missed = new THREE.Color('#9aa0a6');

  constructor(private readonly markers: Marker[]) {
    const n = markers.length;
    this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(1.5, 12, 8), new THREE.MeshBasicMaterial({ toneMapped: false }), n);
    this.halos = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshBasicMaterial({ map: glowTexture(), color: brand.colors.yellow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55, fog: true }),
      n,
    );
    this.dots.frustumCulled = false;
    this.halos.frustumCulled = false;
    this.group.add(this.halos, this.dots);
    this.reset();
  }

  reset(): void {
    const m = new THREE.Matrix4();
    this.markers.forEach((mk, i) => {
      m.makeTranslation(mk.x, mk.y, mk.z);
      this.dots.setMatrixAt(i, m);
      this.dots.setColorAt(i, this.base);
      this.halos.setMatrixAt(i, m);
    });
    this.dots.instanceMatrix.needsUpdate = true;
    this.halos.instanceMatrix.needsUpdate = true;
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
    for (const p of this.pops) this.group.remove(p.sprite);
    this.pops.length = 0;
  }

  /** A marker was flown through. */
  collect(index: number, grade: Grade): void {
    const mk = this.markers[index];
    const m = new THREE.Matrix4();
    if (grade === 'MISS') {
      m.compose(new THREE.Vector3(mk.x, mk.y, mk.z), new THREE.Quaternion(), new THREE.Vector3(0.45, 0.45, 0.45));
      this.dots.setMatrixAt(index, m);
      this.dots.setColorAt(index, this.missed);
    } else {
      m.makeScale(0, 0, 0);
      this.dots.setMatrixAt(index, m);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.ring, color: GRADE_COLORS[grade], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      sprite.position.set(mk.x, mk.y, mk.z);
      sprite.scale.setScalar(4);
      this.group.add(sprite);
      this.pops.push({ sprite, life: 1 });
    }
    m.makeScale(0, 0, 0);
    this.halos.setMatrixAt(index, m);
    this.dots.instanceMatrix.needsUpdate = true;
    this.halos.instanceMatrix.needsUpdate = true;
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
  }

  update(dt: number, camera: THREE.Camera, nextIndex: number): void {
    // Halos face the camera.
    const q = camera.quaternion;
    const m = new THREE.Matrix4();
    const s = new THREE.Vector3(1, 1, 1);
    const lo = Math.max(0, nextIndex - 2);
    const hi = Math.min(this.markers.length, nextIndex + 140);
    for (let i = lo; i < hi; i++) {
      const mk = this.markers[i];
      if (mk.grade) continue;
      const pulse = i === nextIndex ? 1.4 : 1;
      m.compose(new THREE.Vector3(mk.x, mk.y, mk.z), q, s.setScalar(pulse));
      this.halos.setMatrixAt(i, m);
      if (i < nextIndex + 3) this.dots.setColorAt(i, this.next);
    }
    this.halos.instanceMatrix.needsUpdate = true;
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;

    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.life -= dt * 1.8;
      p.sprite.scale.setScalar(4 + (1 - p.life) * 22);
      p.sprite.material.opacity = Math.max(0, p.life);
      if (p.life <= 0) {
        this.group.remove(p.sprite);
        p.sprite.material.dispose();
        this.pops.splice(i, 1);
      }
    }
  }
}
