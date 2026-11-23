import { readJSON, writeJSON } from './storage.js';
import { bus } from './EventBus.js';
import { DEFAULT_BINDINGS } from './Input.js';

const KEY = 'citylife.settings.v1';

// Presets de calidad. LOW está pensado para computadoras escolares con gráficos integrados.
export const QUALITY_PRESETS = {
  low: {
    label: 'Baja',
    pixelRatioCap: 1,
    resolutionScale: 0.75,
    shadows: false,
    shadowMapSize: 512,
    drawDistance: 260,
    detailDistance: 120,
    lighting: 'lambert',
    textureSize: 256,
    npcDensity: 0.35,
    trafficDensity: 0.4,
    reflections: false,
    bloom: false,
    effects: 0.3,
  },
  medium: {
    label: 'Media',
    pixelRatioCap: 1.25,
    resolutionScale: 0.9,
    shadows: true,
    shadowMapSize: 1024,
    drawDistance: 420,
    detailDistance: 180,
    lighting: 'standard',
    textureSize: 512,
    npcDensity: 0.7,
    trafficDensity: 0.7,
    reflections: false,
    bloom: true,
    effects: 0.7,
  },
  high: {
    label: 'Alta',
    pixelRatioCap: 2,
    resolutionScale: 1,
    shadows: true,
    shadowMapSize: 2048,
    drawDistance: 650,
    detailDistance: 260,
    lighting: 'standard',
    textureSize: 512,
    npcDensity: 1,
    trafficDensity: 1,
    reflections: true,
    bloom: true,
    effects: 1,
  },
};

const DEFAULTS = {
  quality: null, // se completa con la recomendación del hardware
  resolutionScale: null,
  shadows: null,
  drawDistance: null,
  bloom: null,
  fpsLimit: 60,
  dynamicResolution: true,
  showFps: false,
  masterVolume: 0.8,
  musicVolume: 0.5,
  sfxVolume: 0.8,
  ambientVolume: 0.6,
  mouseSensitivity: 1,
  invertY: false,
  bindings: null,
  tutorialDone: false,
};

// Detección aproximada del hardware para recomendar un preset.
export function detectHardware() {
  const info = { gpu: 'desconocida', cores: navigator.hardwareConcurrency || 2, memory: navigator.deviceMemory || 4, recommended: 'low' };
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      info.gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    /* sin webgl: se informa luego */
  }
  const g = String(info.gpu).toLowerCase();
  const dedicated = /nvidia|geforce|rtx|gtx|quadro|radeon (rx|pro)|rx \d{3,4}|arc a\d/.test(g);
  const midIntegrated = /iris xe|iris\(r\) xe|radeon\(tm\) graphics|vega|apple m\d|adreno 7/.test(g);
  const weak = /swiftshader|llvmpipe|software|basic render|microsoft basic|hd graphics [2-5]\d{2}|uhd graphics 6\d{2}|mali|powervr/.test(g);

  if (weak || info.cores <= 2 || info.memory <= 2) info.recommended = 'low';
  else if (dedicated && info.cores >= 6) info.recommended = 'high';
  else if (dedicated || (midIntegrated && info.cores >= 4)) info.recommended = 'medium';
  else info.recommended = 'low';
  return info;
}

export class Settings {
  constructor() {
    this.hardware = detectHardware();
    const saved = readJSON(KEY, {});
    this.data = { ...DEFAULTS, ...saved };
    if (!this.data.quality || !QUALITY_PRESETS[this.data.quality]) {
      this.applyPreset(this.hardware.recommended, false);
    }
    if (this.data.bloom == null) this.data.bloom = this.preset.bloom;
    this.data.bindings = { ...structuredClone(DEFAULT_BINDINGS), ...(this.data.bindings || {}) };
  }

  get(key) {
    return this.data[key];
  }

  get preset() {
    return QUALITY_PRESETS[this.data.quality];
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
    bus.emit('settings:changed', { key, value });
  }

  applyPreset(name, emit = true) {
    const p = QUALITY_PRESETS[name];
    if (!p) return;
    this.data.quality = name;
    this.data.resolutionScale = p.resolutionScale;
    this.data.shadows = p.shadows;
    this.data.drawDistance = p.drawDistance;
    this.data.bloom = p.bloom;
    this.save();
    if (emit) bus.emit('settings:changed', { key: 'quality', value: name });
  }

  resetBindings() {
    this.data.bindings = structuredClone(DEFAULT_BINDINGS);
    this.save();
    bus.emit('settings:changed', { key: 'bindings' });
  }

  save() {
    writeJSON(KEY, this.data);
  }
}
