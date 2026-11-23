import * as THREE from 'three';

// ============================================================================
// Neón de San Vega: atlas de carteles luminosos dibujados en canvas (texto con
// resplandor) + ayudas para colocar carteles, tubos y luces de fachada en la
// geometría combinada de la ciudad. De día se ven apagados; de noche brillan.
// ============================================================================

export const NEON_COLORS = ['#ff2f7d', '#2ff5ff', '#b45cff', '#ffe14d', '#4dff88', '#ff8a3d', '#ff3b3b', '#4d7cff'];

export const NEON_WORDS = [
  'HOTEL', 'MOTEL', 'BAR', 'CLUB', 'PIZZA', 'TACOS', 'CAFÉ', '24 HS', 'VEGA', 'LA OLA', 'DISCO', 'SUSHI',
  'HELADOS', 'SURF', 'TALLER DUARTE', 'MODA VEGA', 'CONCESIONARIO', 'CHIRINGUITO', 'FARMACIA', 'BURGER', 'CASINO', 'KARAOKE',
  'PALMERAS', 'COSTA AZUL', 'HOTEL SOL', 'HOTEL MAR', 'HOTEL CORAL', 'HOTEL BRISA', 'HOTEL ARENA', 'SAN VEGA', 'SURF & SOL', 'RUEDA',
];

const COLS = 4, ROWS = 16;

export function buildNeonAtlas(size = 1024) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const cw = size / COLS, ch = size / ROWS;
  const cells = new Map();
  NEON_WORDS.forEach((word, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    const color = NEON_COLORS[i % NEON_COLORS.length];
    const x = col * cw, y = row * ch;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, cw, ch);
    ctx.clip();
    let fs = ch * 0.62;
    ctx.font = `italic 900 ${fs}px "Segoe UI", Arial, sans-serif`;
    const w = ctx.measureText(word).width;
    if (w > cw * 0.86) {
      fs *= (cw * 0.86) / w;
      ctx.font = `italic 900 ${fs}px "Segoe UI", Arial, sans-serif`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // resplandor + tubo con núcleo blanco
    ctx.shadowColor = color;
    ctx.shadowBlur = ch * 0.35;
    ctx.fillStyle = color;
    ctx.fillText(word, x + cw / 2, y + ch / 2);
    ctx.shadowBlur = ch * 0.15;
    ctx.fillText(word, x + cw / 2, y + ch / 2);
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1, fs * 0.04);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.strokeText(word, x + cw / 2, y + ch / 2);
    ctx.restore();
    // UV del rectángulo (v hacia arriba en three)
    cells.set(word, { u0: col / COLS, u1: (col + 1) / COLS, v0: 1 - (row + 1) / ROWS, v1: 1 - row / ROWS, color });
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, cells, aspect: cw / ch };
}

// Textura de degradé vertical para "bañar" fachadas con luz de color.
export function buildWashTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 128, 0, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Cartel de neón plano sobre una fachada (mirando hacia "face").
// atlas: celda de la palabra. Agrega placa de fondo oscura (para verlo de día).
export function addFacadeSign(B, atlas, word, face, cx, cz, y, w, h, vertical = false) {
  const cell = atlas.cells.get(word);
  if (!cell) return;
  const off = 0.12, hw = w / 2;
  // placa de fondo
  const t = 0.12;
  if (face === 'n') B.box(cx - hw, y, cz - t - 0.02, cx + hw, y + h, cz - 0.02, { side: 'paint', color: 0x16161c });
  else if (face === 's') B.box(cx - hw, y, cz + 0.02, cx + hw, y + h, cz + t + 0.02, { side: 'paint', color: 0x16161c });
  else if (face === 'w') B.box(cx - t - 0.02, y, cz - hw, cx - 0.02, y + h, cz + hw, { side: 'paint', color: 0x16161c });
  else B.box(cx + 0.02, y, cz - hw, cx + t + 0.02, y + h, cz + hw, { side: 'paint', color: 0x16161c });
  const o = t + off;
  // texto (UV rotado si es vertical)
  const uv = vertical
    ? [cell.u1, cell.v0, cell.u1, cell.v1, cell.u0, cell.v1, cell.u0, cell.v0]
    : [cell.u0, cell.v0, cell.u1, cell.v0, cell.u1, cell.v1, cell.u0, cell.v1];
  if (face === 's') B.quad('neon', [cx - hw, y, cz + o], [cx + hw, y, cz + o], [cx + hw, y + h, cz + o], [cx - hw, y + h, cz + o], uv);
  else if (face === 'n') B.quad('neon', [cx + hw, y, cz - o], [cx - hw, y, cz - o], [cx - hw, y + h, cz - o], [cx + hw, y + h, cz - o], uv);
  else if (face === 'e') B.quad('neon', [cx + o, y, cz + hw], [cx + o, y, cz - hw], [cx + o, y + h, cz - hw], [cx + o, y + h, cz + hw], uv);
  else B.quad('neon', [cx - o, y, cz - hw], [cx - o, y, cz + hw], [cx - o, y + h, cz + hw], [cx - o, y + h, cz - hw], uv);
}

// Cartel independiente sobre dos postes, legible de los dos lados (rot = hacia dónde mira el frente).
export function addPoleSign(B, atlas, word, x, z, rot, w = 5, h = 1.4, y0 = 3.2, base = 0.15) {
  const cell = atlas.cells.get(word);
  if (!cell) return;
  const c = Math.cos(rot), s = Math.sin(rot);
  // ejes: "lado" a lo ancho del cartel, "frente" hacia donde mira
  const ax = c, az = -s, fx = s, fz = c;
  const hw = w / 2;
  for (const k of [-0.42, 0.42]) {
    const px = x + ax * hw * 2 * k, pz = z + az * hw * 2 * k;
    B.box(px - 0.07, base, pz - 0.07, px + 0.07, base + y0 + h, pz + 0.07, { side: 'metal', color: 0x2b2f33 });
  }
  const y = base + y0;
  const P = (a, b, yy) => [x + ax * a + fx * b, yy, z + az * a + fz * b];
  // placa
  const t = 0.08;
  B.quad('paint', P(-hw, t, y), P(hw, t, y), P(hw, t, y + h), P(-hw, t, y + h), [0, 0, 1, 0, 1, 1, 0, 1], 0x16161c);
  B.quad('paint', P(hw, -t, y), P(-hw, -t, y), P(-hw, -t, y + h), P(hw, -t, y + h), [0, 0, 1, 0, 1, 1, 0, 1], 0x16161c);
  const uv = [cell.u0, cell.v0, cell.u1, cell.v0, cell.u1, cell.v1, cell.u0, cell.v1];
  B.quad('neon', P(-hw, t + 0.04, y), P(hw, t + 0.04, y), P(hw, t + 0.04, y + h), P(-hw, t + 0.04, y + h), uv);
  B.quad('neon', P(hw, -t - 0.04, y), P(-hw, -t - 0.04, y), P(-hw, -t - 0.04, y + h), P(hw, -t - 0.04, y + h), uv);
}

// Tubo de neón recto (caja fina) entre dos puntos alineados a ejes.
export function addNeonTube(B, x0, y0, z0, x1, y1, z1, color, r = 0.07) {
  B.box(Math.min(x0, x1) - r, Math.min(y0, y1) - r, Math.min(z0, z1) - r, Math.max(x0, x1) + r, Math.max(y0, y1) + r, Math.max(z0, z1) + r, { side: 'neonTube', top: 'neonTube', color, bottom: 'neonTube' });
}

// Luz de color que "baña" una fachada desde abajo (solo de noche).
export function addFacadeWash(B, face, x0, z0, x1, z1, y, h, color) {
  const o = 0.25;
  const uv = [0, 0, 1, 0, 1, 1, 0, 1];
  if (face === 'e') B.quad('wash', [x1 + o, y, z1], [x1 + o, y, z0], [x1 + o, y + h, z0], [x1 + o, y + h, z1], uv, color);
  else if (face === 'w') B.quad('wash', [x0 - o, y, z0], [x0 - o, y, z1], [x0 - o, y + h, z1], [x0 - o, y + h, z0], uv, color);
  else if (face === 's') B.quad('wash', [x0, y, z1 + o], [x1, y, z1 + o], [x1, y + h, z1 + o], [x0, y + h, z1 + o], uv, color);
  else B.quad('wash', [x1, y, z0 - o], [x0, y, z0 - o], [x0, y + h, z0 - o], [x1, y + h, z0 - o], uv, color);
}
