import * as THREE from 'three';
import { buildNeonAtlas, buildWashTexture } from './Neon.js';

// ============================================================================
// Biblioteca de materiales. Cada material se define una vez y puede recrearse
// como Lambert (LOW, más barato) o Standard/PBR (MEDIUM/HIGH) sin reconstruir
// la ciudad: se reemplazan las referencias en las mallas.
// ============================================================================

export class MaterialLibrary {
  constructor(textures, lighting = 'standard') {
    this.textures = textures;
    this.lighting = lighting;
    this.defs = new Map();
    this.mats = new Map();
    this.nightLit = new Set(); // materiales cuyas ventanas se encienden de noche
    this.wetUniform = { value: 0 };
    this.wetValue = -1;
    this.define();
  }

  define() {
    const T = (n) => this.textures.get(n);
    const d = (key, def) => this.defs.set(key, def);
    // suelos
    // wet: cuánto se oscurece/brilla con lluvia · puddles: charcos (solo calidad media/alta)
    d('asphalt', { tex: T('asphalt'), roughness: 0.92, wet: 1, wetRough: 0.28, puddles: true });
    d('sidewalk', { tex: T('sidewalk'), roughness: 0.9, wet: 0.85, wetRough: 0.35 });
    d('plaza', { tex: T('plaza'), roughness: 0.85, wet: 0.85, wetRough: 0.3, puddles: true });
    d('concrete', { tex: T('concrete'), roughness: 0.9, wet: 0.75, wetRough: 0.4 });
    d('grass', { tex: T('grass'), roughness: 1, wet: 0.35, wetRough: 0.8 });
    d('terrain', { tex: T('terrain'), roughness: 0.95, wet: 0.4, wetRough: 0.6, haze: true });
    d('sand', { tex: T('sand'), roughness: 1, wet: 0.45, wetRough: 0.75, nightGlow: 0x1a2030 });
    d('wood', { tex: T('wood'), roughness: 0.85, wet: 0.6, wetRough: 0.35, nightGlow: 0x1a1a22 });
    d('water', { tex: T('water'), roughness: 0.15, metalness: 0.1, color: 0xffffff, transparent: true, opacity: 0.92, nightGlow: 0x08305a });
    d('pool', { color: 0x4fc3e8, roughness: 0.1, emissive: 0x0a3d52, emissiveIntensity: 0.4 });
    // techos
    d('roofFlat', { tex: T('roofFlat'), roughness: 0.95, wet: 0.6, wetRough: 0.4 });
    d('roofMetal', { tex: T('roofMetal'), roughness: 0.55, metalness: 0.4, wet: 0.4, wetRough: 0.2 });
    d('roofTile', { tex: T('roofTile'), roughness: 0.8, wet: 0.5, wetRough: 0.35 });
    // fachadas (con ventanas que se encienden de noche)
    d('glass', { tex: T('glass'), roughness: 0.18, metalness: 0.55, envBoost: true, night: true });
    d('office', { tex: T('office'), roughness: 0.6, metalness: 0.1, night: true });
    d('apartment', { tex: T('apartment'), roughness: 0.85, night: true });
    d('brick', { tex: T('brick'), roughness: 0.9, night: true });
    d('hotel', { tex: T('hotel'), roughness: 0.7, night: true });
    d('house', { tex: T('house'), roughness: 0.85, night: true });
    d('mansion', { tex: T('mansion'), roughness: 0.5, metalness: 0.05, night: true });
    d('storefront', { tex: T('storefront'), roughness: 0.5, night: true, nightMin: 0.15 });
    d('lobby', { tex: T('lobby'), roughness: 0.3, metalness: 0.3, night: true, nightMin: 0.1 });
    d('industrial', { tex: T('industrial'), roughness: 0.6, metalness: 0.35 });
    d('rollerDoor', { tex: T('rollerDoor'), roughness: 0.6, metalness: 0.3 });
    d('garageDoor', { tex: T('garageDoor'), roughness: 0.7 });
    d('door', { tex: T('door'), roughness: 0.7 });
    d('container', { tex: T('container'), roughness: 0.65, metalness: 0.3 });
    // genéricos con color por vértice
    d('paint', { color: 0xffffff, roughness: 0.75 });
    d('metal', { color: 0xffffff, roughness: 0.45, metalness: 0.6 });
    d('marking', { color: 0xffffff, roughness: 0.8, polygonOffset: true, wet: 0.6, wetRough: 0.3 });
    d('foliage', { color: 0xffffff, roughness: 1, flatShading: false });
    d('bark', { color: 0x6b4b33, roughness: 1 });
    d('lampGlow', { color: 0xfff1cc, emissive: 0xffe2a8, emissiveIntensity: 0, roughness: 0.4, lamp: true });
    d('signal', { color: 0x222222, roughness: 0.5 });
    // neón (sin iluminación: brillan por sí mismos)
    this.neon = buildNeonAtlas(this.textures.size >= 512 ? 1024 : 512);
    d('neon', { basic: true, map: this.neon.tex, additive: true, neon: true });
    d('neonTube', { basic: true, neonTube: true });
    d('wash', { basic: true, map: buildWashTexture(), additive: true, wash: true });
  }

  build(key) {
    const def = this.defs.get(key);
    if (def.basic) {
      const m = new THREE.MeshBasicMaterial({
        map: def.map || null, vertexColors: true, toneMapped: false,
        transparent: !!def.additive, depthWrite: !def.additive,
        blending: def.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        side: def.additive ? THREE.DoubleSide : THREE.FrontSide,
      });
      m.name = key;
      m.userData.def = def;
      return m;
    }
    const params = {
      color: def.color ?? 0xffffff,
      vertexColors: true,
      map: def.tex?.map || null,
      emissiveMap: def.tex?.emissiveMap || null,
      emissive: def.tex?.emissiveMap ? 0xffffff : def.emissive ?? 0x000000,
      emissiveIntensity: def.emissiveIntensity ?? (def.tex?.emissiveMap ? 0 : 1),
      transparent: !!def.transparent,
      opacity: def.opacity ?? 1,
      flatShading: !!def.flatShading,
    };
    let m;
    if (this.lighting === 'lambert') {
      m = new THREE.MeshLambertMaterial(params);
    } else {
      m = new THREE.MeshStandardMaterial({ ...params, roughness: def.roughness ?? 0.8, metalness: def.metalness ?? 0 });
      if (def.envBoost) m.envMapIntensity = 1.2;
    }
    if (def.puddles && m.isMeshStandardMaterial) addPuddles(m, this.wetUniform);
    if (def.haze) addHaze(m);
    if (def.polygonOffset) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = -2;
      m.polygonOffsetUnits = -2;
    }
    m.name = key;
    m.userData.def = def;
    return m;
  }

  get(key) {
    if (!this.mats.has(key)) {
      if (!this.defs.has(key)) throw new Error(`Material desconocido: ${key}`);
      this.mats.set(key, this.build(key));
    }
    return this.mats.get(key);
  }

  texInfo(key) {
    return this.defs.get(key)?.tex || null;
  }

  // Cambia Lambert <-> Standard reemplazando materiales en la escena.
  setLighting(lighting, root) {
    if (lighting === this.lighting) return;
    this.lighting = lighting;
    const replace = new Map();
    for (const [key, old] of this.mats) {
      if (old.isMeshBasicMaterial) continue; // el neón no depende de la iluminación
      const m = this.build(key);
      m.emissiveIntensity = old.emissiveIntensity;
      replace.set(old, m);
      this.mats.set(key, m);
    }
    root.traverse((o) => {
      if (o.material && replace.has(o.material)) o.material = replace.get(o.material);
    });
    for (const old of replace.keys()) old.dispose();
    this.wetValue = -1;
  }

  // wet: 0 (seco) .. 1 (empapado). Oscurece el piso y lo vuelve brillante.
  setWet(wet) {
    if (Math.abs(wet - this.wetValue) < 0.004) return;
    this.wetValue = wet;
    this.wetUniform.value = wet;
    for (const m of this.mats.values()) {
      const def = m.userData.def;
      if (!def.wet) continue;
      const w = wet * def.wet;
      m.color.setHex(def.color ?? 0xffffff).multiplyScalar(1 - w * 0.38);
      if (m.isMeshStandardMaterial) m.roughness = THREE.MathUtils.lerp(def.roughness ?? 0.8, def.wetRough ?? 0.3, w);
    }
  }

  // night: 0 (día) .. 1 (noche cerrada)
  updateNight(night) {
    for (const [key, m] of this.mats) {
      const def = m.userData.def;
      if (def.night) m.emissiveIntensity = Math.max(def.nightMin ?? 0, night) * 1.15;
      else if (def.lamp) m.emissiveIntensity = night * 2.2;
      else if (def.neon) m.color.setScalar(0.22 + night * 1.25);
      else if (def.neonTube) m.color.setScalar(0.3 + night * 1.7);
      else if (def.wash) m.opacity = night * 0.6;
      // la luna ilumina la arena y el mar: la costa no queda negra de noche
      if (def.nightGlow) m.emissive.setHex(def.nightGlow).multiplyScalar(night);
    }
  }
}

// Charcos: zonas del piso que con lluvia quedan casi como espejo.
function addPuddles(m, wetUniform) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWet = wetUniform;
    sh.vertexShader = `varying vec2 vWetXZ;
${sh.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
  vWetXZ = (modelMatrix * vec4(transformed, 1.0)).xz;`,
    )}`;
    sh.fragmentShader = `uniform float uWet; varying vec2 vWetXZ;
      float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float wNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
    ` + sh.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
      float pud = wNoise(vWetXZ * 0.16) * 0.65 + wNoise(vWetXZ * 0.55) * 0.35;
      pud = smoothstep(0.53, 0.63, pud) * smoothstep(0.25, 0.8, uWet);
      roughnessFactor = mix(roughnessFactor, 0.03, pud);
      diffuseColor.rgb *= 1.0 - pud * 0.7;`,
    ).replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      #ifdef USE_FOG
        // brillo del cielo reflejado: más fuerte en los charcos y mirando en ángulo
        float wFr = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.5);
        totalEmissiveRadiance += fogColor * (pud * (0.04 + 0.3 * wFr) + uWet * wFr * 0.1);
      #endif`,
    );
  };
  m.customProgramCacheKey = () => 'puddles';
}

// Bruma: el terreno lejano no desaparece en la niebla, se ve azulado y suave
// (así se ven las montañas desde la ciudad). impostor: escala hacia la cámara.
export function addHaze(m, impostor = null) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    if (prev && prev !== addHaze) prev(sh, r);
    if (impostor) { sh.uniforms.uImpScale = impostor.scale; sh.uniforms.uImpMin = impostor.min; }
    sh.vertexShader = (impostor ? 'uniform float uImpScale;\n' : '') + 'varying float vHazeDist;\n' + sh.vertexShader.replace(
      '#include <project_vertex>',
      impostor
        ? `vec4 wPosH = modelMatrix * vec4(transformed, 1.0);
          vHazeDist = length(wPosH.xyz - cameraPosition);
          wPosH.xyz = cameraPosition + (wPosH.xyz - cameraPosition) * uImpScale;
          vec4 mvPosition = viewMatrix * wPosH;
          gl_Position = projectionMatrix * mvPosition;`
        : `#include <project_vertex>
          vHazeDist = length((modelMatrix * vec4(transformed, 1.0)).xyz - cameraPosition);`,
    );
    sh.fragmentShader = (impostor ? 'uniform float uImpMin;\n' : '') + 'varying float vHazeDist;\n' + sh.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      // cerca de la cámara se dibuja el terreno detallado: la versión liviana solo de lejos
      impostor ? '#include <clipping_planes_fragment>\n if (vHazeDist < uImpMin) discard;' : '#include <clipping_planes_fragment>',
    ).replace(
      '#include <fog_fragment>',
      `#ifdef USE_FOG
        float fogStd = smoothstep(fogNear, fogFar, vHazeDist);
        float hz = clamp(max(fogStd * 0.45, smoothstep(fogNear, fogFar * 5.0, vHazeDist) * 0.9), 0.0, 0.9);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, hz);
      #endif`,
    );
  };
  m.customProgramCacheKey = () => (impostor ? 'hazeImp' : 'haze');
}
