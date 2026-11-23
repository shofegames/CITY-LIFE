import { createRng, hashSeed } from './rng.js';

// ============================================================================
// Plano urbano de SAN VEGA (solo datos: calles, manzanas, edificios, props).
// Ejes: X = este, Z = sur (norte = -Z), Y = arriba. Unidades: metros.
// Los mismos datos alimentan la construcción 3D, las colisiones, el minimapa
// y, en fases siguientes, el tráfico y los peatones.
// ============================================================================

export const GRID = { blocks: 10, pitch: 100, origin: -500 };
export const SIDEWALK = 4;
export const PIER = { x0: 519, x1: 668, z0: -156, z1: -144, deck: 0.75, plat: { x0: 668, x1: 716, z0: -172, z1: -128 }, wheel: { x: 700, z: -150, r: 20, hub: 23.5 } };
const PASTEL = [0xffd1dc, 0xb5ead7, 0xc7ceea, 0xfff1b5, 0xffdac1, 0xa0e7e5, 0xf6f6f6, 0xe2c2ff, 0xffc6a8];
const SHOP_WORDS = ['PIZZA', 'TACOS', 'CAFÉ', '24 HS', 'BAR', 'SUSHI', 'HELADOS', 'BURGER', 'FARMACIA', 'KARAOKE', 'DISCO', 'CLUB', 'SURF'];
const NEON_HEX = [0xff2f7d, 0x2ff5ff, 0xb45cff, 0xffe14d, 0x4dff88, 0xff8a3d];
export const CURB = 0.15; // altura de vereda / manzana
export const BEACH = { x0: 512, x1: 640, waterX: 596 };

export const ROAD_TYPES = {
  highway: { width: 24, lanesPerDir: 3, laneWidth: 3.5, median: 2, kind: 'highway', speed: 27 },
  avenue: { width: 20, lanesPerDir: 2, laneWidth: 3.5, median: 5, kind: 'avenue', speed: 17 },
  street: { width: 12, lanesPerDir: 1, laneWidth: 3.5, median: 0, parking: 2.5, kind: 'street', speed: 12 },
};

const X_NAMES = ['Autopista Oeste', 'Calle Olmos', 'Calle Robles', 'Calle Laurel', 'Calle Prado', 'Avenida Central', 'Calle Marina', 'Calle Fénix', 'Calle Alameda', 'Calle Faro', 'Costanera'];
const Z_NAMES = ['Autopista Norte', 'Av. Colinas', 'Av. Industria', 'Av. Libertad', 'Av. del Sol', 'Bulevar Vega', 'Av. Mercado', 'Av. Palmeras', 'Av. Jardines', 'Av. del Sur', 'Autopista Sur'];

export const DISTRICTS = {
  downtown: { name: 'Downtown', color: '#6f7cff', map: '#3b4258' },
  rich: { name: 'Altos de Vega', color: '#ffd166', map: '#3f4a3a' },
  suburbs: { name: 'Los Pinos', color: '#7bd389', map: '#3a4a3c' },
  industrial: { name: 'Puerto Industrial', color: '#c9a27e', map: '#4a4540' },
  commercial: { name: 'Distrito Comercial', color: '#ff8fa3', map: '#47404a' },
  coastal: { name: 'Costa Azul', color: '#4cc9f0', map: '#3a4752' },
};

function roadTypeFor(i) {
  if (i === 0 || i === GRID.blocks) return 'highway';
  if (i === 5) return 'avenue';
  return 'street';
}

function districtFor(bx, bz) {
  if (bx === 9) return 'coastal';
  if (bx >= 4 && bx <= 6 && bz >= 3 && bz <= 6) return 'downtown';
  if (bx >= 6 && bz <= 2) return 'industrial';
  if (bx <= 3 && bz <= 3) return 'rich';
  if (bx <= 3 && bz >= 6) return 'suburbs';
  return 'commercial';
}

const SPECIAL_BLOCKS = {
  '3,4': { kind: 'park', name: 'Parque Central' },
  '5,4': { kind: 'plaza', name: 'Plaza Vega' },
  '1,7': { kind: 'park', name: 'Parque Los Pinos' },
  '2,1': { kind: 'park', name: 'Mirador de Altos' },
  '8,8': { kind: 'parking', name: 'Estacionamiento Sur' },
  '7,1': { kind: 'yard', name: 'Playa de Contenedores' },
};

export function buildCityLayout() {
  const L = {
    lines: { x: [], z: [] },
    roads: [],
    intersections: [],
    blocks: [],
    buildings: [],
    surfaces: [], // pisos especiales dentro de manzanas (pasto, plaza, estacionamiento, piletas...)
    props: { lamps: [], trees: [], palms: [], trafficLights: [], benches: [], hydrants: [], bins: [], containers: [], walls: [], fountains: [], cars: [] },
    landmarks: [],
    bounds: { minX: -560, maxX: 722, minZ: -560, maxZ: 560 },
    beachProps: { umbrellas: [], towers: [], huts: [], nets: [] },
    poleSigns: [],
  };

  // ---------- líneas de calles ----------
  for (let i = 0; i <= GRID.blocks; i++) {
    const pos = GRID.origin + i * GRID.pitch;
    const type = roadTypeFor(i);
    const zType = i === 5 ? 'avenue' : roadTypeFor(i);
    L.lines.x.push({ i, pos, type, ...ROAD_TYPES[type], name: X_NAMES[i] });
    L.lines.z.push({ i, pos, type: zType, ...ROAD_TYPES[zType], name: Z_NAMES[i] });
  }
  const minRoad = GRID.origin - L.lines.x[0].width / 2;
  const maxRoad = GRID.origin + GRID.blocks * GRID.pitch + L.lines.x[GRID.blocks].width / 2;
  L.roadExtent = { min: minRoad, max: maxRoad };

  // ---------- intersecciones ----------
  for (const lx of L.lines.x) {
    for (const lz of L.lines.z) {
      L.intersections.push({ id: `${lx.i},${lz.i}`, ix: lx.i, iz: lz.i, x: lx.pos, z: lz.pos, wx: lx.width, wz: lz.width });
    }
  }

  // ---------- tramos de calle entre intersecciones ----------
  // axis 'x': calle que corre de norte a sur (sobre una línea X fija)
  for (const lx of L.lines.x) {
    for (let j = 0; j < GRID.blocks; j++) {
      const a = L.lines.z[j], b = L.lines.z[j + 1];
      L.roads.push({ id: `x${lx.i}_${j}`, axis: 'x', pos: lx.pos, from: a.pos + a.width / 2, to: b.pos - b.width / 2, width: lx.width, type: lx.type, spec: ROAD_TYPES[lx.type], name: lx.name });
    }
  }
  for (const lz of L.lines.z) {
    for (let j = 0; j < GRID.blocks; j++) {
      const a = L.lines.x[j], b = L.lines.x[j + 1];
      L.roads.push({ id: `z${lz.i}_${j}`, axis: 'z', pos: lz.pos, from: a.pos + a.width / 2, to: b.pos - b.width / 2, width: lz.width, type: lz.type, spec: ROAD_TYPES[lz.type], name: lz.name });
    }
  }

  // ---------- manzanas ----------
  for (let bx = 0; bx < GRID.blocks; bx++) {
    for (let bz = 0; bz < GRID.blocks; bz++) {
      const lx0 = L.lines.x[bx], lx1 = L.lines.x[bx + 1];
      const lz0 = L.lines.z[bz], lz1 = L.lines.z[bz + 1];
      const block = {
        bx, bz,
        x0: lx0.pos + lx0.width / 2, x1: lx1.pos - lx1.width / 2,
        z0: lz0.pos + lz0.width / 2, z1: lz1.pos - lz1.width / 2,
        district: districtFor(bx, bz),
        kind: 'buildings',
        name: null,
      };
      block.ix0 = block.x0 + SIDEWALK; block.ix1 = block.x1 - SIDEWALK;
      block.iz0 = block.z0 + SIDEWALK; block.iz1 = block.z1 - SIDEWALK;
      const special = SPECIAL_BLOCKS[`${bx},${bz}`];
      if (special) Object.assign(block, special);
      L.blocks.push(block);
    }
  }

  for (const block of L.blocks) populateBlock(L, block);
  addStreetProps(L);
  addBeach(L);

  // Punto de aparición: vereda este de la Avenida Central, frente a Plaza Vega.
  const ave = L.lines.x[5];
  L.spawn = { x: ave.pos + ave.width / 2 + SIDEWALK * 0.5, y: CURB, z: -60, yaw: Math.PI };
  return L;
}

// ============================================================================
// Contenido de cada manzana
// ============================================================================
function populateBlock(L, b) {
  const rng = createRng(hashSeed(b.bx * 31 + 7, b.bz * 17 + 3));
  const w = b.ix1 - b.ix0, d = b.iz1 - b.iz0;

  if (b.kind === 'park') return makePark(L, b, rng);
  if (b.kind === 'plaza') return makePlaza(L, b, rng);
  if (b.kind === 'parking') return makeParking(L, b, rng);
  if (b.kind === 'yard') return makeContainerYard(L, b, rng);

  switch (b.district) {
    case 'downtown': {
      // 2x2 torres
      const cx = (b.ix0 + b.ix1) / 2, cz = (b.iz0 + b.iz1) / 2;
      const distCenter = Math.hypot(cx, cz);
      const lots = splitRect(b.ix0, b.iz0, b.ix1, b.iz1, 2, 2, 3);
      lots.forEach((lot) => {
        const base = 150 - distCenter * 0.28;
        const height = snap(rng.range(base * 0.45, base), 3.6, 24);
        const style = rng.chance(0.55) ? 'glass' : 'office';
        addTower(L, lot, height, style, rng, 1.5);
      });
      break;
    }
    case 'commercial': {
      const lots = splitRect(b.ix0, b.iz0, b.ix1, b.iz1, 3, 3, 1);
      lots.forEach((lot, idx) => {
        if (idx === 4) {
          // patio central de manzana: estacionamiento interno
          L.surfaces.push({ type: 'concrete', x0: lot.x0, z0: lot.z0, x1: lot.x1, z1: lot.z1 });
          L.props.trees.push({ x: (lot.x0 + lot.x1) / 2, z: (lot.z0 + lot.z1) / 2, s: 1.1 });
          return;
        }
        const r = rng.next();
        let style, height;
        if (r < 0.25) { style = 'shop'; height = snap(rng.range(4.5, 8), 3.5, 4.5); }
        else if (r < 0.6) { style = 'apartment'; height = snap(rng.range(12, 30), 3.5, 8); }
        else if (r < 0.85) { style = 'brick'; height = snap(rng.range(10, 22), 3.5, 8); }
        else { style = 'office'; height = snap(rng.range(18, 36), 3.6, 11); }
        const face = faceToward(b, lot);
        addMidrise(L, lot, height, style, rng, face);
      });
      break;
    }
    case 'coastal': {
      const lots = splitRect(b.ix0, b.iz0, b.ix1, b.iz1, 1, 2, 4);
      lots.forEach((lot) => {
        const height = snap(rng.range(24, 62), 3.2, 16);
        addHotel(L, lot, height, rng);
      });
      break;
    }
    case 'industrial': {
      const lots = splitRect(b.ix0, b.iz0, b.ix1, b.iz1, 2, 2, 4);
      lots.forEach((lot, idx) => {
        if (idx === 3 && rng.chance(0.6)) return makeContainerYard(L, { ix0: lot.x0, iz0: lot.z0, ix1: lot.x1, iz1: lot.z1, kind: 'lot' }, rng);
        addWarehouse(L, lot, rng);
      });
      break;
    }
    case 'rich': {
      const lots = splitRect(b.ix0, b.iz0, b.ix1, b.iz1, 2, 2, 0);
      lots.forEach((lot) => addMansion(L, b, lot, rng));
      break;
    }
    case 'suburbs': {
      const lots = splitRect(b.ix0, b.iz0, b.ix1, b.iz1, 4, 4, 0);
      lots.forEach((lot, idx) => {
        const gx = idx % 4, gz = Math.floor(idx / 4);
        const inner = gx > 0 && gx < 3 && gz > 0 && gz < 3;
        if (inner) {
          L.surfaces.push({ type: 'grass', x0: lot.x0, z0: lot.z0, x1: lot.x1, z1: lot.z1 });
          if (rng.chance(0.8)) L.props.trees.push({ x: rng.range(lot.x0 + 3, lot.x1 - 3), z: rng.range(lot.z0 + 3, lot.z1 - 3), s: rng.range(0.9, 1.3) });
          return;
        }
        // orientación: hacia el borde más cercano de la manzana
        let face;
        if (gz === 0) face = 'n'; else if (gz === 3) face = 's'; else if (gx === 0) face = 'w'; else face = 'e';
        addHouse(L, lot, face, rng);
      });
      break;
    }
  }
}

function splitRect(x0, z0, x1, z1, nx, nz, gap) {
  const out = [];
  const w = (x1 - x0 - gap * (nx - 1)) / nx;
  const d = (z1 - z0 - gap * (nz - 1)) / nz;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const lx0 = x0 + i * (w + gap), lz0 = z0 + j * (d + gap);
      out.push({ x0: lx0, z0: lz0, x1: lx0 + w, z1: lz0 + d });
    }
  }
  return out;
}

function snap(v, step, min) {
  return Math.max(min, Math.round(v / step) * step);
}

// lado de la manzana al que mira un lote (la calle más cercana)
function faceToward(b, lot) {
  const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
  const dn = cz - b.iz0, ds = b.iz1 - cz, dw = cx - b.ix0, de = b.ix1 - cx;
  const m = Math.min(dn, ds, dw, de);
  if (m === dn) return 'n';
  if (m === ds) return 's';
  if (m === dw) return 'w';
  return 'e';
}

function shrink(r, m) {
  return { x0: r.x0 + m, z0: r.z0 + m, x1: r.x1 - m, z1: r.z1 - m };
}

// ---------------------------------------------------------------------------
// Tipologías de edificio. Cada edificio = lista de volúmenes (boxes) + detalles.
// ---------------------------------------------------------------------------
function addTower(L, lot, height, style, rng, margin) {
  const r = shrink(lot, margin);
  const bay = 3;
  // footprint múltiplo de la grilla de ventanas para que no queden cortadas
  const w = Math.floor((r.x1 - r.x0) / bay) * bay, d = Math.floor((r.z1 - r.z0) / bay) * bay;
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  const bld = { style, kind: 'tower', parts: [], details: [], height, tint: towerTint(style, rng), uOffset: rng.int(0, 3) };
  const lobby = 5.4;
  bld.parts.push({ x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2, y0: CURB, y1: CURB + lobby, mat: 'lobby' });
  if (height > 70 && rng.chance(0.75)) {
    const h1 = snap(height * rng.range(0.5, 0.65), 3.6, 20);
    bld.parts.push({ x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2, y0: CURB + lobby, y1: CURB + lobby + h1, mat: style });
    const w2 = Math.max(9, Math.floor((w * 0.72) / bay) * bay), d2 = Math.max(9, Math.floor((d * 0.72) / bay) * bay);
    bld.parts.push({ x0: cx - w2 / 2, z0: cz - d2 / 2, x1: cx + w2 / 2, z1: cz + d2 / 2, y0: CURB + lobby + h1, y1: CURB + lobby + height, mat: style });
    bld.top = { x0: cx - w2 / 2, z0: cz - d2 / 2, x1: cx + w2 / 2, z1: cz + d2 / 2, y: CURB + lobby + height };
    bld.details.push({ type: 'ledge', x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2, y: CURB + lobby + h1 });
  } else {
    bld.parts.push({ x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2, y0: CURB + lobby, y1: CURB + lobby + height, mat: style });
    bld.top = { x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2, y: CURB + lobby + height };
  }
  bld.details.push({ type: 'canopy', x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2, y: CURB + 4.2 });
  addRoofDetails(bld, rng, height > 110);
  bld.footprint = { x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2 };
  // neón en azoteas y bordes (skyline nocturno)
  if (rng.chance(0.22)) bld.details.push({ type: 'roofSign', word: rng.pick(['VEGA', 'CASINO', 'SAN VEGA', 'COSTA AZUL', 'HOTEL']), face: rng.pick(['n', 's', 'e', 'w']), ...bld.top });
  if (rng.chance(0.3)) bld.details.push({ type: 'trim', ...bld.top, color: rng.pick(NEON_HEX) });
  L.surfaces.push({ type: 'plaza', x0: lot.x0, z0: lot.z0, x1: lot.x1, z1: lot.z1 });
  L.buildings.push(bld);
}

function towerTint(style, rng) {
  if (style === 'glass') return rng.pick([0xffffff, 0xd8f0ff, 0xc8ffef, 0xffe9d6, 0xe0e4ff]);
  return rng.pick([0xffffff, 0xf2ebe0, 0xe4e7ea, 0xeadfd2]);
}

function addRoofDetails(bld, rng, antenna) {
  const t = bld.top;
  const w = t.x1 - t.x0, d = t.z1 - t.z0;
  bld.details.push({ type: 'parapet', ...t });
  const n = Math.min(5, Math.floor((w * d) / 160) + 1);
  for (let i = 0; i < n; i++) {
    const sx = rng.range(2, 4), sz = rng.range(2, 4), sy = rng.range(1.2, 2.6);
    const x = rng.range(t.x0 + 2 + sx / 2, t.x1 - 2 - sx / 2), z = rng.range(t.z0 + 2 + sz / 2, t.z1 - 2 - sz / 2);
    bld.details.push({ type: 'hvac', x0: x - sx / 2, x1: x + sx / 2, z0: z - sz / 2, z1: z + sz / 2, y0: t.y, y1: t.y + sy });
  }
  if (antenna) bld.details.push({ type: 'antenna', x: (t.x0 + t.x1) / 2, z: (t.z0 + t.z1) / 2, y: t.y, h: rng.range(12, 24) });
}

function addMidrise(L, lot, height, style, rng, face) {
  const r = shrink(lot, 0.6);
  const bay = 3;
  const w = Math.max(6, Math.floor((r.x1 - r.x0) / bay) * bay), d = Math.max(6, Math.floor((r.z1 - r.z0) / bay) * bay);
  // pegado a la calle (frente) para un borde urbano continuo
  let cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  if (face === 'n') cz = r.z0 + d / 2; else if (face === 's') cz = r.z1 - d / 2;
  else if (face === 'w') cx = r.x0 + w / 2; else cx = r.x1 - w / 2;
  const tint = style === 'brick' ? rng.pick([0xffffff, 0xe8d6cc, 0xd9c0b0]) : rng.chance(0.55) ? rng.pick(PASTEL) : rng.pick([0xf4efe6, 0xe9e1d0, 0xdfe7ee, 0xf2dccb, 0xe3ecd9, 0xf0e2b8, 0xd4d9e6]);
  const bld = { style, kind: 'midrise', parts: [], details: [], height, tint, face, uOffset: rng.int(0, 3) };
  const shopH = 4.5;
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  if (style === 'shop') {
    bld.parts.push({ x0, z0, x1, z1, y0: CURB, y1: CURB + shopH, mat: 'storefront' });
    if (height > shopH) bld.parts.push({ x0, z0, x1, z1, y0: CURB + shopH, y1: CURB + height, mat: 'apartment' });
  } else {
    bld.parts.push({ x0, z0, x1, z1, y0: CURB, y1: CURB + shopH, mat: 'storefront' });
    bld.parts.push({ x0, z0, x1, z1, y0: CURB + shopH, y1: CURB + shopH + height, mat: style });
  }
  const topY = CURB + (style === 'shop' ? Math.max(height, shopH) : shopH + height);
  bld.top = { x0, z0, x1, z1, y: topY };
  bld.details.push({ type: 'awning', face, x0, z0, x1, z1, y: CURB + 3.4, color: rng.pick([0xc0392b, 0x2e86de, 0x27ae60, 0xf39c12, 0x8e44ad, 0x34495e]) });
  if (style === 'apartment' || style === 'brick') {
    bld.details.push({ type: 'balconies', face, x0, z0, x1, z1, y0: CURB + shopH, y1: topY, floor: 3.5, bay: 3, every: rng.int(2, 3) });
  }
  addRoofDetails(bld, rng, false);
  bld.footprint = { x0, z0, x1, z1 };
  // cartel de neón sobre el local de la planta baja
  if (rng.chance(0.6)) bld.details.push({ type: 'sign', face, word: rng.pick(SHOP_WORDS), x0, z0, x1, z1, y: CURB + 4.6 });
  if (rng.chance(0.25)) bld.details.push({ type: 'trim', ...bld.top, color: rng.pick(NEON_HEX) });
  L.buildings.push(bld);
}

function addHotel(L, lot, height, rng) {
  const r = shrink(lot, 3);
  const bay = 3;
  const w = Math.floor(Math.min(r.x1 - r.x0, 30) / bay) * bay, d = Math.floor((r.z1 - r.z0) / bay) * bay;
  const cx = r.x1 - w / 2 - 2, cz = (r.z0 + r.z1) / 2; // hacia el mar (este)
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const bld = { style: 'hotel', kind: 'hotel', parts: [], details: [], height, tint: rng.pick(PASTEL), face: 'e', uOffset: 0 };
  bld.parts.push({ x0, z0, x1, z1, y0: CURB, y1: CURB + 5, mat: 'lobby' });
  bld.parts.push({ x0, z0, x1, z1, y0: CURB + 5, y1: CURB + 5 + height, mat: 'hotel' });
  bld.top = { x0, z0, x1, z1, y: CURB + 5 + height };
  bld.details.push({ type: 'balconies', face: 'e', x0, z0, x1, z1, y0: CURB + 5, y1: CURB + 5 + height, floor: 3.2, bay: 3, every: 1 });
  bld.details.push({ type: 'balconies', face: 'w', x0, z0, x1, z1, y0: CURB + 5, y1: CURB + 5 + height, floor: 3.2, bay: 3, every: 2 });
  bld.details.push({ type: 'canopy', x0, z0, x1, z1, y: CURB + 4 });
  addRoofDetails(bld, rng, false);
  bld.footprint = { x0, z0, x1, z1 };
  // estética de costa: cartel vertical "HOTEL", nombre, tubos de neón y luz de color en la fachada al mar
  const neon = rng.pick(NEON_HEX);
  bld.details.push({ type: 'vsign', face: 'e', word: 'HOTEL', x: x1, z: z0 + 2.2, y: CURB + 8, h: Math.min(12, height * 0.35) });
  bld.details.push({ type: 'sign', face: 'e', word: rng.pick(['HOTEL SOL', 'HOTEL MAR', 'HOTEL CORAL', 'HOTEL BRISA', 'HOTEL ARENA']), x0, z0, x1, z1, y: CURB + 4.5, w: 9 });
  bld.details.push({ type: 'trim', ...bld.top, color: neon });
  bld.details.push({ type: 'band', x0, z0, x1, z1, y: CURB + 5, color: neon });
  bld.details.push({ type: 'wash', face: 'e', x0, z0, x1, z1, y: CURB, h: Math.min(26, height * 0.6), color: rng.pick(NEON_HEX) });
  // jardín y palmeras delante del hotel
  L.surfaces.push({ type: 'plaza', x0: lot.x0, z0: lot.z0, x1: lot.x1, z1: lot.z1 });
  L.surfaces.push({ type: 'pool', x0: lot.x0 + 3, z0: cz - 5, x1: Math.min(x0 - 3, lot.x0 + 15), z1: cz + 5 });
  for (let i = 0; i < 4; i++) L.props.palms.push({ x: lot.x0 + 2.5, z: lot.z0 + 3 + i * ((lot.z1 - lot.z0 - 6) / 3), s: rng.range(0.9, 1.2) });
}

function addWarehouse(L, lot, rng) {
  const r = shrink(lot, 3);
  const x0 = r.x0, x1 = r.x1 - rng.range(0, 6), z0 = r.z0 + rng.range(0, 5), z1 = r.z1;
  const height = rng.range(8, 13);
  const bld = { style: 'industrial', kind: 'warehouse', parts: [], details: [], height, tint: rng.pick([0xffffff, 0xd6e4f0, 0xf0e0c8, 0xd0e8d8, 0xe8d0d0]), uOffset: 0 };
  bld.parts.push({ x0, z0, x1, z1, y0: CURB, y1: CURB + height, mat: 'industrial', roof: 'roofMetal' });
  bld.top = { x0, z0, x1, z1, y: CURB + height };
  // portones
  const doors = Math.max(1, Math.floor((x1 - x0) / 9));
  for (let i = 0; i < doors; i++) {
    const dx = x0 + (i + 0.5) * ((x1 - x0) / doors);
    bld.details.push({ type: 'rollerDoor', face: 's', x: dx, z: z1, w: 4.5, h: 5 });
  }
  for (let i = 0; i < 3; i++) {
    const sx = (x1 - x0) * 0.15;
    const x = x0 + (i + 0.5) * ((x1 - x0) / 3);
    bld.details.push({ type: 'skylight', x0: x - sx / 2, x1: x + sx / 2, z0: z0 + 3, z1: z1 - 3, y: CURB + height });
  }
  if (rng.chance(0.45)) bld.details.push({ type: 'chimney', x: x0 + 3, z: z0 + 3, y: CURB + height, h: rng.range(10, 18), r: 1.1 });
  bld.footprint = { x0, z0, x1, z1 };
  L.buildings.push(bld);
  L.surfaces.push({ type: 'concrete', x0: lot.x0, z0: lot.z0, x1: lot.x1, z1: lot.z1 });
  L.props.walls.push(...fenceAround(lot, 's', 2.2, 'fence', 10));
}

function addMansion(L, b, lot, rng) {
  const r = shrink(lot, 4);
  const face = faceToward(b, lot);
  L.surfaces.push({ type: 'grass', x0: lot.x0, z0: lot.z0, x1: lot.x1, z1: lot.z1 });
  const mw = rng.range(16, 22), md = rng.range(11, 14);
  const cx = (r.x0 + r.x1) / 2 + rng.range(-3, 3), cz = (r.z0 + r.z1) / 2 + rng.range(-3, 3);
  const bld = { style: 'mansion', kind: 'mansion', parts: [], details: [], height: 7, tint: rng.pick([0xffffff, 0xf7f3ea, 0xeef3f7, 0xf3eee4]), uOffset: 0, face };
  const x0 = cx - mw / 2, x1 = cx + mw / 2, z0 = cz - md / 2, z1 = cz + md / 2;
  bld.parts.push({ x0, z0, x1, z1, y0: CURB, y1: CURB + 3.6, mat: 'mansion' });
  // planta alta desplazada (arquitectura moderna)
  const ox = rng.range(-3, 3);
  const ux0 = x0 + 2 + ox, ux1 = x1 - 4 + ox;
  bld.parts.push({ x0: ux0, z0: z0 - 1.5, x1: ux1, z1: z1 - 2, y0: CURB + 3.6, y1: CURB + 7.0, mat: 'mansion' });
  // ala lateral
  const wingLeft = rng.chance(0.5);
  const wx0 = wingLeft ? x0 - 8 : x1, wx1 = wingLeft ? x0 : x1 + 8;
  bld.parts.push({ x0: wx0, z0: cz - 3, x1: wx1, z1: cz + 5, y0: CURB, y1: CURB + 3.2, mat: 'mansion' });
  bld.top = { x0: ux0, z0: z0 - 1.5, x1: ux1, z1: z1 - 2, y: CURB + 7.0 };
  bld.details.push({ type: 'slab', x0: x0 - 1, x1: x1 + 1, z0: z0 - 2.5, z1: z1 + 1, y: CURB + 3.6, t: 0.35 });
  bld.details.push({ type: 'slab', x0: ux0 - 1, x1: ux1 + 1, z0: z0 - 2.5, z1: z1 - 1, y: CURB + 7.0, t: 0.35 });
  bld.details.push({ type: 'slab', x0: wx0 - 0.5, x1: wx1 + 0.5, z0: cz - 3.5, z1: cz + 5.5, y: CURB + 3.2, t: 0.3 });
  bld.footprint = { x0: Math.min(x0, wx0), z0, x1: Math.max(x1, wx1), z1 };
  bld.colliders = [
    { x0, z0, x1, z1 },
    { x0: wx0, z0: cz - 3, x1: wx1, z1: cz + 5 },
  ];
  L.buildings.push(bld);
  // pileta en el patio trasero
  const back = face === 'n' ? 's' : face === 's' ? 'n' : face === 'w' ? 'e' : 'w';
  let pool;
  if (back === 's') pool = { x0: cx - 5, x1: cx + 5, z0: z1 + 3, z1: Math.min(z1 + 8, lot.z1 - 2) };
  else if (back === 'n') pool = { x0: cx - 5, x1: cx + 5, z0: Math.max(z0 - 8, lot.z0 + 2), z1: z0 - 3 };
  else if (back === 'e') pool = { x0: Math.max(x1, wx1) + 2, x1: Math.min(Math.max(x1, wx1) + 7, lot.x1 - 2), z0: cz - 4, z1: cz + 4 };
  else pool = { x0: Math.max(Math.min(x0, wx0) - 7, lot.x0 + 2), x1: Math.min(x0, wx0) - 2, z0: cz - 4, z1: cz + 4 };
  if (pool.x1 - pool.x0 > 3 && pool.z1 - pool.z0 > 3) {
    L.surfaces.push({ type: 'deck', x0: pool.x0 - 1.2, z0: pool.z0 - 1.2, x1: pool.x1 + 1.2, z1: pool.z1 + 1.2 });
    L.surfaces.push({ type: 'pool', ...pool });
  }
  // muro perimetral con portón hacia la calle
  L.props.walls.push(...fenceAround(lot, face, 1.4, 'hedge', 6));
  for (let i = 0; i < 5; i++) {
    const tx = rng.range(lot.x0 + 2, lot.x1 - 2), tz = rng.range(lot.z0 + 2, lot.z1 - 2);
    if (tx > bld.footprint.x0 - 3 && tx < bld.footprint.x1 + 3 && tz > z0 - 4 && tz < z1 + 3) continue;
    if (tx > pool.x0 - 2 && tx < pool.x1 + 2 && tz > pool.z0 - 2 && tz < pool.z1 + 2) continue;
    L.props.trees.push({ x: tx, z: tz, s: rng.range(0.9, 1.4) });
  }
}

function addHouse(L, lot, face, rng) {
  L.surfaces.push({ type: 'grass', x0: lot.x0, z0: lot.z0, x1: lot.x1, z1: lot.z1 });
  const along = face === 'n' || face === 's'; // fachada paralela a X
  const fw = rng.range(9, 11.5), fd = rng.range(7.5, 9);
  const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
  const sx = along ? fw : fd, sz = along ? fd : fw;
  // retiro desde la vereda
  const setback = 6;
  let hx = cx, hz = cz;
  if (face === 'n') hz = lot.z0 + setback + sz / 2;
  else if (face === 's') hz = lot.z1 - setback - sz / 2;
  else if (face === 'w') hx = lot.x0 + setback + sx / 2;
  else hx = lot.x1 - setback - sx / 2;
  const floors = rng.chance(0.4) ? 2 : 1;
  const wallH = floors * 3;
  const x0 = hx - sx / 2, x1 = hx + sx / 2, z0 = hz - sz / 2, z1 = hz + sz / 2;
  const bld = {
    style: 'house', kind: 'house', parts: [], details: [], height: wallH + 2.6,
    tint: rng.pick([0xf5ecd7, 0xe6f0f5, 0xf5dfd3, 0xe5efd9, 0xf2f2f2, 0xf3e1b6, 0xd9e2f1, 0xeed9e4]), face, uOffset: 0,
  };
  bld.parts.push({ x0, z0, x1, z1, y0: CURB, y1: CURB + wallH, mat: 'house', roof: null });
  bld.details.push({ type: 'gable', x0: x0 - 0.5, z0: z0 - 0.5, x1: x1 + 0.5, z1: z1 + 0.5, y: CURB + wallH, h: rng.range(2, 2.8), alongX: along, color: rng.pick([0x8c3b2e, 0x5a5f66, 0x6b4a3a, 0x3f4a5a, 0x7a2f2a]) });
  bld.details.push({ type: 'door', face, x0, z0, x1, z1 });
  bld.top = null;
  // garaje y entrada de auto
  const garageSide = rng.chance(0.5) ? -1 : 1;
  let gx0, gx1, gz0, gz1;
  if (along) {
    gx0 = garageSide < 0 ? x0 - 4.5 : x1; gx1 = gx0 + 4.5; gz0 = face === 'n' ? z0 : z1 - 6; gz1 = gz0 + 6;
    const dz0 = face === 'n' ? lot.z0 : gz1, dz1 = face === 'n' ? gz0 : lot.z1;
    L.surfaces.push({ type: 'driveway', x0: gx0 + 0.5, x1: gx1 - 0.5, z0: dz0, z1: dz1 });
  } else {
    gz0 = garageSide < 0 ? z0 - 4.5 : z1; gz1 = gz0 + 4.5; gx0 = face === 'w' ? x0 : x1 - 6; gx1 = gx0 + 6;
    const dx0 = face === 'w' ? lot.x0 : gx1, dx1 = face === 'w' ? gx0 : lot.x1;
    L.surfaces.push({ type: 'driveway', x0: dx0, x1: dx1, z0: gz0 + 0.5, z1: gz1 - 0.5 });
  }
  bld.parts.push({ x0: gx0, z0: gz0, x1: gx1, z1: gz1, y0: CURB, y1: CURB + 3, mat: 'house', roof: 'roofFlat' });
  bld.details.push({ type: 'garageDoor', face, x0: gx0, z0: gz0, x1: gx1, z1: gz1 });
  bld.footprint = { x0: Math.min(x0, gx0), z0: Math.min(z0, gz0), x1: Math.max(x1, gx1), z1: Math.max(z1, gz1) };
  bld.colliders = [{ x0, z0, x1, z1 }, { x0: gx0, z0: gz0, x1: gx1, z1: gz1 }];
  L.buildings.push(bld);
  // cerco bajo y árbol
  L.props.walls.push(...fenceAround(lot, face, 0.9, 'picket', 5, true));
  const tcorner = face === 'n' || face === 's' ? { x: garageSide < 0 ? x1 + 3 : x0 - 3, z: face === 'n' ? lot.z0 + 3 : lot.z1 - 3 } : { x: face === 'w' ? lot.x0 + 3 : lot.x1 - 3, z: garageSide < 0 ? z1 + 3 : z0 - 3 };
  if (tcorner.x > lot.x0 + 1 && tcorner.x < lot.x1 - 1 && tcorner.z > lot.z0 + 1 && tcorner.z < lot.z1 - 1) L.props.trees.push({ ...tcorner, s: rng.range(0.8, 1.2) });
}

// Cerco perimetral de un lote con abertura (portón) en el frente.
function fenceAround(lot, face, height, type, gate, frontOnly = false) {
  const segs = [];
  const t = type === 'hedge' ? 0.8 : 0.15;
  const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
  const sides = frontOnly ? [face] : ['n', 's', 'w', 'e'];
  for (const s of sides) {
    if (s === 'n' || s === 's') {
      const z = s === 'n' ? lot.z0 + t / 2 : lot.z1 - t / 2;
      if (s === face) {
        segs.push({ x0: lot.x0, x1: cx - gate / 2, z0: z - t / 2, z1: z + t / 2, h: height, type });
        segs.push({ x0: cx + gate / 2, x1: lot.x1, z0: z - t / 2, z1: z + t / 2, h: height, type });
      } else segs.push({ x0: lot.x0, x1: lot.x1, z0: z - t / 2, z1: z + t / 2, h: height, type });
    } else {
      const x = s === 'w' ? lot.x0 + t / 2 : lot.x1 - t / 2;
      if (s === face) {
        segs.push({ x0: x - t / 2, x1: x + t / 2, z0: lot.z0, z1: cz - gate / 2, h: height, type });
        segs.push({ x0: x - t / 2, x1: x + t / 2, z0: cz + gate / 2, z1: lot.z1, h: height, type });
      } else segs.push({ x0: x - t / 2, x1: x + t / 2, z0: lot.z0, z1: lot.z1, h: height, type });
    }
  }
  return segs;
}

// ---------------------------------------------------------------------------
// Manzanas especiales
// ---------------------------------------------------------------------------
function makePark(L, b, rng) {
  L.surfaces.push({ type: 'grass', x0: b.ix0, z0: b.iz0, x1: b.ix1, z1: b.iz1 });
  const cx = (b.ix0 + b.ix1) / 2, cz = (b.iz0 + b.iz1) / 2;
  // senderos en cruz y diagonal
  L.surfaces.push({ type: 'path', x0: cx - 2, x1: cx + 2, z0: b.iz0, z1: b.iz1 });
  L.surfaces.push({ type: 'path', x0: b.ix0, x1: b.ix1, z0: cz - 2, z1: cz + 2 });
  L.surfaces.push({ type: 'path', x0: cx - 9, x1: cx + 9, z0: cz - 9, z1: cz + 9 });
  L.props.fountains.push({ x: cx, z: cz, r: 4.5 });
  const pond = { x0: b.ix0 + 8, x1: b.ix0 + 26, z0: b.iz1 - 24, z1: b.iz1 - 8 };
  L.surfaces.push({ type: 'pond', ...pond });
  for (let i = 0; i < 46; i++) {
    const x = rng.range(b.ix0 + 3, b.ix1 - 3), z = rng.range(b.iz0 + 3, b.iz1 - 3);
    if (Math.abs(x - cx) < 4.5 || Math.abs(z - cz) < 4.5) continue;
    if (Math.abs(x - cx) < 12 && Math.abs(z - cz) < 12) continue;
    if (x > pond.x0 - 2 && x < pond.x1 + 2 && z > pond.z0 - 2 && z < pond.z1 + 2) continue;
    L.props.trees.push({ x, z, s: rng.range(0.85, 1.5) });
  }
  for (const [dx, dz, rot] of [[-6, -3.2, 0], [6, -3.2, 0], [-6, 3.2, Math.PI], [6, 3.2, Math.PI], [-3.2, -6, Math.PI / 2], [3.2, 6, -Math.PI / 2]]) {
    L.props.benches.push({ x: cx + dx, z: cz + dz, rot });
  }
  L.landmarks.push({ name: b.name, x: cx, z: cz, type: 'park' });
}

function makePlaza(L, b, rng) {
  L.surfaces.push({ type: 'plaza', x0: b.ix0, z0: b.iz0, x1: b.ix1, z1: b.iz1 });
  const cx = (b.ix0 + b.ix1) / 2, cz = (b.iz0 + b.iz1) / 2;
  L.props.fountains.push({ x: cx, z: cz, r: 7 });
  L.surfaces.push({ type: 'grass', x0: b.ix0 + 4, x1: b.ix0 + 18, z0: b.iz0 + 4, z1: b.iz1 - 4 });
  L.surfaces.push({ type: 'grass', x0: b.ix1 - 18, x1: b.ix1 - 4, z0: b.iz0 + 4, z1: b.iz1 - 4 });
  for (let i = 0; i < 6; i++) {
    const z = b.iz0 + 8 + i * ((b.iz1 - b.iz0 - 16) / 5);
    L.props.trees.push({ x: b.ix0 + 11, z, s: 1.2 });
    L.props.trees.push({ x: b.ix1 - 11, z, s: 1.2 });
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    L.props.benches.push({ x: cx + Math.cos(a) * 12, z: cz + Math.sin(a) * 12, rot: -a - Math.PI / 2 });
  }
  L.landmarks.push({ name: b.name, x: cx, z: cz, type: 'plaza' });
}

function makeParking(L, b, rng) {
  L.surfaces.push({ type: 'parking', x0: b.ix0, z0: b.iz0, x1: b.ix1, z1: b.iz1 });
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    const z = b.iz0 + 10 + r * ((b.iz1 - b.iz0 - 20) / (rows - 1));
    for (let x = b.ix0 + 6; x < b.ix1 - 6; x += 3) {
      if (rng.chance(0.45)) L.props.cars.push({ x: x + 1.5, z, rot: r % 2 ? 0 : Math.PI, seed: rng.int(0, 9999) });
    }
  }
  for (let x = b.ix0 + 4; x < b.ix1; x += 16) L.props.lamps.push({ x, z: (b.iz0 + b.iz1) / 2, rot: 0, double: true });
  L.landmarks.push({ name: b.name, x: (b.ix0 + b.ix1) / 2, z: (b.iz0 + b.iz1) / 2, type: 'parking' });
}

function makeContainerYard(L, b, rng) {
  L.surfaces.push({ type: 'concrete', x0: b.ix0, z0: b.iz0, x1: b.ix1, z1: b.iz1 });
  const colors = [0xb03a2e, 0x1f618d, 0x117a65, 0xb9770e, 0x6c3483, 0x7b7d7d, 0x2e4053];
  for (let x = b.ix0 + 4; x < b.ix1 - 8; x += 7) {
    for (let z = b.iz0 + 4; z < b.iz1 - 14; z += 16) {
      if (rng.chance(0.25)) continue;
      const stack = rng.int(1, 3);
      for (let s = 0; s < stack; s++) L.props.containers.push({ x: x + 1.25, z: z + 6, y: CURB + s * 2.6, rot: 0, color: rng.pick(colors) });
    }
  }
  if (b.kind !== 'lot') L.landmarks.push({ name: b.name, x: (b.ix0 + b.ix1) / 2, z: (b.iz0 + b.iz1) / 2, type: 'yard' });
  L.props.walls.push(...fenceAround({ x0: b.ix0, z0: b.iz0, x1: b.ix1, z1: b.iz1 }, 's', 2.2, 'fence', 12));
}

// ---------------------------------------------------------------------------
// Mobiliario urbano sobre veredas e intersecciones
// ---------------------------------------------------------------------------
function addStreetProps(L) {
  const rng = createRng(4242);
  for (const b of L.blocks) {
    const greenStreet = b.district === 'rich' || b.district === 'suburbs' || b.district === 'coastal' || b.kind === 'park';
    const sides = [
      { axis: 'x', z: b.z0 + 0.9, x0: b.x0, x1: b.x1, rot: 0 },
      { axis: 'x', z: b.z1 - 0.9, x0: b.x0, x1: b.x1, rot: Math.PI },
      { axis: 'z', x: b.x0 + 0.9, z0: b.z0, z1: b.z1, rot: Math.PI / 2 },
      { axis: 'z', x: b.x1 - 0.9, z0: b.z0, z1: b.z1, rot: -Math.PI / 2 },
    ];
    for (const s of sides) {
      const len = s.axis === 'x' ? s.x1 - s.x0 : s.z1 - s.z0;
      const n = Math.max(2, Math.round(len / 28));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        if (s.axis === 'x') L.props.lamps.push({ x: s.x0 + t * len, z: s.z, rot: s.rot });
        else L.props.lamps.push({ x: s.x, z: s.z0 + t * len, rot: s.rot });
      }
      if (greenStreet || b.district === 'commercial' || b.district === 'downtown') {
        const tn = Math.max(2, Math.round(len / 14));
        for (let i = 0; i < tn; i++) {
          const t = (i + 0.5) / tn;
          // no plantar sobre faroles
          if (Math.abs((t * n) % 1 - 0.5) < 0.18) continue;
          if (!greenStreet && rng.chance(0.4)) continue;
          const palm = b.district === 'coastal' || ((b.district === 'commercial' || b.district === 'downtown') && rng.chance(0.45));
          if (s.axis === 'x') L.props.trees.push({ x: s.x0 + t * len, z: s.z, s: rng.range(0.75, 1.05), street: true, palm });
          else L.props.trees.push({ x: s.x, z: s.z0 + t * len, s: rng.range(0.75, 1.05), street: true, palm });
        }
      }
      if (b.district === 'downtown' || b.district === 'commercial') {
        if (rng.chance(0.6)) {
          const t = rng.range(0.2, 0.8);
          if (s.axis === 'x') L.props.bins.push({ x: s.x0 + t * len, z: s.z + (s.rot === 0 ? 0.4 : -0.4) });
          else L.props.bins.push({ x: s.x + (s.rot > 0 ? 0.4 : -0.4), z: s.z0 + t * len });
        }
      }
    }
    // hidrante en una esquina
    L.props.hydrants.push({ x: b.x0 + 1.6, z: b.z0 + 2.6 });
  }
  // semáforos en cada esquina de las intersecciones (excepto en el borde exterior de la autopista)
  for (const it of L.intersections) {
    const hx = it.wx / 2 + 0.8, hz = it.wz / 2 + 0.8;
    const corners = [
      { dx: -hx, dz: -hz, rot: 0 }, { dx: hx, dz: -hz, rot: -Math.PI / 2 },
      { dx: hx, dz: hz, rot: Math.PI }, { dx: -hx, dz: hz, rot: Math.PI / 2 },
    ];
    for (const c of corners) {
      const x = it.x + c.dx, z = it.z + c.dz;
      if (x < L.roadExtent.min || x > L.roadExtent.max || z < L.roadExtent.min || z > L.roadExtent.max) continue;
      L.props.trafficLights.push({ x, z, rot: c.rot, intersection: it.id });
    }
  }
}

function addBeach(L) {
  const rng = createRng(777);
  L.beach = { ...BEACH, z0: L.roadExtent.min - 40, z1: L.roadExtent.max + 40 };
  // paseo costero de madera
  L.surfaces.push({ type: 'boardwalk', x0: BEACH.x0, x1: BEACH.x0 + 7, z0: L.roadExtent.min, z1: L.roadExtent.max, y: 0.35 });
  const nearPier = (z, m = 10) => z > PIER.z0 - m && z < PIER.z1 + m;
  for (let z = L.roadExtent.min + 10; z < L.roadExtent.max - 10; z += 22) {
    const pz = z + rng.range(-5, 5);
    if (!nearPier(pz)) L.props.palms.push({ x: BEACH.x0 + 12 + rng.range(0, 10), z: pz, s: rng.range(0.9, 1.3), beach: true });
    if (rng.chance(0.5) && !nearPier(z + 8, 3)) L.props.benches.push({ x: BEACH.x0 + 6.2, z: z + 8, rot: -Math.PI / 2, y: 0.35 });
  }
  for (let z = L.roadExtent.min + 20; z < L.roadExtent.max; z += 25) if (!nearPier(z, 3)) L.props.lamps.push({ x: BEACH.x0 + 6.6, z, rot: -Math.PI / 2, y: 0.35 });
  // equipamiento de playa: sombrillas con reposeras, guardavidas, casetas y vóley
  const B = L.beachProps;
  const umbrellaColors = [0xff2f7d, 0x2ff5ff, 0xffe14d, 0xff8a3d, 0xb45cff, 0x4dff88, 0xffffff];
  for (let z = L.roadExtent.min + 15; z < L.roadExtent.max - 15; z += 9) {
    for (let x = 532; x < 584; x += 11) {
      if (nearPier(z, 8) || !rng.chance(0.42)) continue;
      B.umbrellas.push({ x: x + rng.range(-2, 2), z: z + rng.range(-2, 2), color: rng.pick(umbrellaColors), rot: rng.range(0, Math.PI * 2) });
    }
  }
  for (let z = L.roadExtent.min + 60; z < L.roadExtent.max; z += 140) if (!nearPier(z, 15)) B.towers.push({ x: 566, z });
  for (let z = L.roadExtent.min + 35; z < L.roadExtent.max; z += 75) if (!nearPier(z, 12)) B.huts.push({ x: 524, z, color: rng.pick(PASTEL) });
  B.nets.push({ x: 560, z: 70 }, { x: 560, z: -300 });
  L.chiringuito = { x: 530, z: -62 };
  L.poleSigns.push({ word: 'CHIRINGUITO', x: 523.5, z: -62, rot: -Math.PI / 2, w: 6, base: 0.35 });
  // muelle con rueda gigante
  L.pier = PIER;
  L.poleSigns.push({ word: 'RUEDA', x: 521.5, z: PIER.z0 - 2.5, rot: -Math.PI / 2, w: 4, base: 0.35 });
  for (let x = PIER.x0 + 12; x < PIER.x1; x += 22) {
    L.props.lamps.push({ x, z: PIER.z0 + 0.6, rot: Math.PI, y: PIER.deck });
    L.props.lamps.push({ x, z: PIER.z1 - 0.6, rot: 0, y: PIER.deck });
  }
  L.landmarks.push({ name: 'Playa Costa Azul', x: BEACH.x0 + 40, z: 0, type: 'beach' });
  L.landmarks.push({ name: 'Muelle y Rueda de Costa Azul', x: 640, z: PIER.z0 - 14, type: 'pier' });
  // carteles de los lugares importantes
  L.poleSigns.push(
    { word: 'TALLER DUARTE', x: -109.5, z: 58, rot: Math.PI / 2, w: 6 },
    { word: 'MODA VEGA', x: -76, z: -309.5, rot: 0, w: 5 },
    { word: 'SURF & SOL', x: 409.5, z: 127, rot: -Math.PI / 2, w: 5 },
    { word: 'CONCESIONARIO', x: 345, z: 309.5, rot: Math.PI, w: 7 },
    { word: 'LA OLA', x: 409.5, z: 328, rot: -Math.PI / 2, w: 4 },
  );
}

// Distrito de un punto del mundo (para HUD y minimapa).
export function districtAt(L, x, z) {
  if (x > BEACH.x0) return 'coastal';
  const bx = Math.floor((x - GRID.origin) / GRID.pitch);
  const bz = Math.floor((z - GRID.origin) / GRID.pitch);
  if (bx < 0 || bz < 0 || bx >= GRID.blocks || bz >= GRID.blocks) return null;
  return districtFor(bx, bz);
}

export function blockAt(L, x, z) {
  for (const b of L.blocks) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return b;
  return null;
}
