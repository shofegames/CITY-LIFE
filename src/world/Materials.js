import * as THREE from 'three';

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
    this.define();
  }

  define() {
    const T = (n) => this.textures.get(n);
    const d = (key, def) => this.defs.set(key, def);
    // suelos
    d('asphalt', { tex: T('asphalt'), roughness: 0.92 });
    d('sidewalk', { tex: T('sidewalk'), roughness: 0.9 });
    d('plaza', { tex: T('plaza'), roughness: 0.85 });
    d('concrete', { tex: T('concrete'), roughness: 0.9 });
    d('grass', { tex: T('grass'), roughness: 1 });
    d('sand', { tex: T('sand'), roughness: 1 });
    d('wood', { tex: T('wood'), roughness: 0.85 });
    d('water', { tex: T('water'), roughness: 0.15, metalness: 0.1, color: 0xffffff, transparent: true, opacity: 0.92 });
    d('pool', { color: 0x4fc3e8, roughness: 0.1, emissive: 0x0a3d52, emissiveIntensity: 0.4 });
    // techos
    d('roofFlat', { tex: T('roofFlat'), roughness: 0.95 });
    d('roofMetal', { tex: T('roofMetal'), roughness: 0.55, metalness: 0.4 });
    d('roofTile', { tex: T('roofTile'), roughness: 0.8 });
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
    d('marking', { color: 0xffffff, roughness: 0.8, polygonOffset: true });
    d('foliage', { color: 0xffffff, roughness: 1, flatShading: false });
    d('bark', { color: 0x6b4b33, roughness: 1 });
    d('lampGlow', { color: 0xfff1cc, emissive: 0xffe2a8, emissiveIntensity: 0, roughness: 0.4, lamp: true });
    d('signal', { color: 0x222222, roughness: 0.5 });
  }

  build(key) {
    const def = this.defs.get(key);
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
      const m = this.build(key);
      m.emissiveIntensity = old.emissiveIntensity;
      replace.set(old, m);
      this.mats.set(key, m);
    }
    root.traverse((o) => {
      if (o.material && replace.has(o.material)) o.material = replace.get(o.material);
    });
    for (const old of replace.keys()) old.dispose();
  }

  // night: 0 (día) .. 1 (noche cerrada)
  updateNight(night) {
    for (const [key, m] of this.mats) {
      const def = m.userData.def;
      if (def.night) m.emissiveIntensity = Math.max(def.nightMin ?? 0, night) * 1.15;
      else if (def.lamp) m.emissiveIntensity = night * 2.2;
    }
  }
}
