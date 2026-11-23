import { DISTRICTS, BEACH } from '../world/CityLayout.js';
import { ISLAND, SEA } from '../world/Island.js';

// ============================================================================
// Map System: dibuja San Vega una sola vez en un canvas (1 px = 1 m) y lo
// reutiliza para el minimapa rotatorio y el mapa completo.
// ============================================================================

const MIN_X = ISLAND.minX, MAX_X = ISLAND.maxX, MIN_Z = ISLAND.minZ, MAX_Z = ISLAND.maxZ;

export class MapSystem {
  constructor(layout) {
    this.L = layout;
    this.base = document.createElement('canvas');
    this.base.width = MAX_X - MIN_X;
    this.base.height = MAX_Z - MIN_Z;
    this.markers = []; // {x, z, color, label, size, edge}
    this.route = null; // polilínea del GPS
    this.search = null; // zona de búsqueda policial
    this.render();
  }

  toMap(x, z) {
    return [x - MIN_X, z - MIN_Z];
  }

  render() {
    const ctx = this.base.getContext('2d');
    const L = this.L;
    const rect = (x0, z0, x1, z1, color) => {
      const [a, b] = this.toMap(x0, z0);
      ctx.fillStyle = color;
      ctx.fillRect(a, b, x1 - x0, z1 - z0);
    };
    ctx.fillStyle = '#1b4a66';
    ctx.fillRect(0, 0, this.base.width, this.base.height);
    if (L.island) this.drawIsland(ctx);
    // playa de Costa Azul
    rect(BEACH.x0, L.roadExtent.min - 40, BEACH.waterX, L.roadExtent.max + 40, '#b59d6e');
    // calles (asfalto)
    const E = L.roadExtent;
    rect(E.min, E.min, E.max, E.max, '#5c6168');
    // manzanas
    for (const b of L.blocks) {
      rect(b.x0, b.z0, b.x1, b.z1, '#8d8a84');
      rect(b.ix0, b.iz0, b.ix1, b.iz1, DISTRICTS[b.district].map);
    }
    for (const s of L.surfaces) {
      const c = { grass: '#3f6a37', plaza: '#77736c', concrete: '#6a6863', parking: '#4c5056', path: '#a49b8a', pool: '#4fc3e8', pond: '#3f8a8a', deck: '#8a6a4a', driveway: '#7d7a74', boardwalk: '#8a6a4a' }[s.type];
      if (c) rect(s.x0, s.z0, s.x1, s.z1, c);
    }
    // edificios
    for (const bld of L.buildings) {
      const shade = Math.min(1, (bld.height || 6) / 140);
      const v = Math.round(48 - shade * 26);
      for (const p of bld.colliders || bld.parts) rect(p.x0, p.z0, p.x1, p.z1, `rgb(${v + 6},${v + 8},${v + 14})`);
    }
    // árboles
    ctx.fillStyle = '#2f5a2a';
    for (const t of L.props.trees) {
      const [a, b] = this.toMap(t.x, t.z);
      ctx.beginPath();
      ctx.arc(a, b, 1.8 * (t.s || 1), 0, Math.PI * 2);
      ctx.fill();
    }
    // líneas centrales de avenidas y autopistas
    ctx.strokeStyle = 'rgba(255,214,102,0.55)';
    ctx.lineWidth = 1.5;
    for (const r of L.roads) {
      if (r.type === 'street') continue;
      ctx.beginPath();
      if (r.axis === 'x') { ctx.moveTo(...this.toMap(r.pos, r.from)); ctx.lineTo(...this.toMap(r.pos, r.to)); }
      else { ctx.moveTo(...this.toMap(r.from, r.pos)); ctx.lineTo(...this.toMap(r.to, r.pos)); }
      ctx.stroke();
    }
  }

  // Relieve de la isla (1 píxel cada 4 m, agrandado) + rutas.
  drawIsland(ctx) {
    const I = this.L.island;
    const img = new ImageData(I.W, I.H);
    const d = img.data;
    for (let j = 0; j < I.H; j++) {
      for (let i = 0; i < I.W; i++) {
        const k = j * I.W + i;
        const h = I.heights[k];
        let r, g, b;
        if (h < SEA) {
          const t = Math.min(1, (SEA - h) / 9);
          r = 70 - 43 * t; g = 165 - 91 * t; b = 175 - 73 * t;
        } else if (I.surf[k] === 4) { r = 196; g = 176; b = 128; }
        else {
          const t = Math.min(1, h / 200);
          r = 58 + t * 80; g = 92 + t * 50; b = 52 + t * 70;
          if (I.surf[k] === 6) { r = 128; g = 122; b = 112; }
        }
        // sombreado del relieve (luz desde el noroeste)
        const hl = I.heights[k - 1] ?? h, hu = I.heights[k - I.W] ?? h;
        const sh = Math.max(-0.35, Math.min(0.35, ((h - hl) + (h - hu)) * 0.08));
        d[k * 4] = r * (1 + sh); d[k * 4 + 1] = g * (1 + sh); d[k * 4 + 2] = b * (1 + sh); d[k * 4 + 3] = 255;
      }
    }
    const tmp = document.createElement('canvas');
    tmp.width = I.W; tmp.height = I.H;
    tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp, ...this.toMap(ISLAND.minX, ISLAND.minZ), (I.W - 1) * ISLAND.cell + ISLAND.cell, (I.H - 1) * ISLAND.cell + ISLAND.cell);
    // lago
    ctx.fillStyle = '#3f9fb0';
    ctx.beginPath();
    ctx.arc(...this.toMap(I.lake.x, I.lake.z), I.lake.r, 0, Math.PI * 2);
    ctx.fill();
    // rutas
    for (const [w, color] of [[12, '#40444a'], [9, '#6a6f76'], [1.5, 'rgba(255,214,102,0.7)']]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const r of I.roads) {
        ctx.beginPath();
        r.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(...this.toMap(p.x, p.z)) : ctx.lineTo(...this.toMap(p.x, p.z))));
        ctx.stroke();
      }
    }
    // pueblo, rancho, observatorio: manchas de edificios
    ctx.fillStyle = '#9a8f80';
    for (const p of I.places) if (p.r > 0) {
      ctx.beginPath();
      ctx.arc(...this.toMap(p.x, p.z), Math.min(p.r, 30), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------------------------------------------------------------- minimapa
  drawMinimap(canvas, px, pz, camYaw, playerYaw, scale = 1.6) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.save();
    ctx.fillStyle = '#1b4a66';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(camYaw);
    ctx.scale(scale, scale);
    const [mx, my] = this.toMap(px, pz);
    ctx.imageSmoothingEnabled = true;
    const R0 = Math.ceil(Math.hypot(W, H) / scale / 2) + 4;
    const sx0 = Math.max(0, Math.floor(mx - R0)), sy0 = Math.max(0, Math.floor(my - R0));
    const sw = Math.min(this.base.width - sx0, R0 * 2), sh = Math.min(this.base.height - sy0, R0 * 2);
    if (sw > 0 && sh > 0) ctx.drawImage(this.base, sx0, sy0, sw, sh, sx0 - mx, sy0 - my, sw, sh);
    // ruta del GPS
    if (this.route && this.route.length > 1) {
      ctx.strokeStyle = '#c77dff';
      ctx.lineWidth = 5 / scale;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      this.route.forEach((p, i) => {
        const [ax, ay] = this.toMap(p.x, p.z);
        if (i === 0) ctx.moveTo(ax - mx, ay - my); else ctx.lineTo(ax - mx, ay - my);
      });
      ctx.stroke();
    }
    ctx.restore();

    // marcadores (los lejanos se pegan al borde del minimapa)
    const R = W / 2 - 9;
    const c = Math.cos(camYaw), s = Math.sin(camYaw);
    for (const m of this.markers) {
      const dx = (m.x - px) * scale, dz = (m.z - pz) * scale;
      let sx = dx * c - dz * s, sy = dx * s + dz * c;
      const d = Math.hypot(sx, sy);
      if (d > R) {
        if (!m.edge) continue;
        sx *= R / d; sy *= R / d;
      }
      ctx.fillStyle = m.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(W / 2 + sx, H / 2 + sy, m.size || 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (m.label) {
        ctx.fillStyle = '#111';
        ctx.font = 'bold 9px Segoe UI, Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(m.label, W / 2 + sx, H / 2 + sy + 0.5);
      }
    }
    // círculo de búsqueda policial
    if (this.search) {
      const dx = (this.search.x - px) * scale, dz = (this.search.z - pz) * scale;
      ctx.strokeStyle = 'rgba(80,140,255,0.8)';
      ctx.fillStyle = 'rgba(80,140,255,0.12)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(W / 2 + dx * c - dz * s, H / 2 + dx * s + dz * c, this.search.r * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // flecha del jugador (dirección relativa a la cámara)
    const rel = playerYaw - (camYaw + Math.PI);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-rel);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6.5, 7);
    ctx.lineTo(0, 3.5);
    ctx.lineTo(-6.5, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // indicador de norte en el borde
    const r = W / 2 - 12;
    const nX = W / 2 + Math.sin(camYaw) * r; // el norte (0,-1) rotado por camYaw
    const nY = H / 2 - Math.cos(camYaw) * r;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(nX, nY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff6b2c';
    ctx.font = 'bold 11px Segoe UI, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nX, nY + 0.5);
  }

  // ---------------------------------------------------------------- mapa completo
  drawFullMap(canvas, px, pz, playerYaw) {
    const rectB = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(rectB.width * dpr));
    canvas.height = Math.max(1, Math.floor(rectB.height * dpr));
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const s = Math.min(W / this.base.width, H / this.base.height);
    const ox = (W - this.base.width * s) / 2, oy = (H - this.base.height * s) / 2;
    ctx.fillStyle = '#1b4a66';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(this.base, ox, oy, this.base.width * s, this.base.height * s);
    const P = (x, z) => [ox + (x - MIN_X) * s, oy + (z - MIN_Z) * s];

    // nombres de barrios
    const centers = {};
    for (const b of this.L.blocks) {
      const c = (centers[b.district] ||= { x: 0, z: 0, n: 0 });
      c.x += (b.x0 + b.x1) / 2; c.z += (b.z0 + b.z1) / 2; c.n++;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [id, c] of Object.entries(centers)) {
      const [x, y] = P(c.x / c.n, c.z / c.n);
      ctx.font = `800 ${Math.round(15 * dpr)}px Segoe UI, Arial`;
      ctx.lineWidth = 4 * dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(DISTRICTS[id].name.toUpperCase(), x, y);
      ctx.fillStyle = DISTRICTS[id].color;
      ctx.fillText(DISTRICTS[id].name.toUpperCase(), x, y);
    }
    // lugares destacados
    ctx.font = `600 ${Math.round(11 * dpr)}px Segoe UI, Arial`;
    for (const lm of this.L.landmarks) {
      const [x, y] = P(lm.x, lm.z);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y + 12 * dpr, 3 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3 * dpr;
      ctx.strokeText(lm.name, x, y + 24 * dpr);
      ctx.fillText(lm.name, x, y + 24 * dpr);
    }
    if (this.route && this.route.length > 1) {
      ctx.strokeStyle = '#c77dff';
      ctx.lineWidth = 3 * dpr;
      ctx.beginPath();
      this.route.forEach((p, i) => (i === 0 ? ctx.moveTo(...P(p.x, p.z)) : ctx.lineTo(...P(p.x, p.z))));
      ctx.stroke();
    }
    for (const m of this.markers) {
      const [x, y] = P(m.x, m.z);
      ctx.fillStyle = m.color;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.arc(x, y, 7 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (m.label) {
        ctx.fillStyle = '#111';
        ctx.font = `bold ${Math.round(10 * dpr)}px Segoe UI, Arial`;
        ctx.fillText(m.label, x, y + 1);
      }
    }
    // jugador
    const [x, y] = P(px, pz);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI - playerYaw);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ff2f7d';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(0, -11 * dpr);
    ctx.lineTo(8 * dpr, 8 * dpr);
    ctx.lineTo(0, 4 * dpr);
    ctx.lineTo(-8 * dpr, 8 * dpr);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  legendHTML() {
    const items = Object.values(DISTRICTS).map((d) => `<div class="lg"><span class="sw" style="background:${d.color}"></span>${d.name}</div>`);
    items.push('<div class="lg"><span class="sw" style="background:#3f6a37"></span>Parques</div>');
    items.push('<div class="lg"><span class="sw" style="background:#b59d6e"></span>Playa</div>');
    items.push('<div class="lg"><span class="sw" style="background:#8a8c78"></span>Montaña</div>');
    items.push('<div class="lg"><span class="sw" style="background:#6a6f76"></span>Rutas</div>');
    items.push('<div class="lg"><span class="sw" style="background:#fff;border:2px solid #ff2f7d"></span>Tu posición</div>');
    return items.join('');
  }
}
