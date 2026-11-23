import * as THREE from 'three';

// ============================================================================
// Cielo dinámico + ciclo día/noche: colores, sol/luna, estrellas, niebla.
// ============================================================================

const KEYS = [
  { h: 0, top: 0x04060f, hor: 0x111a30, sun: 0x8aa2ff, si: 0.35, amb: 0.48, gnd: 0x0b0d12 },
  { h: 4.8, top: 0x070b1d, hor: 0x23243f, sun: 0x8aa2ff, si: 0.32, amb: 0.46, gnd: 0x0d0f15 },
  { h: 6.0, top: 0x24406e, hor: 0xe99863, sun: 0xffa060, si: 0.9, amb: 0.55, gnd: 0x3a3028 },
  { h: 7.5, top: 0x447dc0, hor: 0xbcd3e6, sun: 0xffe4c0, si: 2.3, amb: 0.85, gnd: 0x5a5548 },
  { h: 12, top: 0x3a7ccd, hor: 0xc6dcf0, sun: 0xffffff, si: 3.0, amb: 1.0, gnd: 0x6a6458 },
  { h: 16.5, top: 0x4378bd, hor: 0xdcc8a8, sun: 0xffe2b5, si: 2.5, amb: 0.9, gnd: 0x625a4c },
  { h: 18.2, top: 0x2a3d70, hor: 0xff8448, sun: 0xff7a3a, si: 1.2, amb: 0.6, gnd: 0x4a3426 },
  { h: 19.4, top: 0x0f1735, hor: 0x48304f, sun: 0x9aa8ff, si: 0.38, amb: 0.5, gnd: 0x16141a },
  { h: 21, top: 0x04060f, hor: 0x111a30, sun: 0x8aa2ff, si: 0.35, amb: 0.48, gnd: 0x0b0d12 },
  { h: 24, top: 0x04060f, hor: 0x111a30, sun: 0x8aa2ff, si: 0.35, amb: 0.48, gnd: 0x0b0d12 },
];

const _a = new THREE.Color(), _b = new THREE.Color();

function sample(hour) {
  let i = 0;
  while (i < KEYS.length - 2 && hour >= KEYS[i + 1].h) i++;
  const k0 = KEYS[i], k1 = KEYS[i + 1];
  const t = THREE.MathUtils.clamp((hour - k0.h) / (k1.h - k0.h), 0, 1);
  const s = t * t * (3 - 2 * t);
  const mix = (p) => _a.setHex(k0[p]).lerp(_b.setHex(k1[p]), s).clone();
  return {
    top: mix('top'), hor: mix('hor'), sun: mix('sun'), gnd: mix('gnd'),
    si: k0.si + (k1.si - k0.si) * s, amb: k0.amb + (k1.amb - k0.amb) * s,
  };
}

export function nightFactor(hour) {
  if (hour >= 20.2 || hour < 5.2) return 1;
  if (hour >= 18) return (hour - 18) / 2.2;
  if (hour < 7) return 1 - (hour - 5.2) / 1.8;
  return 0;
}

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.uniforms = {
      topColor: { value: new THREE.Color() },
      horizonColor: { value: new THREE.Color() },
      groundColor: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color() },
      sunSize: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 groundColor;
        uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunSize;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = h > 0.0 ? mix(horizonColor, topColor, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(horizonColor, groundColor, clamp(-h * 4.0, 0.0, 1.0));
          float sd = max(dot(d, normalize(sunDir)), 0.0);
          col += sunColor * (pow(sd, 900.0 / sunSize) * 4.0 + pow(sd, 12.0) * 0.28 * step(0.0, sunDir.y + 0.1));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    // estrellas
    const n = 900;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random(), v = Math.random() * 0.95 + 0.05;
      const th = u * Math.PI * 2, ph = Math.acos(v);
      pos[i * 3] = Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = Math.cos(ph);
      pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;
    scene.add(this.stars);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.target = new THREE.Object3D();
    scene.add(this.sun, this.sun.target);
    this.fogColor = new THREE.Color();
    scene.fog = new THREE.Fog(0xaaaaaa, 100, 400);
    this.sunDir = new THREE.Vector3();
    this.night = 0;
  }

  configureShadows(enabled, mapSize, extent) {
    this.sun.castShadow = enabled;
    if (!enabled) return;
    const s = this.sun.shadow;
    if (s.map && s.mapSize.x !== mapSize) {
      s.map.dispose();
      s.map = null;
    }
    s.mapSize.set(mapSize, mapSize);
    s.camera.left = -extent; s.camera.right = extent;
    s.camera.top = extent; s.camera.bottom = -extent;
    s.camera.near = 1; s.camera.far = 420;
    s.camera.updateProjectionMatrix();
    s.bias = -0.0004;
    s.normalBias = 0.6;
    this.shadowExtent = extent;
  }

  update(hour, camera, focus, drawDistance) {
    const k = sample(hour);
    this.night = nightFactor(hour);
    // sol: sale por el este (+X) a las 6, se pone al oeste a las 18:30
    const dayT = (hour - 6) / 12.5;
    const elev = Math.sin(Math.PI * THREE.MathUtils.clamp(dayT, -0.2, 1.2));
    const az = Math.PI * dayT;
    this.sunDir.set(Math.cos(az), Math.max(elev, -0.3), -0.35).normalize();
    const isDay = this.sunDir.y > 0.02;
    // de noche la luz direccional es la luna (opuesta y azulada)
    const lightDir = isDay ? this.sunDir : new THREE.Vector3(-this.sunDir.x * 0.6, 0.75, 0.3).normalize();

    this.uniforms.topColor.value.copy(k.top);
    this.uniforms.horizonColor.value.copy(k.hor);
    this.uniforms.groundColor.value.copy(k.gnd);
    this.uniforms.sunDir.value.copy(this.sunDir);
    this.uniforms.sunColor.value.copy(k.sun).multiplyScalar(isDay ? 1 : 0);
    this.starMat.opacity = this.night * 0.9;

    this.hemi.color.copy(k.top).lerp(new THREE.Color(0xffffff), 0.45);
    this.hemi.groundColor.copy(k.gnd);
    this.hemi.intensity = k.amb * 1.25;
    this.sun.color.copy(k.sun);
    this.sun.intensity = k.si;

    // niebla del mismo color que el horizonte: los edificios lejanos se funden con el cielo
    this.fogColor.copy(k.hor);
    this.scene.fog.color.copy(this.fogColor);
    this.uniforms.groundColor.value.copy(k.hor);
    this.scene.fog.near = drawDistance * 0.3;
    this.scene.fog.far = drawDistance * 0.97;

    // domo y estrellas siguen a la cámara
    const r = camera.far * 0.9;
    this.dome.position.copy(camera.position);
    this.dome.scale.setScalar(r);
    this.stars.position.copy(camera.position);
    this.stars.scale.setScalar(r * 0.98);

    // luz direccional centrada en el foco, ajustada a la grilla de texels (sin parpadeo)
    const target = this.sun.target.position;
    target.copy(focus);
    if (this.sun.castShadow && this.shadowExtent) {
      const texel = (this.shadowExtent * 2) / this.sun.shadow.mapSize.x;
      target.x = Math.round(target.x / texel) * texel;
      target.z = Math.round(target.z / texel) * texel;
    }
    this.sun.position.copy(target).addScaledVector(lightDir, 200);
    this.sun.target.updateMatrixWorld();
  }
}
