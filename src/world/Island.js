import { createRng } from './rng.js';

// ============================================================================
// Isla de San Vega: la ciudad queda en el sudeste y alrededor hay terreno real
// (playas en todo el contorno, cerros, montañas al noroeste, bosque y un lago),
// rutas que salen de la ciudad hacia la montaña y la costa, y lugares nuevos
// (pueblo pescador, faro, observatorio, rancho, mirador).
//
// Todo se calcula una vez en una grilla de alturas de 4 m. Las rutas se
// "tallan" en el terreno (cortes y terraplenes) para que se pueda manejar.
// ============================================================================

export const ISLAND = { minX: -1640, maxX: 1060, minZ: -1600, maxZ: 1100, cell: 4 };
export const SEA = -0.35;
const CENTER = { x: -300, z: -250 };
const RAD = 1250;
const SHAPE = 2.4; // forma de la isla (2 = redonda, más = más cuadrada)
const WATERLINE_EAST = 596; // costa este (playa de Costa Azul)
const BEACH_W = 84; // ancho de playa (de la línea de agua hasta el pasto)

// ---------------------------------------------------------------- ruido
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
export function fbm(x, y, oct = 4) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    v += vnoise(x * f + i * 17.3, y * f - i * 9.1) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return v / norm;
}
function ridged(x, y, oct = 3) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    v += (1 - Math.abs(vnoise(x * f + 31.7 * i, y * f + 7.7 * i) * 2 - 1)) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return v / norm;
}
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

// Altura de la arena en la playa de Costa Azul (x = distancia desde el paseo).
export function beachGround(x) {
  if (x <= 512) return 0;
  if (x <= WATERLINE_EAST) return 0.05 - ((x - 512) / (WATERLINE_EAST - 512)) * 0.4;
  return SEA - (x - WATERLINE_EAST) * 0.03;
}

// montañas: [x, z, altura, radio]
const PEAKS = [
  [-800, -820, 210, 250], // Monte Vega
  [-420, -1120, 135, 200], // Cerro Norte
  [-1120, -440, 125, 200], // Cerro Oeste
  [-700, -330, 45, 140], // Loma del Lago
  [-1080, -1060, 95, 170],
  [-300, 760, 55, 150], // lomas del sur
];

export const ISLAND_REGIONS = {
  monte: { name: 'Monte Vega', color: '#c9b79c' },
  bosque: { name: 'Bosque Grande', color: '#7bd389' },
  puerto: { name: 'Puerto Viejo', color: '#4cc9f0' },
  rancho: { name: 'Rancho Las Palmas', color: '#e9c46a' },
  faro: { name: 'Punta del Faro', color: '#f4f1de' },
  lago: { name: 'Lago Azul', color: '#48cae4' },
  playaSur: { name: 'Playa del Sur', color: '#ffd166' },
  campo: { name: 'Campo de Vega', color: '#a7c957' },
};

export class Island {
  constructor(layout) {
    this.L = layout;
    const E = layout.roadExtent;
    this.city = { min: E.min, max: E.max };
    const c = ISLAND.cell;
    this.W = Math.round((ISLAND.maxX - ISLAND.minX) / c) + 1;
    this.H = Math.round((ISLAND.maxZ - ISLAND.minZ) / c) + 1;
    this.heights = new Float32Array(this.W * this.H);
    this.roadW = new Float32Array(this.W * this.H); // 0..1: cuánto pesa una ruta en la celda
    this.surf = new Uint8Array(this.W * this.H); // 0 pasto, 1 asfalto, 4 arena, 5 agua, 6 tierra/roca
    this.roads = [];
    this.places = [];
    this.pads = [];
    this.lake = { x: -830, z: 70, r: 82, level: 0 };
  }

  // ------------------------------------------------------------ forma de la costa
  // Distancia (aprox., en metros) a la línea de agua: positiva tierra adentro.
  coastDist(x, z) {
    const dx = (x - CENTER.x) / RAD, dz = (z - CENTER.z) / RAD;
    const th = Math.atan2(dz, dx);
    const f = (Math.abs(dx) ** SHAPE + Math.abs(dz) ** SHAPE) ** (1 / SHAPE);
    // bahías y cabos (más suaves cerca de la ciudad, al sudeste)
    const calm = 1 - 0.6 * Math.exp(-((th - 0.73) ** 2) / 0.12);
    const rr = 1 + calm * (0.07 * Math.sin(3 * th + 2.6) + 0.05 * Math.sin(5 * th + 0.4) + 0.03 * Math.sin(11 * th + 2.2) + 0.015 * Math.sin(19 * th + 1.1));
    const sP = (rr - f) * RAD;
    // playa recta de Costa Azul frente a la ciudad; más allá, cabos hacia el mar
    const sE = WATERLINE_EAST - x + Math.pow(Math.max(0, Math.abs(z) - 600), 1.3) * 0.05;
    return Math.min(sP, sE);
  }

  // punto de la costa en una dirección (desde el centro), "inset" metros tierra adentro
  coastPoint(angle, inset) {
    const cx = Math.cos(angle), cz = Math.sin(angle);
    let d = 0;
    while (d < 2500 && this.coastDist(CENTER.x + cx * d, CENTER.z + cz * d) > inset) d += 4;
    return { x: CENTER.x + cx * d, z: CENTER.z + cz * d };
  }

  // distancia afuera del rectángulo de la ciudad (0 adentro)
  cityDist(x, z) {
    const { min, max } = this.city;
    const dx = Math.max(min - x, x - max, 0);
    const dz = Math.max(min - z, z - max, 0);
    return Math.hypot(dx, dz);
  }

  inCityBeach(x, z) {
    return x >= 505 && Math.abs(z) <= this.city.max + 40;
  }

  // ------------------------------------------------------------ altura "natural"
  rawHeight(x, z, withLake = true) {
    const s = this.coastDist(x, z);
    // playa y fondo marino
    let h;
    if (s < 0) h = Math.max(-14, SEA + s * 0.05);
    else h = SEA + 0.4 * Math.min(s, BEACH_W) / BEACH_W + Math.max(0, s - BEACH_W) * 0.012 + 2.2 * smoothstep(BEACH_W, 260, s);
    // cerros, montañas y detalle
    const inland = smoothstep(BEACH_W + 10, 300, s);
    if (inland > 0) {
      const hills = Math.max(0, fbm(x * 0.0026, z * 0.0026) - 0.4) * 80;
      let mtn = 0;
      for (const [px, pz, ph, pr] of PEAKS) {
        const d2 = ((x - px) ** 2 + (z - pz) ** 2) / (pr * pr);
        if (d2 < 9) mtn += ph * Math.exp(-d2 * 1.1);
      }
      mtn *= 0.72 + 0.4 * ridged(x * 0.006, z * 0.006);
      const detail = (fbm(x * 0.025, z * 0.025, 3) - 0.5) * 4;
      h += (hills + mtn + detail) * inland;
    }
    // la ciudad es plana: el terreno baja suavemente hacia ella
    if (this.inCityBeach(x, z)) {
      h = beachGround(x) - 0.12;
    } else {
      const dc = this.cityDist(x, z);
      if (dc <= 0) h = -0.12;
      else h = lerp(x > 505 ? beachGround(x) : 0, h, smoothstep(30, 240, dc));
    }
    // lago
    if (withLake) {
      const lk = this.lake;
      const dl = Math.hypot(x - lk.x, z - lk.z);
      if (dl < lk.r + 60) {
        const floor = lk.level - 0.4 - 3.2 * (1 - smoothstep(0, lk.r, dl));
        const rim = lk.level + 0.5 + (dl - lk.r) * 0.06;
        h = dl < lk.r ? floor : lerp(Math.min(h, rim), h, smoothstep(lk.r, lk.r + 60, dl));
      }
    }
    return h;
  }

  // ------------------------------------------------------------ generación
  *generate() {
    const lk = this.lake;
    lk.level = this.rawHeight(lk.x, lk.z, false) - 2.5;
    yield 'Elevando montañas';
    const c = ISLAND.cell;
    for (let j = 0; j < this.H; j++) {
      const z = ISLAND.minZ + j * c;
      for (let i = 0; i < this.W; i++) this.heights[j * this.W + i] = this.rawHeight(ISLAND.minX + i * c, z);
    }
    yield 'Trazando rutas';
    this.defineRoads();
    this.definePlaces();
    this.carve();
    this.classify();
    this.registerOnLayout();
  }

  defineRoads() {
    const cp = (a, inset) => this.coastPoint(a, inset);
    const P = (x, z) => ({ x, z });
    // Ruta del Monte: de la Autopista Norte (esquina noroeste) hasta la cima
    this.addRoad('Ruta del Monte', 10, [
      P(-512, -500), P(-600, -500), P(-700, -515), P(-820, -545), P(-930, -610), P(-990, -700),
      P(-975, -800), P(-900, -870), P(-800, -900), P(-700, -880), P(-640, -820), P(-650, -745),
      P(-715, -705), P(-780, -730), P(-800, -790),
    ], { start: 0 });
    // Ruta Costera Norte: de la Costanera hacia el Puerto Viejo y el bosque
    const village = cp(-1.22, 95);
    this.village = village;
    this.addRoad('Ruta Costera Norte', 10, [
      P(500, -512), P(504, -620), cp(-0.62, 150), cp(-0.9, 150), cp(-1.1, 130), village,
      cp(-1.4, 150), cp(-1.62, 190), P(-560, -1010), P(-700, -960), P(-800, -905),
    ], { start: 0, joinEnd: true });
    // Camino del Oeste: del Bulevar Vega al lago, el rancho y el faro
    const faro = cp(Math.PI + 0.06, 40);
    this.faro = faro;
    this.addRoad('Camino del Oeste', 9, [
      P(-512, 0), P(-610, 0), P(-700, -25), P(-830, -45), P(-950, -15), P(-1040, 60),
      P(-1120, 110), P(-1220, 60), P(faro.x + 60, faro.z + 10), P(faro.x + 18, faro.z + 2),
    ], { start: 0 });
    // Ruta del Sur: de la Avenida Central a la playa del sur y el rancho
    const south = cp(1.78, 120);
    this.south = south;
    this.addRoad('Ruta del Sur', 10, [
      P(0, 512), P(0, 600), P(-60, 690), P(-170, 750), south, P(south.x - 160, south.z - 30),
      P(-760, 600), P(-930, 440), P(-1030, 290), P(-1060, 170), P(-1080, 110),
    ], { start: 0, joinEnd: true });
  }

  addRoad(name, width, ctrl, opts = {}) {
    // Catmull-Rom muestreado cada ~3 m
    const pts = [];
    const n = ctrl.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(n - 1, i + 2)];
      const len = Math.hypot(p2.x - p1.x, p2.z - p1.z);
      const steps = Math.max(2, Math.ceil(len / 3));
      for (let k = 0; k < steps; k++) {
        const t = k / steps, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c2, d) => 0.5 * (2 * b + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t2 + (-a + 3 * b - 3 * c2 + d) * t3);
        pts.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
      }
    }
    pts.push({ ...ctrl[n - 1] });
    // perfil de alturas: terreno suavizado + pendiente máxima
    let dist = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) dist += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      pts[i].d = dist;
      pts[i].raw = Math.max(SEA + 0.8, this.sample(pts[i].x, pts[i].z));
    }
    const win = 18;
    for (let i = 0; i < pts.length; i++) {
      let s = 0, w = 0;
      for (let k = -win; k <= win; k++) {
        const q = pts[Math.min(pts.length - 1, Math.max(0, i + k))];
        const ww = 1 - Math.abs(k) / (win + 1);
        s += q.raw * ww; w += ww;
      }
      pts[i].y = s / w;
    }
    if (opts.start != null) {
      // tramo inicial pegado a la ciudad
      for (const p of pts) if (p.d < 40) p.y = opts.start;
    }
    const G = 0.17;
    for (let i = 1; i < pts.length; i++) {
      const ds = pts[i].d - pts[i - 1].d;
      pts[i].y = Math.min(pts[i - 1].y + G * ds, Math.max(pts[i - 1].y - G * ds, pts[i].y));
    }
    for (let i = pts.length - 2; i >= 0; i--) {
      const ds = pts[i + 1].d - pts[i].d;
      if (pts[i].d < 40 && opts.start != null) continue;
      pts[i].y = Math.min(pts[i + 1].y + G * ds, Math.max(pts[i + 1].y - G * ds, pts[i].y));
    }
    // dirección de cada punto
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      pts[i].tx = (b.x - a.x) / l;
      pts[i].tz = (b.z - a.z) / l;
    }
    const road = { name, width, pts, length: dist };
    this.roads.push(road);
    return road;
  }

  definePlaces() {
    const v = this.village, f = this.faro, s = this.south;
    const top = this.roads[0].pts[this.roads[0].pts.length - 1];
    this.places = [
      { id: 'observatorio', name: 'Observatorio Monte Vega', x: top.x - 6, z: top.z - 34, r: 34, type: 'observatory' },
      { id: 'mirador', name: 'Mirador del Monte', x: -955, z: -640, r: 16, type: 'mirador' },
      { id: 'puerto', name: 'Puerto Viejo', x: v.x, z: v.z - 25, r: 55, type: 'village' },
      { id: 'faro', name: 'Faro del Oeste', x: f.x, z: f.z, r: 22, type: 'lighthouse' },
      { id: 'rancho', name: 'Rancho Las Palmas', x: -1150, z: 200, r: 45, type: 'ranch' },
      { id: 'lago', name: 'Lago Azul', x: this.lake.x, z: this.lake.z, r: 0, type: 'lake' },
      { id: 'playaSur', name: 'Playa del Sur', x: s.x, z: s.z + 45, r: 0, type: 'beach' },
    ];
    for (const p of this.places) {
      if (p.r > 0) {
        const h = this.sample(p.x, p.z);
        // el lugar queda a la altura de la ruta más cercana si está cerca
        p.y = Math.max(SEA + 1, this.nearRoadHeight(p.x, p.z, p.r + 40) ?? h);
        // en la cima, el terreno alrededor baja suave hasta la explanada (cumbre aplanada)
        this.pads.push({ x: p.x, z: p.z, r: p.r, h: p.y, outer: p.type === 'observatory' ? p.r + 110 : p.r + 22 });
      }
    }
  }

  nearRoadHeight(x, z, maxD) {
    let best = null, bd = maxD;
    for (const r of this.roads) for (const p of r.pts) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = p.y; }
    }
    return best;
  }

  // Talla rutas y explanadas en la grilla de alturas.
  carve() {
    const c = ISLAND.cell;
    const target = new Float32Array(this.W * this.H);
    const weight = this.roadW;
    const cutOnly = new Uint8Array(this.W * this.H); // solo rebaja (no rellena) el terreno
    // tx, tz, g: dirección y pendiente de la ruta en ese punto (el piso sigue la rampa, sin escalones)
    const stamp = (x, z, h0, inner, outer, tx = 0, tz = 0, g = 0, cut = false) => {
      const i0 = Math.max(0, Math.floor((x - outer - ISLAND.minX) / c)), i1 = Math.min(this.W - 1, Math.ceil((x + outer - ISLAND.minX) / c));
      const j0 = Math.max(0, Math.floor((z - outer - ISLAND.minZ) / c)), j1 = Math.min(this.H - 1, Math.ceil((z + outer - ISLAND.minZ) / c));
      for (let j = j0; j <= j1; j++) {
        const cz = ISLAND.minZ + j * c;
        for (let i = i0; i <= i1; i++) {
          const cx = ISLAND.minX + i * c;
          const d = Math.hypot(cx - x, cz - z);
          if (d > outer) continue;
          // el punto más cercano de la ruta manda (si no, en las subidas el piso queda escalonado)
          const w = (d <= inner ? 1 : 1 - smoothstep(inner, outer, d)) - d * 1e-4;
          const k = j * this.W + i;
          if (w > weight[k]) { weight[k] = w; target[k] = h0 + ((cx - x) * tx + (cz - z) * tz) * g; cutOnly[k] = cut && d > inner ? 1 : 0; }
        }
      }
    };
    for (const r of this.roads) {
      const P = r.pts;
      for (let i = 0; i < P.length; i++) {
        const p = P[i], a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
        const g = (b.y - a.y) / Math.max(0.5, b.d - a.d);
        stamp(p.x, p.z, p.y - 0.04, r.width / 2 + 2, r.width / 2 + 18, p.tx, p.tz, g);
      }
    }
    for (const p of this.pads) stamp(p.x, p.z, p.h - 0.04, p.r, p.outer, 0, 0, 0, p.outer > p.r + 30);
    for (let k = 0; k < this.heights.length; k++) {
      if (cutOnly[k] && this.heights[k] < target[k]) continue;
      if (weight[k] > 0) this.heights[k] = lerp(this.heights[k], target[k], Math.min(1, weight[k] + 0.01));
    }
    // la ciudad no se toca
    for (let j = 0; j < this.H; j++) {
      const z = ISLAND.minZ + j * c;
      for (let i = 0; i < this.W; i++) {
        const x = ISLAND.minX + i * c;
        if (this.cityDist(x, z) <= 0 || this.inCityBeach(x, z)) {
          const k = j * this.W + i;
          this.heights[k] = this.inCityBeach(x, z) ? beachGround(x) - 0.12 : -0.12;
          weight[k] = 0;
        }
      }
    }
  }

  // Tipo de suelo de cada celda (agarre de las ruedas y colores).
  classify() {
    const c = ISLAND.cell;
    for (let j = 0; j < this.H; j++) {
      const z = ISLAND.minZ + j * c;
      for (let i = 0; i < this.W; i++) {
        const x = ISLAND.minX + i * c;
        const k = j * this.W + i;
        const h = this.heights[k];
        let v = 0;
        if (h < SEA) v = 5;
        else if (this.coastDist(x, z) < BEACH_W && h < 1.2) v = 4;
        else if (this.slope(i, j) > 0.75 || h > 175) v = 6;
        if (Math.hypot(x - this.lake.x, z - this.lake.z) < this.lake.r && h < this.lake.level) v = 5;
        this.surf[k] = v;
      }
    }
    // asfalto de las rutas (más fino que la grilla: se marca cada punto)
    for (const r of this.roads) {
      for (const p of r.pts) {
        const hw = r.width / 2;
        for (let o = -hw; o <= hw; o += 2) {
          const x = p.x - p.tz * o, z = p.z + p.tx * o;
          const i = Math.round((x - ISLAND.minX) / c), j = Math.round((z - ISLAND.minZ) / c);
          if (i >= 0 && j >= 0 && i < this.W && j < this.H) this.surf[j * this.W + i] = 1;
        }
      }
    }
  }

  slope(i, j) {
    const W = this.W, H = this.H, c = ISLAND.cell;
    const h = (a, b) => this.heights[Math.min(H - 1, Math.max(0, b)) * W + Math.min(W - 1, Math.max(0, a))];
    const gx = (h(i + 1, j) - h(i - 1, j)) / (2 * c), gz = (h(i, j + 1) - h(i, j - 1)) / (2 * c);
    return Math.hypot(gx, gz);
  }

  // Lugares, estacionamientos y nombres en el layout de la ciudad.
  registerOnLayout() {
    const L = this.L;
    for (const p of this.places) L.landmarks.push({ name: p.name, x: p.x, z: p.z, type: p.type === 'village' ? 'town' : 'island' });
    const rng = createRng(4242);
    const park = (x, z, rot) => L.props.cars.push({ x, z, rot });
    const obs = this.places.find((p) => p.id === 'observatorio');
    park(obs.x + 14, obs.z + 12, Math.PI / 2);
    const v = this.places.find((p) => p.id === 'puerto');
    park(v.x - 20, v.z + 18, rng.range(0, 6));
    park(v.x + 22, v.z + 10, rng.range(0, 6));
    const r = this.places.find((p) => p.id === 'rancho');
    park(r.x + 18, r.z + 20, 0.3);
    const f = this.places.find((p) => p.id === 'faro');
    park(f.x + 26, f.z + 8, Math.PI / 2);
  }

  // ------------------------------------------------------------ consultas
  sample(x, z) {
    const c = ISLAND.cell;
    const fx = (x - ISLAND.minX) / c, fz = (z - ISLAND.minZ) / c;
    if (fx < 0 || fz < 0 || fx >= this.W - 1 || fz >= this.H - 1) return -14;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const k = j * this.W + i;
    const H = this.heights;
    // interpolación sobre el triángulo (igual que la malla: sin pozos bajo las ruedas)
    if (tx + tz <= 1) return H[k] + (H[k + 1] - H[k]) * tx + (H[k + this.W] - H[k]) * tz;
    return H[k + this.W + 1] + (H[k + this.W] - H[k + this.W + 1]) * (1 - tx) + (H[k + 1] - H[k + this.W + 1]) * (1 - tz);
  }

  heightAtCell(i, j) {
    return this.heights[Math.min(this.H - 1, Math.max(0, j)) * this.W + Math.min(this.W - 1, Math.max(0, i))];
  }

  surfaceAt(x, z) {
    const c = ISLAND.cell;
    const i = Math.round((x - ISLAND.minX) / c), j = Math.round((z - ISLAND.minZ) / c);
    if (i < 0 || j < 0 || i >= this.W || j >= this.H) return 5;
    return this.surf[j * this.W + i];
  }

  roadWeight(x, z) {
    const c = ISLAND.cell;
    const i = Math.round((x - ISLAND.minX) / c), j = Math.round((z - ISLAND.minZ) / c);
    if (i < 0 || j < 0 || i >= this.W || j >= this.H) return 0;
    return this.roadW[j * this.W + i];
  }

  // Nombre de la zona de la isla (fuera de la ciudad).
  regionAt(x, z) {
    let best = null, bd = Infinity;
    for (const p of this.places) {
      const d = Math.hypot(x - p.x, z - p.z);
      const reach = { observatory: 260, mirador: 0, village: 260, lighthouse: 220, ranch: 220, lake: 200, beach: 260 }[p.type] ?? 0;
      if (d < reach && d < bd) { bd = d; best = p.id; }
    }
    const map = { observatorio: 'monte', puerto: 'puerto', faro: 'faro', rancho: 'rancho', lago: 'lago', playaSur: 'playaSur' };
    if (best) return map[best];
    const h = this.sample(x, z);
    if (h > 60) return 'monte';
    if (fbm(x * 0.004 + 50, z * 0.004 - 20, 3) > 0.52) return 'bosque';
    return 'campo';
  }
}
