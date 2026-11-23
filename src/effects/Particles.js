import * as THREE from 'three';

// ============================================================================
// Partículas livianas (un solo draw call): humo de neumáticos, polvo,
// chispas de choques y humo de motor dañado.
// ============================================================================

const TYPES = {
  smoke: { color: [0.85, 0.85, 0.85], size: [1.2, 4.5], life: [1.4, 2.4], alpha: 0.35, gravity: -0.6, drag: 1.5 },
  dust: { color: [0.62, 0.52, 0.38], size: [1.0, 3.5], life: [0.9, 1.6], alpha: 0.4, gravity: -0.2, drag: 2 },
  spark: { color: [1.0, 0.72, 0.3], size: [0.18, 0.05], life: [0.25, 0.6], alpha: 1, gravity: 9.8, drag: 0.5, additive: true },
  engine: { color: [0.25, 0.25, 0.25], size: [0.8, 3.2], life: [1.2, 2.2], alpha: 0.45, gravity: -1.2, drag: 1 },
  spray: { color: [0.78, 0.8, 0.84], size: [0.5, 2.6], life: [0.45, 0.85], alpha: 0.2, gravity: 1.2, drag: 2.5 },
  debris: { color: [0.2, 0.2, 0.22], size: [0.12, 0.1], life: [0.6, 1.0], alpha: 1, gravity: 9.8, drag: 0.2 },
};

export class Particles {
  constructor(scene, max = 700) {
    this.max = max;
    this.count = 0;
    this.p = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      uniforms: { scale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float size; attribute float alpha;
        varying vec3 vColor; varying float vAlpha;
        uniform float scale;
        void main() {
          vColor = color; vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d, d);
          if (r > 0.25) discard;
          float a = vAlpha * smoothstep(0.25, 0.05, r);
          gl_FragColor = vec4(vColor, a);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.material = mat;
    scene.add(this.points);
    this.enabled = 1;
  }

  emit(type, x, y, z, vx = 0, vy = 0, vz = 0, n = 1, spread = 0.6) {
    const T = TYPES[type];
    n = Math.ceil(n * this.enabled);
    for (let i = 0; i < n; i++) {
      if (this.p.length >= this.max) this.p.shift();
      const life = T.life[0] + Math.random() * (T.life[1] - T.life[0]);
      this.p.push({
        T, x, y, z,
        vx: vx + (Math.random() - 0.5) * spread * 2, vy: vy + Math.random() * spread, vz: vz + (Math.random() - 0.5) * spread * 2,
        life, age: 0,
      });
    }
  }

  update(dt, viewportHeight, fov) {
    this.material.uniforms.scale.value = viewportHeight / (2 * Math.tan((fov * Math.PI) / 360));
    let n = 0;
    const keep = [];
    for (const q of this.p) {
      q.age += dt;
      if (q.age >= q.life) continue;
      const T = q.T;
      q.vy -= T.gravity * dt;
      const d = Math.max(0, 1 - T.drag * dt);
      q.vx *= d; q.vz *= d; if (T.gravity < 0) q.vy *= d;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.y < 0.05 && T.gravity > 0) { q.y = 0.05; q.vy *= -0.3; q.vx *= 0.6; q.vz *= 0.6; }
      const t = q.age / q.life;
      this.pos[n * 3] = q.x; this.pos[n * 3 + 1] = q.y; this.pos[n * 3 + 2] = q.z;
      this.col[n * 3] = T.color[0]; this.col[n * 3 + 1] = T.color[1]; this.col[n * 3 + 2] = T.color[2];
      this.size[n] = T.size[0] + (T.size[1] - T.size[0]) * t;
      this.alpha[n] = T.alpha * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
      keep.push(q);
      n++;
    }
    this.p = keep;
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    for (const k of ['position', 'color', 'size', 'alpha']) g.attributes[k].needsUpdate = true;
  }
}
