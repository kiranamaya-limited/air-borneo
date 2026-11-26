/** Rain streaks around the camera and lightning bolts inside the storm cell. */
import * as THREE from 'three';

export class Rain {
  readonly mesh: THREE.LineSegments;
  private readonly uniforms: Record<string, THREE.IUniform>;

  constructor(count = 5000) {
    const pos = new Float32Array(count * 6);
    const seed = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 260;
      const y = Math.random() * 220;
      const z = (Math.random() - 0.5) * 260;
      pos.set([x, y, z, x, y, z], i * 6);
      seed.set([0, 1], i * 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(seed, 1));
    this.uniforms = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector3() },
      uIntensity: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCenter;
        uniform vec3 uWind;
        attribute float aEnd;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          float fall = 70.0;
          p.y = mod(p.y - uTime * fall, 220.0) - 110.0;
          vec3 vel = vec3(uWind.x, -fall, uWind.z);
          p += aEnd * vel * 0.045;
          vec3 world = vec3(
            uCenter.x + mod(p.x - uCenter.x + 130.0, 260.0) - 130.0,
            uCenter.y + p.y,
            uCenter.z + mod(p.z - uCenter.z + 130.0, 260.0) - 130.0
          );
          vAlpha = 1.0 - smoothstep(60.0, 130.0, length(world - uCenter));
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uIntensity;
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(0.82, 0.86, 0.92, 0.55 * uIntensity * vAlpha);
        }
      `,
    });
    this.mesh = new THREE.LineSegments(geo, mat);
    this.mesh.frustumCulled = false;
  }

  update(time: number, center: THREE.Vector3, wind: { x: number; z: number }, intensity: number): void {
    this.uniforms.uTime.value = time;
    (this.uniforms.uCenter.value as THREE.Vector3).copy(center);
    (this.uniforms.uWind.value as THREE.Vector3).set(wind.x, 0, wind.z);
    this.uniforms.uIntensity.value = intensity;
    this.mesh.visible = intensity > 0.01;
  }
}

export class Lightning {
  readonly group = new THREE.Group();
  private life = 0;
  private readonly mat = new THREE.LineBasicMaterial({ color: '#eaf0ff', transparent: true });

  constructor(private readonly core: { x: number; z: number }) {}

  strike(): void {
    this.group.clear();
    const pts: THREE.Vector3[] = [];
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 600;
    let x = this.core.x + Math.cos(a) * r;
    let z = this.core.z + Math.sin(a) * r;
    for (let y = 900; y > -2; y -= 40 + Math.random() * 60) {
      pts.push(new THREE.Vector3(x, y, z));
      x += (Math.random() - 0.5) * 70;
      z += (Math.random() - 0.5) * 70;
    }
    pts.push(new THREE.Vector3(x, -2, z));
    this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.mat));
    this.life = 0.25;
  }

  update(dt: number): void {
    this.life = Math.max(0, this.life - dt);
    this.mat.opacity = this.life > 0 ? 0.6 + Math.random() * 0.4 : 0;
    this.group.visible = this.life > 0;
  }
}
