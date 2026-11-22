import { DISTRICTS, BEACH } from '../world/CityLayout.js';

// ============================================================================
// Map System: dibuja San Vega una sola vez en un canvas (1 px = 1 m) y lo
// reutiliza para el minimapa rotatorio y el mapa completo.
// ============================================================================

const MIN_X = -620, MAX_X = 700, MIN_Z = -620, MAX_Z = 620;

export class MapSystem {
  constructor(layout) {
    this.L = layout;
    this.base = document.createElement('canvas');
    this.base.width = MAX_X - MIN_X;
    this.base.height = MAX_Z - MIN_Z;
    this.markers = []; // {x, z, color, label} para misiones/garajes en fases siguientes
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
    ctx.fillStyle = '#26352a';
    ctx.fillRect(0, 0, this.base.width, this.base.height);
    // playa y mar
    rect(BEACH.x0, MIN_Z, BEACH.waterX, MAX_Z, '#b59d6e');
    rect(BEACH.waterX, MIN_Z, MAX_X, MAX_Z, '#1b4a66');
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
    ctx.drawImage(this.base, -mx, -my);
    // marcadores
    for (const m of this.markers) {
      const [ax, ay] = this.toMap(m.x, m.z);
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(ax - mx, ay - my, 5 / scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

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
    for (const m of this.markers) {
      const [x, y] = P(m.x, m.z);
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(x, y, 6 * dpr, 0, Math.PI * 2);
      ctx.fill();
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
    items.push('<div class="lg"><span class="sw" style="background:#fff;border:2px solid #ff2f7d"></span>Tu posición</div>');
    return items.join('');
  }
}
