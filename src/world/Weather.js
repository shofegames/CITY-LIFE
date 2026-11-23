import * as THREE from 'three';

// ============================================================================
// Clima: despejado, nublado, lluvia y tormenta. Cambia solo cada tantas horas
// de juego. Controla nubes, gotas (todo animado en la GPU, sin costo de CPU),
// salpicaduras en el piso, calles mojadas y relámpagos.
// ============================================================================

export const WEATHER_TYPES = {
  clear: { label: 'Despejado', cloud: 0.22, rain: 0 },
  cloudy: { label: 'Nublado', cloud: 0.72, rain: 0 },
  rain: { label: 'Lluvia', cloud: 0.9, rain: 0.6 },
  storm: { label: 'Tormenta', cloud: 1, rain: 1, thunder: true },
};

// probabilidades del próximo clima según el actual (la lluvia viene después de nubes)
const NEXT = {
  clear: [['clear', 0.45], ['cloudy', 0.4], ['rain', 0.15]],
  cloudy: [['clear', 0.35], ['cloudy', 0.15], ['rain', 0.35], ['storm', 0.15]],
  rain: [['cloudy', 0.45], ['rain', 0.2], ['storm', 0.2], ['clear', 0.15]],
  storm: [['rain', 0.55], ['cloudy', 0.45]],
};

const BOX = new THREE.Vector3(46, 30, 46); // volumen de lluvia alrededor de la cámara

export class Weather {
  constructor(scene, quality) {
    this.scene = scene;
    this.type = 'clear';
    this.timer = 6 * 60; // segundos reales hasta el próximo cambio
    this.cloud = WEATHER_TYPES.clear.cloud;
    this.rain = 0;
    this.wet = 0; // qué tan mojado está el piso (tarda en secarse)
    this.flash = 0; // relámpago (0..1)
    this.flashTimer = 8;
    this.time = 0;
    this.pendingThunder = [];
    this.onThunder = null;
    this.buildRain();
    this.setQuality(quality);
  }

  // ------------------------------------------------------------------ mallas
  buildRain() {
    const max = 3600;
    const seeds = new Float32Array(max * 2 * 4);
    const ends = new Float32Array(max * 2);
    for (let i = 0; i < max; i++) {
      const s = [Math.random(), Math.random(), Math.random(), i / max];
      for (let k = 0; k < 2; k++) {
        seeds.set(s, (i * 2 + k) * 4);
        ends[i * 2 + k] = k;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 2 * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    g.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    this.rainUniforms = {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uBox: { value: BOX.clone() },
      uAmount: { value: 0 },
      uWind: { value: new THREE.Vector2(2.5, 1.2) },
      uColor: { value: new THREE.Color(0.75, 0.8, 0.88) },
      uOpacity: { value: 0.35 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.rainUniforms,
      transparent: true,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed; attribute float aEnd;
        uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform float uAmount; uniform vec2 uWind;
        varying float vAlpha;
        void main() {
          float speed = 22.0 + fract(aSeed.w * 97.13) * 8.0;
          vec3 vel = vec3(uWind.x, -speed, uWind.y);
          vec3 p = aSeed.xyz * uBox + vel * uTime;
          vec3 c = uCam + vec3(0.0, uBox.y * 0.3, 0.0);
          vec3 rel = mod(p - c + uBox * 0.5, uBox) - uBox * 0.5;
          vec3 world = c + rel + normalize(vel) * (0.55 + speed * 0.02) * aEnd;
          float edge = 1.0 - smoothstep(0.3, 0.5, length(rel.xz) / uBox.x);
          vAlpha = step(aSeed.w, uAmount) * edge * (0.25 + 0.75 * aEnd);
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uOpacity;
        varying float vAlpha;
        void main() {
          if (vAlpha < 0.01) discard;
          gl_FragColor = vec4(uColor, uOpacity * vAlpha);
          #include <colorspace_fragment>
        }`,
    });
    this.rainMesh = new THREE.LineSegments(g, mat);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.renderOrder = 6;
    this.rainMesh.visible = false;
    this.scene.add(this.rainMesh);

    // salpicaduras: anillitos que aparecen y se abren en el piso cerca del jugador
    const smax = 600;
    const sseed = new Float32Array(smax * 4);
    for (let i = 0; i < smax; i++) sseed.set([Math.random(), Math.random(), Math.random(), i / smax], i * 4);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(smax * 3), 3));
    sg.setAttribute('aSeed', new THREE.BufferAttribute(sseed, 4));
    this.splashUniforms = {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uGround: { value: 0 },
      uAmount: { value: 0 },
      uScale: { value: 600 },
      uColor: { value: new THREE.Color(0.8, 0.85, 0.9) },
    };
    const smat = new THREE.ShaderMaterial({
      uniforms: this.splashUniforms,
      transparent: true,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime; uniform vec3 uCam; uniform float uGround; uniform float uAmount; uniform float uScale;
        varying float vPhase; varying float vOn;
        float h(float n) { return fract(sin(n) * 43758.5453); }
        void main() {
          float period = 0.45 + aSeed.z * 0.35;
          float t = uTime / period + aSeed.x * 7.0;
          float cycle = floor(t);
          vPhase = fract(t);
          float id = aSeed.w * 1000.0 + cycle * 13.7;
          vec3 world = vec3(uCam.x + (h(id) - 0.5) * 34.0, uGround + 0.04, uCam.z + (h(id + 3.1) - 0.5) * 34.0);
          vOn = step(aSeed.w, uAmount);
          vec4 mv = viewMatrix * vec4(world, 1.0);
          gl_PointSize = (0.18 + vPhase * 0.32) * uScale / max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vPhase; varying float vOn;
        void main() {
          if (vOn < 0.5) discard;
          vec2 d = (gl_PointCoord - 0.5) * vec2(1.0, 2.6);
          float r = length(d);
          float ring = smoothstep(0.5, 0.38, r) * smoothstep(0.18, 0.34, r);
          float a = ring * (1.0 - vPhase) * 0.4;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }`,
    });
    this.splashMesh = new THREE.Points(sg, smat);
    this.splashMesh.frustumCulled = false;
    this.splashMesh.renderOrder = 6;
    this.splashMesh.visible = false;
    this.scene.add(this.splashMesh);
  }

  // Reflejos de los faroles en el piso mojado: una franja de luz que se estira
  // desde cada farol hacia la cámara (como en el asfalto real con lluvia).
  // data: [x, y, z, r, g, b, ancho] por cada luz
  setLamps(data) {
    const n = data.length / 7;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      pos.set(data.slice(i * 7, i * 7 + 3), i * 3);
      col.set(data.slice(i * 7 + 3, i * 7 + 7), i * 4);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3));
    g.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 4));
    g.instanceCount = n;
    this.reflUniforms = {
      uCam: { value: new THREE.Vector3() },
      uAmount: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.reflUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: /* glsl */ `
        attribute vec3 aPos; attribute vec4 aCol;
        uniform vec3 uCam;
        varying vec2 vC; varying float vFade; varying vec3 vCol;
        void main() {
          vec2 toCam = uCam.xz - aPos.xz;
          float dist = length(toCam);
          vec2 dir = toCam / max(dist, 0.001);
          vec2 side = vec2(-dir.y, dir.x);
          float len = clamp(dist * 0.55, 2.0, 16.0);
          vec2 xz = aPos.xz + dir * (position.y * len - 0.6) + side * position.x * (aCol.w + position.y * 0.35);
          vCol = aCol.rgb;
          vC = position.xy;
          vFade = (1.0 - smoothstep(60.0, 110.0, dist)) * smoothstep(1.0, 4.0, dist);
          gl_Position = projectionMatrix * viewMatrix * vec4(xz.x, aPos.y, xz.y, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAmount;
        varying vec2 vC; varying float vFade; varying vec3 vCol;
        void main() {
          float along = pow(1.0 - vC.y, 1.6);
          float across = pow(1.0 - abs(vC.x), 2.0);
          float a = along * across * vFade * uAmount;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vCol * a, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.reflMesh = new THREE.Mesh(g, mat);
    this.reflMesh.frustumCulled = false;
    this.reflMesh.renderOrder = 4;
    this.reflMesh.visible = false;
    this.scene.add(this.reflMesh);
  }

  setQuality(quality) {
    this.quality = quality;
    this.maxDrops = { low: 0.3, medium: 0.6, high: 1 }[quality] ?? 0.6;
    this.maxSplash = { low: 0, medium: 0.45, high: 1 }[quality] ?? 0.45;
  }

  // ------------------------------------------------------------------ estado
  set(type, instant = false) {
    if (!WEATHER_TYPES[type]) return;
    this.type = type;
    this.timer = (4 + Math.random() * 5) * 60;
    if (instant) {
      this.cloud = WEATHER_TYPES[type].cloud;
      this.rain = WEATHER_TYPES[type].rain;
      this.wet = this.rain > 0 ? 1 : 0;
    }
  }

  pickNext() {
    const list = NEXT[this.type];
    let r = Math.random();
    for (const [t, p] of list) {
      if ((r -= p) <= 0) return t;
    }
    return list[0][0];
  }

  save() {
    return { type: this.type, timer: Math.round(this.timer), wet: +this.wet.toFixed(2) };
  }

  load(data) {
    if (!data || !WEATHER_TYPES[data.type]) return this.set('clear', true);
    this.set(data.type, true);
    this.timer = data.timer ?? this.timer;
    this.wet = data.wet ?? this.wet;
  }

  get label() {
    return WEATHER_TYPES[this.type].label;
  }

  // dt: segundos reales (0 en pausa/menú)
  update(dt, camera, groundY, night) {
    this.time += dt;
    if (dt > 0) {
      this.timer -= dt;
      if (this.timer <= 0) this.set(this.pickNext());
    }
    const T = WEATHER_TYPES[this.type];
    // primero se nubla, después llueve; al terminar, deja de llover y se despeja
    const cloudRate = 0.035 * dt, rainRate = 0.05 * dt;
    this.cloud += THREE.MathUtils.clamp(T.cloud - this.cloud, -cloudRate, cloudRate);
    const rainTarget = this.cloud > T.cloud - 0.15 ? T.rain : 0;
    this.rain += THREE.MathUtils.clamp(rainTarget - this.rain, -rainRate, rainRate);
    if (this.rain > 0.05) this.wet = Math.min(1, this.wet + this.rain * dt * 0.06);
    else this.wet = Math.max(0, this.wet - dt * 0.0045); // ~4 minutos en secarse

    // relámpagos
    this.flash = Math.max(0, this.flash - dt * 4.5);
    if (T.thunder && this.rain > 0.5 && dt > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.flashTimer = 7 + Math.random() * 14;
        this.flash = 1;
        this.flash2 = 0.12 + Math.random() * 0.1; // segundo destello
        const dist = Math.random();
        this.pendingThunder.push({ t: 0.4 + dist * 2.6, power: 1 - dist * 0.6 });
      }
    }
    if (this.flash2 > 0) {
      this.flash2 -= dt;
      if (this.flash2 <= 0) this.flash = Math.max(this.flash, 0.7);
    }
    for (const th of this.pendingThunder) th.t -= dt;
    while (this.pendingThunder.length && this.pendingThunder[0].t <= 0) {
      const th = this.pendingThunder.shift();
      this.onThunder?.(th.power);
    }

    // gotas y salpicaduras
    const drops = this.rain * this.maxDrops;
    const ru = this.rainUniforms;
    ru.uTime.value = this.time;
    ru.uCam.value.copy(camera.position);
    ru.uAmount.value = drops;
    const n = night ?? 0;
    // de día las gotas son grisáceas (se ven contra el cielo claro); de noche, claras
    ru.uColor.value.setRGB(0.5 - n * 0.12, 0.54 - n * 0.12, 0.6 - n * 0.1);
    ru.uOpacity.value = 0.5 + (1 - n) * 0.3 + this.flash * 0.4;
    this.rainMesh.visible = drops > 0.003;

    const su = this.splashUniforms;
    su.uTime.value = this.time;
    su.uCam.value.copy(camera.position);
    su.uGround.value = groundY;
    su.uAmount.value = this.rain * this.maxSplash;
    su.uColor.value.copy(ru.uColor.value);
    this.splashMesh.visible = su.uAmount.value > 0.003;

    if (this.reflMesh) {
      const amt = this.wet * Math.max(0, n - 0.2) * 1.5;
      this.reflUniforms.uAmount.value = amt;
      this.reflUniforms.uCam.value.copy(camera.position);
      this.reflMesh.visible = amt > 0.01;
    }
  }

  setViewport(height, fov) {
    this.splashUniforms.uScale.value = height / (2 * Math.tan((fov * Math.PI) / 360));
  }
}
