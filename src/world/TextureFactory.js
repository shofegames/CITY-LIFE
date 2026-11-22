import * as THREE from 'three';
import { createRng } from './rng.js';

// ============================================================================
// Texturas procedurales dibujadas en canvas: no hay que descargar imágenes y
// el tamaño se adapta a la calidad (256 px en LOW, 512 px en MEDIUM/HIGH).
// Cada textura de fachada cubre un "módulo" de tamaño real (tileW x tileH metros)
// para que las ventanas coincidan con los pisos y no se estiren.
// ============================================================================

const BASE = 512;

export class TextureFactory {
  constructor(size = 512, anisotropy = 1) {
    this.size = size;
    this.anisotropy = anisotropy;
    this.cache = new Map();
  }

  canvas() {
    const c = document.createElement('canvas');
    c.width = c.height = this.size;
    const ctx = c.getContext('2d');
    ctx.scale(this.size / BASE, this.size / BASE);
    return { c, ctx };
  }

  tex(c, color = true) {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = this.anisotropy;
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }

  get(name) {
    if (!this.cache.has(name)) {
      const fn = this[`make_${name}`];
      if (!fn) throw new Error(`Textura desconocida: ${name}`);
      this.cache.set(name, fn.call(this));
    }
    return this.cache.get(name);
  }

  // ---------------------------------------------------------------- utilidades
  noise(ctx, rng, count, colorFn, wMin = 1, wMax = 3) {
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = colorFn(rng);
      const w = rng.range(wMin, wMax);
      ctx.fillRect(rng.range(0, BASE), rng.range(0, BASE), w, w);
    }
  }

  // ---------------------------------------------------------------- suelos
  make_asphalt() {
    const { c, ctx } = this.canvas();
    const rng = createRng(11);
    ctx.fillStyle = '#3d3f43';
    ctx.fillRect(0, 0, BASE, BASE);
    this.noise(ctx, rng, 9000, (r) => `rgba(${r.int(20, 120)},${r.int(20, 120)},${r.int(25, 125)},${r.range(0.15, 0.45)})`, 1, 2.5);
    // parches y manchas
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(${rng.pick(['30,31,34', '70,72,76', '45,46,50'])},${rng.range(0.15, 0.35)})`;
      ctx.beginPath();
      ctx.ellipse(rng.range(0, BASE), rng.range(0, BASE), rng.range(10, 60), rng.range(6, 30), rng.range(0, 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(20,20,22,0.5)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      let x = rng.range(0, BASE), y = rng.range(0, BASE);
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += rng.range(-30, 30); y += rng.range(-30, 30); ctx.lineTo(x, y); }
      ctx.stroke();
    }
    return { map: this.tex(c), tileW: 8, tileH: 8 };
  }

  make_sidewalk() {
    const { c, ctx } = this.canvas();
    const rng = createRng(12);
    const n = 8; // 8x8 baldosas de 0.5 m
    const s = BASE / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const g = rng.int(168, 192);
        ctx.fillStyle = `rgb(${g},${g - 3},${g - 8})`;
        ctx.fillRect(i * s, j * s, s, s);
      }
    }
    this.noise(ctx, rng, 5000, (r) => `rgba(${r.int(90, 150)},${r.int(90, 150)},${r.int(90, 150)},0.25)`, 1, 2);
    ctx.strokeStyle = 'rgba(90,88,84,0.8)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath(); ctx.moveTo(i * s, 0); ctx.lineTo(i * s, BASE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * s); ctx.lineTo(BASE, i * s); ctx.stroke();
    }
    return { map: this.tex(c), tileW: 4, tileH: 4 };
  }

  make_plaza() {
    const { c, ctx } = this.canvas();
    const rng = createRng(13);
    const n = 4;
    const s = BASE / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const g = rng.int(150, 178);
      ctx.fillStyle = (i + j) % 2 ? `rgb(${g + 18},${g + 12},${g + 2})` : `rgb(${g},${g - 2},${g - 6})`;
      ctx.fillRect(i * s, j * s, s, s);
    }
    this.noise(ctx, rng, 4000, (r) => `rgba(${r.int(80, 160)},${r.int(80, 150)},${r.int(80, 140)},0.22)`, 1, 2);
    ctx.strokeStyle = 'rgba(80,76,70,0.7)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath(); ctx.moveTo(i * s, 0); ctx.lineTo(i * s, BASE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * s); ctx.lineTo(BASE, i * s); ctx.stroke();
    }
    return { map: this.tex(c), tileW: 6, tileH: 6 };
  }

  make_concrete() {
    const { c, ctx } = this.canvas();
    const rng = createRng(14);
    ctx.fillStyle = '#9b9993';
    ctx.fillRect(0, 0, BASE, BASE);
    this.noise(ctx, rng, 8000, (r) => `rgba(${r.int(60, 190)},${r.int(60, 185)},${r.int(60, 180)},0.18)`, 1, 3);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = `rgba(60,58,55,${rng.range(0.05, 0.15)})`;
      ctx.beginPath();
      ctx.ellipse(rng.range(0, BASE), rng.range(0, BASE), rng.range(20, 70), rng.range(10, 40), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(60,58,55,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(BASE / 2, 0); ctx.lineTo(BASE / 2, BASE); ctx.moveTo(0, BASE / 2); ctx.lineTo(BASE, BASE / 2); ctx.stroke();
    return { map: this.tex(c), tileW: 8, tileH: 8 };
  }

  make_grass() {
    const { c, ctx } = this.canvas();
    const rng = createRng(15);
    ctx.fillStyle = '#4f7a36';
    ctx.fillRect(0, 0, BASE, BASE);
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = `rgba(${rng.pick(['70,110,45', '60,95,40', '95,125,55', '55,85,35'])},${rng.range(0.2, 0.45)})`;
      ctx.beginPath();
      ctx.ellipse(rng.range(0, BASE), rng.range(0, BASE), rng.range(30, 90), rng.range(20, 60), rng.range(0, 3), 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 9000; i++) {
      ctx.strokeStyle = `rgba(${rng.int(40, 120)},${rng.int(90, 160)},${rng.int(30, 70)},${rng.range(0.25, 0.6)})`;
      const x = rng.range(0, BASE), y = rng.range(0, BASE);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rng.range(-1.5, 1.5), y - rng.range(2, 6)); ctx.stroke();
    }
    return { map: this.tex(c), tileW: 6, tileH: 6 };
  }

  make_sand() {
    const { c, ctx } = this.canvas();
    const rng = createRng(16);
    ctx.fillStyle = '#d9c59a';
    ctx.fillRect(0, 0, BASE, BASE);
    this.noise(ctx, rng, 12000, (r) => `rgba(${r.int(150, 240)},${r.int(130, 215)},${r.int(90, 160)},0.35)`, 1, 2);
    ctx.strokeStyle = 'rgba(170,150,110,0.25)';
    for (let i = 0; i < 18; i++) {
      ctx.beginPath();
      const y = rng.range(0, BASE);
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(BASE * 0.3, y + rng.range(-15, 15), BASE * 0.6, y + rng.range(-15, 15), BASE, y);
      ctx.stroke();
    }
    return { map: this.tex(c), tileW: 10, tileH: 10 };
  }

  make_wood() {
    const { c, ctx } = this.canvas();
    const rng = createRng(17);
    const planks = 8;
    const h = BASE / planks;
    for (let i = 0; i < planks; i++) {
      const g = rng.int(0, 25);
      ctx.fillStyle = `rgb(${130 + g},${92 + g},${60 + g})`;
      ctx.fillRect(0, i * h, BASE, h);
      for (let k = 0; k < 40; k++) {
        ctx.strokeStyle = `rgba(80,55,35,${rng.range(0.1, 0.3)})`;
        const y = i * h + rng.range(2, h - 2);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(BASE, y + rng.range(-2, 2)); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(40,28,18,0.8)';
      ctx.fillRect(0, i * h, BASE, 3);
    }
    return { map: this.tex(c), tileW: 3, tileH: 3 };
  }

  make_roofFlat() {
    const { c, ctx } = this.canvas();
    const rng = createRng(18);
    ctx.fillStyle = '#7b7872';
    ctx.fillRect(0, 0, BASE, BASE);
    this.noise(ctx, rng, 14000, (r) => `rgba(${r.int(70, 170)},${r.int(70, 165)},${r.int(65, 155)},0.4)`, 1, 3);
    return { map: this.tex(c), tileW: 6, tileH: 6 };
  }

  make_roofMetal() {
    const { c, ctx } = this.canvas();
    ctx.fillStyle = '#a7abae';
    ctx.fillRect(0, 0, BASE, BASE);
    for (let x = 0; x < BASE; x += 32) {
      const g = ctx.createLinearGradient(x, 0, x + 32, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.18)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.12)');
      g.addColorStop(1, 'rgba(255,255,255,0.18)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 32, BASE);
    }
    return { map: this.tex(c), tileW: 8, tileH: 8 };
  }

  make_roofTile() {
    const { c, ctx } = this.canvas();
    const rng = createRng(19);
    ctx.fillStyle = '#d0d0d0';
    ctx.fillRect(0, 0, BASE, BASE);
    const rows = 16, cols = 12;
    const rh = BASE / rows, cw = BASE / cols;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * cw * 0.5;
      for (let k = -1; k <= cols; k++) {
        const g = rng.int(175, 225);
        ctx.fillStyle = `rgb(${g},${g},${g})`;
        ctx.fillRect(k * cw + off + 1, r * rh + 1, cw - 2, rh - 1);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(k * cw + off, r * rh + rh - 4, cw, 4);
      }
    }
    return { map: this.tex(c), tileW: 4, tileH: 4 };
  }

  make_water() {
    const { c, ctx } = this.canvas();
    const rng = createRng(20);
    ctx.fillStyle = '#2b6f8a';
    ctx.fillRect(0, 0, BASE, BASE);
    for (let i = 0; i < 260; i++) {
      ctx.strokeStyle = `rgba(${rng.pick(['190,230,240', '30,80,110', '120,190,210'])},${rng.range(0.15, 0.4)})`;
      ctx.lineWidth = rng.range(1, 3);
      const x = rng.range(0, BASE), y = rng.range(0, BASE), w = rng.range(10, 40);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + w / 2, y - 4, x + w, y); ctx.stroke();
    }
    return { map: this.tex(c), tileW: 16, tileH: 16 };
  }

  // ---------------------------------------------------------------- fachadas
  // Módulo de fachada: 4 bahías (3 m) x 4 pisos (3.5 m) = 12 x 14 m.
  facade(seed, drawBg, drawWindow, opts = {}) {
    const { c, ctx } = this.canvas();
    const e = this.canvas();
    const rng = createRng(seed);
    const bays = opts.bays || 4, floors = opts.floors || 4;
    const bw = BASE / bays, fh = BASE / floors;
    drawBg(ctx, rng, bw, fh);
    e.ctx.fillStyle = '#000';
    e.ctx.fillRect(0, 0, BASE, BASE);
    for (let f = 0; f < floors; f++) {
      for (let b = 0; b < bays; b++) {
        const lit = rng.chance(opts.litChance ?? 0.38);
        drawWindow(ctx, e.ctx, rng, b * bw, f * fh, bw, fh, lit);
      }
    }
    return { map: this.tex(c), emissiveMap: this.tex(e.c), tileW: opts.tileW || 12, tileH: opts.tileH || 14 };
  }

  litColor(rng) {
    return rng.pick(['#ffd99a', '#ffe7b8', '#fff2d6', '#ffcf86', '#d8ecff']);
  }

  make_glass() {
    return this.facade(31, (ctx) => {
      ctx.fillStyle = '#2a3a4c';
      ctx.fillRect(0, 0, BASE, BASE);
    }, (ctx, ectx, rng, x, y, w, h, lit) => {
      const g = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
      const base = rng.int(0, 18);
      g.addColorStop(0, `rgb(${120 + base},${155 + base},${185 + base})`);
      g.addColorStop(0.55, `rgb(${55 + base},${80 + base},${108 + base})`);
      g.addColorStop(1, `rgb(${38 + base},${55 + base},${78 + base})`);
      ctx.fillStyle = g;
      ctx.fillRect(x + 3, y + 3, w - 6, h * 0.78);
      ctx.fillStyle = '#1d2834'; // antepecho
      ctx.fillRect(x, y + h * 0.8, w, h * 0.2);
      ctx.fillStyle = 'rgba(210,220,230,0.9)'; // parteluces
      ctx.fillRect(x, y, 3, h);
      ctx.fillRect(x + w / 2 - 1, y + 3, 2, h * 0.78);
      if (lit) {
        ectx.fillStyle = this.litColor(rng);
        ectx.globalAlpha = rng.range(0.55, 1);
        ectx.fillRect(x + 4, y + 4, w - 8, h * 0.76);
        ectx.globalAlpha = 1;
      }
    }, { litChance: 0.42 });
  }

  make_office() {
    return this.facade(32, (ctx, rng) => {
      ctx.fillStyle = '#dcd8d0';
      ctx.fillRect(0, 0, BASE, BASE);
      this.noise(ctx, rng, 3000, (r) => `rgba(${r.int(120, 200)},${r.int(120, 200)},${r.int(120, 200)},0.2)`, 1, 2);
    }, (ctx, ectx, rng, x, y, w, h, lit) => {
      const wy = y + h * 0.28, wh = h * 0.52;
      const g = ctx.createLinearGradient(x, wy, x, wy + wh);
      g.addColorStop(0, '#6c8197');
      g.addColorStop(1, '#2b3846');
      ctx.fillStyle = g;
      ctx.fillRect(x, wy, w, wh);
      ctx.fillStyle = '#bfc4c8';
      for (let k = 0; k <= 3; k++) ctx.fillRect(x + (k * w) / 3 - 1.5, wy, 3, wh);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x, wy + wh, w, 3);
      if (lit) {
        ectx.fillStyle = this.litColor(rng);
        ectx.globalAlpha = rng.range(0.6, 1);
        ectx.fillRect(x + 2, wy + 2, w - 4, wh - 4);
        ectx.globalAlpha = 1;
      }
    }, { litChance: 0.4 });
  }

  residentialWindow(ctx, ectx, rng, x, y, w, h, lit, frame = '#f4f2ee') {
    const ww = w * 0.46, wh = h * 0.5;
    const wx = x + (w - ww) / 2, wy = y + h * 0.22;
    ctx.fillStyle = frame;
    ctx.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);
    const g = ctx.createLinearGradient(wx, wy, wx, wy + wh);
    g.addColorStop(0, '#7f93a6');
    g.addColorStop(1, '#2e3a46');
    ctx.fillStyle = g;
    ctx.fillRect(wx, wy, ww, wh);
    if (rng.chance(0.45)) {
      ctx.fillStyle = rng.pick(['rgba(230,220,200,0.85)', 'rgba(200,170,140,0.85)', 'rgba(180,200,210,0.8)']);
      ctx.fillRect(wx, wy, ww * rng.range(0.25, 0.5), wh);
    }
    ctx.fillStyle = frame;
    ctx.fillRect(wx + ww / 2 - 2, wy, 4, wh);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(wx - 7, wy + wh + 5, ww + 14, 5); // alféizar
    if (lit) {
      ectx.fillStyle = this.litColor(rng);
      ectx.globalAlpha = rng.range(0.6, 1);
      ectx.fillRect(wx, wy, ww, wh);
      ectx.globalAlpha = 1;
    }
  }

  make_apartment() {
    return this.facade(33, (ctx, rng) => {
      ctx.fillStyle = '#ebe7e0';
      ctx.fillRect(0, 0, BASE, BASE);
      this.noise(ctx, rng, 4000, (r) => `rgba(${r.int(150, 230)},${r.int(150, 225)},${r.int(150, 220)},0.25)`, 1, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      for (let f = 0; f < 4; f++) ctx.fillRect(0, f * 128 + 124, BASE, 4); // líneas de losa
    }, (ctx, ectx, rng, x, y, w, h, lit) => this.residentialWindow(ctx, ectx, rng, x, y, w, h, lit));
  }

  make_brick() {
    return this.facade(34, (ctx, rng) => {
      ctx.fillStyle = '#7a3e2c';
      ctx.fillRect(0, 0, BASE, BASE);
      const bh = 8, bw = 24;
      for (let r = 0; r < BASE / bh; r++) {
        const off = (r % 2) * (bw / 2);
        for (let k = -1; k < BASE / bw + 1; k++) {
          const v = rng.int(-18, 18);
          ctx.fillStyle = `rgb(${158 + v},${82 + v * 0.6},${60 + v * 0.5})`;
          ctx.fillRect(k * bw + off + 1, r * bh + 1, bw - 2, bh - 2);
        }
      }
    }, (ctx, ectx, rng, x, y, w, h, lit) => {
      this.residentialWindow(ctx, ectx, rng, x, y, w, h, lit, '#e9e2d4');
      ctx.fillStyle = '#cfc6b6'; // dintel de piedra
      ctx.fillRect(x + w * 0.27 - 6, y + h * 0.22 - 16, w * 0.46 + 12, 10);
    });
  }

  make_hotel() {
    return this.facade(35, (ctx, rng) => {
      ctx.fillStyle = '#f1ede6';
      ctx.fillRect(0, 0, BASE, BASE);
      this.noise(ctx, rng, 2500, (r) => `rgba(${r.int(170, 240)},${r.int(170, 235)},${r.int(170, 230)},0.25)`, 1, 3);
    }, (ctx, ectx, rng, x, y, w, h, lit) => {
      const ww = w * 0.7, wh = h * 0.72;
      const wx = x + (w - ww) / 2, wy = y + h * 0.1;
      const g = ctx.createLinearGradient(wx, wy, wx, wy + wh);
      g.addColorStop(0, '#9fc3d6');
      g.addColorStop(1, '#2f4a5c');
      ctx.fillStyle = g;
      ctx.fillRect(wx, wy, ww, wh);
      ctx.fillStyle = '#dcdcdc';
      ctx.fillRect(wx + ww / 2 - 2, wy, 4, wh);
      ctx.fillRect(wx - 3, wy - 3, ww + 6, 4);
      if (rng.chance(0.5)) {
        ctx.fillStyle = 'rgba(240,235,220,0.9)';
        ctx.fillRect(wx, wy, ww * 0.3, wh);
      }
      if (lit) {
        ectx.fillStyle = this.litColor(rng);
        ectx.globalAlpha = rng.range(0.5, 1);
        ectx.fillRect(wx, wy, ww, wh);
        ectx.globalAlpha = 1;
      }
    }, { tileH: 12.8, litChance: 0.45 });
  }

  make_house() {
    // módulo de 6 m x 3 m (un piso, dos ventanas)
    return this.facade(36, (ctx, rng) => {
      ctx.fillStyle = '#eeeae3';
      ctx.fillRect(0, 0, BASE, BASE);
      for (let y = 0; y < BASE; y += 16) {
        ctx.fillStyle = 'rgba(0,0,0,0.07)';
        ctx.fillRect(0, y + 13, BASE, 3);
      }
    }, (ctx, ectx, rng, x, y, w, h, lit) => this.residentialWindow(ctx, ectx, rng, x, y + h * 0.05, w, h * 0.95, lit, '#ffffff'), { bays: 2, floors: 1, tileW: 6, tileH: 3, litChance: 0.4 });
  }

  make_mansion() {
    // muros blancos con grandes paños vidriados
    return this.facade(37, (ctx, rng) => {
      ctx.fillStyle = '#f2f1ee';
      ctx.fillRect(0, 0, BASE, BASE);
      this.noise(ctx, rng, 1500, (r) => `rgba(${r.int(200, 240)},${r.int(200, 240)},${r.int(200, 240)},0.3)`, 1, 3);
    }, (ctx, ectx, rng, x, y, w, h, lit) => {
      if (rng.chance(0.35)) return; // muro ciego
      const wx = x + 6, wy = y + h * 0.08, ww = w - 12, wh = h * 0.84;
      const g = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
      g.addColorStop(0, '#a9c7d8');
      g.addColorStop(1, '#2c3f4d');
      ctx.fillStyle = g;
      ctx.fillRect(wx, wy, ww, wh);
      ctx.fillStyle = '#2b2b2b';
      ctx.fillRect(wx, wy, ww, 4);
      ctx.fillRect(wx + ww / 2 - 2, wy, 4, wh);
      if (lit) {
        ectx.fillStyle = this.litColor(rng);
        ectx.globalAlpha = rng.range(0.5, 0.9);
        ectx.fillRect(wx, wy, ww, wh);
        ectx.globalAlpha = 1;
      }
    }, { bays: 3, floors: 1, tileW: 9, tileH: 3.6, litChance: 0.5 });
  }

  make_industrial() {
    const { c, ctx } = this.canvas();
    const rng = createRng(38);
    ctx.fillStyle = '#a9adb0';
    ctx.fillRect(0, 0, BASE, BASE);
    for (let x = 0; x < BASE; x += 16) {
      const g = ctx.createLinearGradient(x, 0, x + 16, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.22)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.16)');
      g.addColorStop(1, 'rgba(255,255,255,0.22)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 16, BASE);
    }
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(110,80,50,${rng.range(0.04, 0.12)})`;
      ctx.fillRect(rng.range(0, BASE), rng.range(BASE * 0.5, BASE), rng.range(4, 12), rng.range(20, 120));
    }
    return { map: this.tex(c), tileW: 6, tileH: 6 };
  }

  make_storefront() {
    // planta baja comercial: 12 m x 4.5 m con 3 locales
    const { c, ctx } = this.canvas();
    const e = this.canvas();
    const rng = createRng(39);
    e.ctx.fillStyle = '#000';
    e.ctx.fillRect(0, 0, BASE, BASE);
    ctx.fillStyle = '#3a3836';
    ctx.fillRect(0, 0, BASE, BASE);
    const shops = 3, sw = BASE / shops;
    const signColors = ['#c0392b', '#2471a3', '#1e8449', '#d68910', '#7d3c98', '#17202a', '#ba4a00', '#0e6655'];
    for (let s = 0; s < shops; s++) {
      const x = s * sw;
      // cartel
      const col = rng.pick(signColors);
      ctx.fillStyle = col;
      ctx.fillRect(x + 6, 6, sw - 12, BASE * 0.18);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      const letters = rng.int(4, 8);
      for (let k = 0; k < letters; k++) ctx.fillRect(x + 20 + k * ((sw - 40) / letters), 26, (sw - 40) / letters - 6, BASE * 0.18 - 40);
      e.ctx.fillStyle = col;
      e.ctx.globalAlpha = 0.8;
      e.ctx.fillRect(x + 6, 6, sw - 12, BASE * 0.18);
      e.ctx.globalAlpha = 1;
      e.ctx.fillStyle = '#ffffff';
      for (let k = 0; k < letters; k++) e.ctx.fillRect(x + 20 + k * ((sw - 40) / letters), 26, (sw - 40) / letters - 6, BASE * 0.18 - 40);
      // vidriera
      const gy = BASE * 0.25, gh = BASE * 0.72;
      const g = ctx.createLinearGradient(x, gy, x, gy + gh);
      g.addColorStop(0, '#8fa6b5');
      g.addColorStop(0.4, '#5f7584');
      g.addColorStop(1, '#2d3a43');
      ctx.fillStyle = g;
      ctx.fillRect(x + 10, gy, sw - 20, gh);
      // interior: estanterías sugeridas
      for (let k = 0; k < 5; k++) {
        ctx.fillStyle = `rgba(${rng.int(120, 240)},${rng.int(100, 230)},${rng.int(80, 220)},0.35)`;
        ctx.fillRect(x + 16 + rng.range(0, sw - 60), gy + rng.range(gh * 0.3, gh * 0.8), rng.range(15, 40), rng.range(10, 30));
      }
      // puerta
      ctx.fillStyle = '#20262b';
      ctx.fillRect(x + sw * 0.62, gy + gh * 0.18, sw * 0.22, gh * 0.82);
      ctx.fillStyle = '#c8cdd0';
      ctx.fillRect(x + 10, gy, 4, gh);
      ctx.fillRect(x + sw - 14, gy, 4, gh);
      ctx.fillRect(x + sw * 0.62 - 3, gy, 3, gh);
      e.ctx.fillStyle = '#ffe2b0';
      e.ctx.globalAlpha = rng.range(0.55, 0.9);
      e.ctx.fillRect(x + 14, gy + 4, sw * 0.62 - 18, gh - 8);
      e.ctx.globalAlpha = 1;
    }
    return { map: this.tex(c), emissiveMap: this.tex(e.c), tileW: 12, tileH: 4.5 };
  }

  make_lobby() {
    // planta baja de torre: vidrio alto y columnas
    const { c, ctx } = this.canvas();
    const e = this.canvas();
    e.ctx.fillStyle = '#000';
    e.ctx.fillRect(0, 0, BASE, BASE);
    ctx.fillStyle = '#2b3038';
    ctx.fillRect(0, 0, BASE, BASE);
    const n = 4, w = BASE / n;
    for (let i = 0; i < n; i++) {
      const g = ctx.createLinearGradient(0, 0, 0, BASE);
      g.addColorStop(0, '#93a8b8');
      g.addColorStop(1, '#34424e');
      ctx.fillStyle = g;
      ctx.fillRect(i * w + 12, 30, w - 24, BASE - 30);
      ctx.fillStyle = '#c9ced2';
      ctx.fillRect(i * w, 0, 12, BASE);
      ctx.fillRect(i * w + w - 12, 0, 12, BASE);
      e.ctx.fillStyle = '#ffeacc';
      e.ctx.globalAlpha = 0.7;
      e.ctx.fillRect(i * w + 14, 40, w - 28, BASE - 50);
      e.ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#d7dadc';
    ctx.fillRect(0, 0, BASE, 30);
    return { map: this.tex(c), emissiveMap: this.tex(e.c), tileW: 12, tileH: 5.4 };
  }

  make_rollerDoor() {
    const { c, ctx } = this.canvas();
    ctx.fillStyle = '#8d9296';
    ctx.fillRect(0, 0, BASE, BASE);
    for (let y = 0; y < BASE; y += 20) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, y + 16, BASE, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(0, y, BASE, 3);
    }
    ctx.fillStyle = '#d4a017';
    for (let x = 0; x < BASE; x += 64) ctx.fillRect(x, BASE - 24, 32, 24);
    return { map: this.tex(c), tileW: 1, tileH: 1 };
  }

  make_garageDoor() {
    const { c, ctx } = this.canvas();
    ctx.fillStyle = '#e9e7e2';
    ctx.fillRect(0, 0, BASE, BASE);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(x * 128 + 10, y * 128 + 10, 108, 108);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(x * 128 + 10, y * 128 + 10, 108, 4);
    }
    return { map: this.tex(c), tileW: 1, tileH: 1 };
  }

  make_door() {
    const { c, ctx } = this.canvas();
    ctx.fillStyle = '#5b3a24';
    ctx.fillRect(0, 0, BASE, BASE);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(60, 50, 160, 180); ctx.fillRect(292, 50, 160, 180);
    ctx.fillRect(60, 280, 160, 190); ctx.fillRect(292, 280, 160, 190);
    ctx.fillStyle = '#d9b44a';
    ctx.beginPath(); ctx.arc(420, 260, 14, 0, Math.PI * 2); ctx.fill();
    return { map: this.tex(c), tileW: 1, tileH: 1 };
  }

  make_container() {
    const { c, ctx } = this.canvas();
    ctx.fillStyle = '#d8d8d8';
    ctx.fillRect(0, 0, BASE, BASE);
    for (let x = 0; x < BASE; x += 22) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x, 0, 6, BASE);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x + 8, 0, 4, BASE);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, BASE, 14); ctx.fillRect(0, BASE - 14, BASE, 14);
    return { map: this.tex(c), tileW: 6, tileH: 2.6 };
  }
}
