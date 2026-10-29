import * as THREE from 'three';
import { SEA_LEVEL } from './heightfield';

/** Tropical sea: animated normals, fresnel sky reflection and a sun glint. Follows the camera. */
export class Ocean {
  readonly mesh: THREE.Mesh;
  private readonly uniforms: Record<string, THREE.IUniform>;

  constructor(sunDir: THREE.Vector3) {
    this.uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uSun: { value: sunDir.clone() },
        uDeep: { value: new THREE.Color('#0a4a63') },
        uShallow: { value: new THREE.Color('#1c8597') },
        uSky: { value: new THREE.Color('#bcd7e4') },
        uStorm: { value: 0 },
      },
    ]);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      fog: true,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        #include <fog_pars_vertex>
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vec4 mvPosition = viewMatrix * world;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uSun;
        uniform vec3 uDeep;
        uniform vec3 uShallow;
        uniform vec3 uSky;
        uniform float uStorm;
        varying vec3 vWorld;
        #include <fog_pars_fragment>

        vec2 wave(vec2 p, vec2 dir, float freq, float speed, float amp) {
          float ph = dot(p, dir) * freq + uTime * speed;
          return dir * cos(ph) * amp * freq;
        }

        void main() {
          vec2 p = vWorld.xz;
          vec2 slope = vec2(0.0);
          slope += wave(p, normalize(vec2(0.8, 0.6)), 0.021, 1.1, 1.6);
          slope += wave(p, normalize(vec2(-0.3, 1.0)), 0.047, 1.7, 0.6);
          slope += wave(p, normalize(vec2(1.0, -0.2)), 0.11, 2.6, 0.18);
          slope += wave(p, normalize(vec2(0.2, -1.0)), 0.29, 3.9, 0.05);
          slope *= 1.0 + uStorm * 1.5;
          vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
          vec3 view = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - max(dot(n, view), 0.0), 4.0);
          float depthMix = 0.45 + 0.55 * smoothstep(-0.2, 1.0, n.y * 0.5 + 0.5);
          vec3 water = mix(uShallow, uDeep, depthMix);
          vec3 col = mix(water, uSky, clamp(fres * 0.85 + 0.08, 0.0, 1.0));
          vec3 h = normalize(uSun + view);
          float spec = pow(max(dot(n, h), 0.0), 220.0) * 2.4 * (1.0 - uStorm);
          col += vec3(1.0, 0.96, 0.86) * spec;
          col = mix(col, col * 0.55, uStorm);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000, 1, 1), mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = SEA_LEVEL;
    this.mesh.name = 'ocean';
  }

  update(time: number, camera: THREE.Camera, storm: number, sky: THREE.Color): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uStorm.value = storm;
    (this.uniforms.uSky.value as THREE.Color).copy(sky);
    this.mesh.position.x = Math.round(camera.position.x / 100) * 100;
    this.mesh.position.z = Math.round(camera.position.z / 100) * 100;
  }
}
