import * as THREE from 'three';
import { MeshBuilder } from './MeshBuilder.js';
import { buildPropGeometries, makeLightPoolTexture } from './Props.js';
import { CURB, BEACH } from './CityLayout.js';
import { createRng } from './rng.js';
import { addFacadeSign, addPoleSign, addNeonTube, addFacadeWash } from './Neon.js';

// ============================================================================
// Convierte el plano de San Vega en mallas 3D divididas en zonas ("chunks").
// Cada zona tiene dos niveles de detalle:
//   base   → suelo y volúmenes de edificios (se ve de lejos)
//   detail → mobiliario, marcas viales, balcones, techos, etc. (solo de cerca)
// Además registra todas las colisiones estáticas.
// ============================================================================

const CHUNK = 128;
const LAYER = { slab: CURB, surface: CURB + 0.03, overlay: CURB + 0.06, water: CURB + 0.09 };

export class CityBuilder {
  constructor(layout, materials, collision) {
    this.L = layout;
    this.materials = materials;
    this.collision = collision;
    this.chunks = new Map();
    this.root = new THREE.Group();
    this.root.name = 'SanVega';
    this.props = null;
    this.lightPoolMat = null;
  }

  chunkAt(x, z) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const key = `${cx},${cz}`;
    let ch = this.chunks.get(key);
    if (!ch) {
      ch = {
        key, cx, cz,
        center: new THREE.Vector3((cx + 0.5) * CHUNK, 0, (cz + 0.5) * CHUNK),
        ground: new MeshBuilder(this.materials),
        bld: new MeshBuilder(this.materials),
        detail: new MeshBuilder(this.materials),
        marks: new MeshBuilder(this.materials),
        inst: {},
        group: new THREE.Group(),
        baseGroup: new THREE.Group(),
        detailGroup: new THREE.Group(),
        maxHeight: 10,
      };
      ch.group.add(ch.baseGroup, ch.detailGroup);
      this.chunks.set(key, ch);
    }
    return ch;
  }

  addInstance(type, x, y, z, rot = 0, scale = 1, color = null) {
    const ch = this.chunkAt(x, z);
    (ch.inst[type] ||= []).push({ x, y, z, rot, scale, color });
  }

  // Construcción por etapas (permite actualizar la barra de carga).
  *buildSteps() {
    this.props = buildPropGeometries(this.materials);
    yield 'Trazando calles';
    this.buildRoads();
    yield 'Levantando manzanas';
    this.buildBlocks();
    yield 'Construyendo edificios';
    this.buildBuildings();
    yield 'Plantando árboles y faroles';
    this.buildProps();
    yield 'Modelando la costa';
    this.buildOutskirts();
    yield 'Optimizando geometría';
    this.finalize();
  }

  // ------------------------------------------------------------------ calles
  buildRoads() {
    const L = this.L;
    const marks = (x, z) => this.chunkAt(x, z).marks;
    const ground = (x, z) => this.chunkAt(x, z).ground;
    const WHITE = 0xf2f2ee, YELLOW = 0xf2c230;

    for (const it of L.intersections) {
      ground(it.x, it.z).floor('asphalt', it.x - it.wx / 2, it.z - it.wz / 2, it.x + it.wx / 2, it.z + it.wz / 2, 0);
    }

    for (const r of L.roads) {
      const spec = r.spec;
      const len = r.to - r.from;
      const mid = (r.from + r.to) / 2;
      const hw = r.width / 2;
      // helpers en coordenadas "a lo largo" (s) y "a lo ancho" (t)
      const P = (s, t) => (r.axis === 'x' ? [r.pos + t, s] : [s, r.pos + t]);
      const rect = (builder, key, s0, s1, t0, t1, y, color) => {
        const [ax, az] = P(s0, t0), [bx, bz] = P(s1, t1);
        builder.floor(key, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), y, color);
      };
      // cortar en tramos por zona para que el culling funcione bien
      const pieces = Math.max(1, Math.ceil(len / 50));
      for (let p = 0; p < pieces; p++) {
        const s0 = r.from + (len * p) / pieces, s1 = r.from + (len * (p + 1)) / pieces;
        const [cx, cz] = P((s0 + s1) / 2, 0);
        rect(ground(cx, cz), 'asphalt', s0, s1, -hw, hw, 0);
      }

      const [mx, mz] = P(mid, 0);
      const mk = marks(mx, mz);
      const lineY = 0.012;
      const halfMedian = spec.median / 2;
      // cantero central / barrera
      if (spec.kind === 'avenue') {
        const [ax, az] = P(r.from + 6, -halfMedian), [bx, bz] = P(r.to - 6, halfMedian);
        const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), z0 = Math.min(az, bz), z1 = Math.max(az, bz);
        this.chunkAt(mx, mz).ground.box(x0, 0, z0, x1, CURB, z1, { side: 'concrete', top: 'grass' });
        this.collision.addBox(x0, 0, z0, x1, CURB, z1, 'ground');
        // bulevar tropical: palmeras en el cantero central
        for (let s = r.from + 12; s < r.to - 10; s += 16) {
          const [tx, tz] = P(s, 0);
          this.addInstance('palm', tx, CURB, tz, s * 0.37, 1.05, null);
          this.collision.addBox(tx - 0.25, 0, tz - 0.25, tx + 0.25, 3, tz + 0.25, 'prop');
        }
      } else if (spec.kind === 'highway') {
        const [ax, az] = P(r.from, -0.3), [bx, bz] = P(r.to, 0.3);
        const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), z0 = Math.min(az, bz), z1 = Math.max(az, bz);
        this.chunkAt(mx, mz).ground.box(x0, 0, z0, x1, 0.85, z1, { side: 'concrete', color: 0xd5d2cc });
        this.collision.addBox(x0, 0, z0, x1, 0.85, z1, 'barrier');
        // líneas amarillas junto a la barrera
        rect(mk, 'marking', r.from, r.to, -halfMedian + 0.3, -halfMedian + 0.45, lineY, YELLOW);
        rect(mk, 'marking', r.from, r.to, halfMedian - 0.45, halfMedian - 0.3, lineY, YELLOW);
      } else {
        // doble línea amarilla central
        rect(mk, 'marking', r.from + 4, r.to - 4, -0.22, -0.1, lineY, YELLOW);
        rect(mk, 'marking', r.from + 4, r.to - 4, 0.1, 0.22, lineY, YELLOW);
      }
      // separadores de carril (discontinuos) y línea de borde
      for (const side of [-1, 1]) {
        for (let k = 1; k < spec.lanesPerDir; k++) {
          const t = side * (halfMedian + k * spec.laneWidth);
          for (let s = r.from + 5; s < r.to - 5; s += 9) {
            rect(mk, 'marking', s, Math.min(s + 3, r.to - 5), t - 0.07, t + 0.07, lineY, WHITE);
          }
        }
        const te = side * (halfMedian + spec.lanesPerDir * spec.laneWidth);
        if (Math.abs(te) < hw - 0.2) rect(mk, 'marking', r.from + 4, r.to - 4, te - 0.07, te + 0.07, lineY, WHITE);
      }
      // sendas peatonales y líneas de detención en ambos extremos
      if (spec.kind !== 'highway') {
        for (const end of [0, 1]) {
          const sEdge = end === 0 ? r.from : r.to;
          const dir = end === 0 ? 1 : -1;
          const s0 = sEdge + dir * 0.8, s1 = sEdge + dir * 3.8;
          for (let t = -hw + 0.6; t < hw - 0.6; t += 1.1) {
            rect(mk, 'marking', Math.min(s0, s1), Math.max(s0, s1), t, t + 0.55, lineY, WHITE);
          }
          // línea de detención para el tránsito que llega a esta esquina (mano derecha)
          const sl = sEdge + dir * 4.4;
          const tSide = end === 0 ? 1 : -1; // carril entrante
          const t0 = r.axis === 'x' ? tSide : -tSide;
          const tA = t0 > 0 ? halfMedian : -hw + 0.3, tB = t0 > 0 ? hw - 0.3 : -halfMedian;
          rect(mk, 'marking', Math.min(sl, sl + dir * 0.45), Math.max(sl, sl + dir * 0.45), tA, tB, lineY, WHITE);
        }
      }
    }
  }

  // ------------------------------------------------------------------ manzanas
  buildBlocks() {
    const L = this.L;
    for (const b of L.blocks) {
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      const g = this.chunkAt(cx, cz).ground;
      // losa de la manzana: cordón + vereda (dividida para culling)
      const nx = Math.ceil((b.x1 - b.x0) / 50), nz = Math.ceil((b.z1 - b.z0) / 50);
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < nz; j++) {
          const x0 = b.x0 + ((b.x1 - b.x0) * i) / nx, x1 = b.x0 + ((b.x1 - b.x0) * (i + 1)) / nx;
          const z0 = b.z0 + ((b.z1 - b.z0) * j) / nz, z1 = b.z0 + ((b.z1 - b.z0) * (j + 1)) / nz;
          let faces = 't';
          if (i === 0) faces += 'w';
          if (i === nx - 1) faces += 'e';
          if (j === 0) faces += 'n';
          if (j === nz - 1) faces += 's';
          this.chunkAt((x0 + x1) / 2, (z0 + z1) / 2).ground.box(x0, 0, z0, x1, CURB, z1, { side: 'concrete', top: 'sidewalk', faces, color: 0xd8d4cc, topColor: 0xffffff });
        }
      }
      this.collision.addBox(b.x0, 0, b.z0, b.x1, CURB, b.z1, 'ground');
    }
    // superficies interiores (pasto, plazas, piletas...)
    const order = { grass: 0, plaza: 0, concrete: 0, parking: 0, path: 1, driveway: 1, deck: 1, pond: 2, pool: 2, boardwalk: 0 };
    for (const s of L.surfaces) {
      if (s.type === 'boardwalk') continue;
      const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
      const g = this.chunkAt(cx, cz).ground;
      const y = [LAYER.surface, LAYER.overlay, LAYER.water][order[s.type] ?? 0];
      switch (s.type) {
        case 'grass': g.floor('grass', s.x0, s.z0, s.x1, s.z1, y); break;
        case 'plaza': g.floor('plaza', s.x0, s.z0, s.x1, s.z1, y); break;
        case 'concrete': g.floor('concrete', s.x0, s.z0, s.x1, s.z1, y); break;
        case 'parking': this.buildParkingLot(s, y); break;
        case 'path': g.floor('plaza', s.x0, s.z0, s.x1, s.z1, y, 0xe8dcc8); break;
        case 'driveway': g.floor('concrete', s.x0, s.z0, s.x1, s.z1, y, 0xe6e2da); break;
        case 'deck': g.floor('wood', s.x0, s.z0, s.x1, s.z1, y); break;
        case 'pool':
        case 'pond': {
          const det = this.chunkAt(cx, cz).ground;
          // borde y agua
          det.box(s.x0 - 0.3, CURB, s.z0 - 0.3, s.x1 + 0.3, y + 0.12, s.z1 + 0.3, { side: 'concrete', top: null, color: 0xe8e8e8 });
          det.floor('pool', s.x0, s.z0, s.x1, s.z1, y + 0.02, s.type === 'pond' ? 0x6a9a7a : 0xffffff);
          det.floor('concrete', s.x0 - 0.3, s.z0 - 0.3, s.x1 + 0.3, s.z0, y + 0.12, 0xf0f0f0);
          det.floor('concrete', s.x0 - 0.3, s.z1, s.x1 + 0.3, s.z1 + 0.3, y + 0.12, 0xf0f0f0);
          det.floor('concrete', s.x0 - 0.3, s.z0, s.x0, s.z1, y + 0.12, 0xf0f0f0);
          det.floor('concrete', s.x1, s.z0, s.x1 + 0.3, s.z1, y + 0.12, 0xf0f0f0);
          break;
        }
      }
    }
  }

  buildParkingLot(s, y) {
    const g = this.chunkAt((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2).ground;
    g.floor('asphalt', s.x0, s.z0, s.x1, s.z1, y);
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      const z = s.z0 + 10 + r * ((s.z1 - s.z0 - 20) / (rows - 1));
      for (let x = s.x0 + 6; x <= s.x1 - 6; x += 3) {
        const m = this.chunkAt(x, z).marks;
        m.floor('marking', x - 0.06, z - 2.6, x + 0.06, z + 2.6, y + 0.012, 0xf2f2ee);
      }
    }
  }

  // ------------------------------------------------------------------ edificios
  buildBuildings() {
    for (const bld of this.L.buildings) {
      const fp = bld.footprint;
      const cx = (fp.x0 + fp.x1) / 2, cz = (fp.z0 + fp.z1) / 2;
      const ch = this.chunkAt(cx, cz);
      const B = ch.bld, D = ch.detail;
      const tint = bld.tint;
      for (const p of bld.parts) {
        const [tw] = B.tile(p.mat);
        const roof = p.roof === undefined ? 'roofFlat' : p.roof;
        B.box(p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, {
          side: p.mat, top: roof, color: tint, topColor: 0xffffff, vOrigin: p.y0, uOffset: (bld.uOffset * 3) / tw,
        });
        ch.maxHeight = Math.max(ch.maxHeight, p.y1);
      }
      // colisiones
      const cols = bld.colliders || bld.parts;
      for (const c of cols) this.collision.addBox(c.x0, 0, c.z0, c.x1, c.y1 ?? CURB + bld.height, c.z1, 'building');
      for (const d of bld.details) this.buildDetail(D, B, bld, d);
    }
  }

  buildDetail(D, B, bld, d) {
    const tint = bld.tint;
    switch (d.type) {
      case 'parapet': {
        const t = 0.35, h = 1.0, c = 0xcfcac2;
        D.box(d.x0, d.y, d.z0, d.x1, d.y + h, d.z0 + t, { side: 'concrete', color: c });
        D.box(d.x0, d.y, d.z1 - t, d.x1, d.y + h, d.z1, { side: 'concrete', color: c });
        D.box(d.x0, d.y, d.z0 + t, d.x0 + t, d.y + h, d.z1 - t, { side: 'concrete', color: c });
        D.box(d.x1 - t, d.y, d.z0 + t, d.x1, d.y + h, d.z1 - t, { side: 'concrete', color: c });
        break;
      }
      case 'ledge':
        B.box(d.x0 - 0.4, d.y - 0.5, d.z0 - 0.4, d.x1 + 0.4, d.y + 0.1, d.z1 + 0.4, { side: 'concrete', top: 'roofFlat', color: 0xdedad2 });
        break;
      case 'canopy':
        D.box(d.x0 - 1.6, d.y, d.z0 - 1.6, d.x1 + 1.6, d.y + 0.35, d.z1 + 1.6, { side: 'metal', top: 'metal', color: 0x3c4146, bottom: 'paint', bottomColor: 0xe0e0e0 });
        break;
      case 'hvac':
        D.box(d.x0, d.y0, d.z0, d.x1, d.y1, d.z1, { side: 'metal', color: 0xa0a5aa });
        D.box(d.x0 + 0.3, d.y1, d.z0 + 0.3, d.x1 - 0.3, d.y1 + 0.15, d.z1 - 0.3, { side: 'metal', color: 0x5a5f64 });
        break;
      case 'antenna':
        D.box(d.x - 0.25, d.y, d.z - 0.25, d.x + 0.25, d.y + d.h, d.z + 0.25, { side: 'metal', color: 0x9ea3a8 });
        D.box(d.x - 0.35, d.y + d.h, d.z - 0.35, d.x + 0.35, d.y + d.h + 0.6, d.z + 0.35, { side: 'lampGlow', color: 0xff3b30 });
        break;
      case 'awning': {
        const depth = 1.8, y = d.y;
        const c = d.color;
        if (d.face === 'n') D.box(d.x0 + 0.5, y, d.z0 - depth, d.x1 - 0.5, y + 0.25, d.z0, { side: 'paint', color: c });
        else if (d.face === 's') D.box(d.x0 + 0.5, y, d.z1, d.x1 - 0.5, y + 0.25, d.z1 + depth, { side: 'paint', color: c });
        else if (d.face === 'w') D.box(d.x0 - depth, y, d.z0 + 0.5, d.x0, y + 0.25, d.z1 - 0.5, { side: 'paint', color: c });
        else D.box(d.x1, y, d.z0 + 0.5, d.x1 + depth, y + 0.25, d.z1 - 0.5, { side: 'paint', color: c });
        break;
      }
      case 'balconies': this.buildBalconies(D, d, tint); break;
      case 'slab':
        B.box(d.x0, d.y - d.t, d.z0, d.x1, d.y, d.z1, { side: 'paint', top: 'roofFlat', color: 0xf4f4f2, topColor: 0xffffff });
        break;
      case 'rollerDoor':
        D.facePanel('rollerDoor', d.face, d.x, d.z, d.w, CURB, d.h, 0.05);
        break;
      case 'skylight':
        D.box(d.x0, d.y, d.z0, d.x1, d.y + 0.6, d.z1, { side: 'metal', color: 0x6d8fa8 });
        break;
      case 'chimney':
        D.cylinder('concrete', d.x, d.z, d.y, d.y + d.h, d.r, 10, 0xb7aea4);
        D.cylinder('paint', d.x, d.z, d.y + d.h - 1.5, d.y + d.h - 0.6, d.r + 0.05, 10, 0xc0392b, false);
        break;
      case 'gable':
        B.gable('roofTile', d.x0, d.z0, d.x1, d.z1, d.y, d.h, d.alongX, d.color, 'house', tint);
        break;
      case 'door': {
        const { cx, cz } = faceCenter(d);
        D.facePanel('door', d.face, cx, cz, 1.1, CURB, 2.2, 0.05);
        D.box(...stepBox(d.face, cx, cz), { side: 'concrete', color: 0xd8d4cc });
        break;
      }
      case 'garageDoor': {
        const { cx, cz } = faceCenter(d);
        D.facePanel('garageDoor', d.face, cx, cz, 3.2, CURB, 2.4, 0.05);
        break;
      }
      // ---- neón ----
      case 'sign': {
        const { cx, cz } = faceCenter(d);
        const len = d.face === 'n' || d.face === 's' ? d.x1 - d.x0 : d.z1 - d.z0;
        const w = Math.min(d.w || 7, len * 0.7);
        addFacadeSign(B, this.materials.neon, d.word, d.face, cx, cz, d.y, w, w / this.materials.neon.aspect * 1.25);
        this.addSignReflection(d.word, d.face, cx, cz, 1.5);
        break;
      }
      case 'vsign':
        addFacadeSign(B, this.materials.neon, d.word, d.face, d.x, d.z, d.y, 2.4, d.h, true);
        this.addSignReflection(d.word, d.face, d.x, d.z, 0.8);
        break;
      case 'roofSign': {
        const w = Math.min(16, (d.face === 'n' || d.face === 's' ? d.x1 - d.x0 : d.z1 - d.z0) * 0.8);
        const h = w / this.materials.neon.aspect * 1.25;
        const { cx, cz } = faceCenter(d);
        // estructura metálica sobre la azotea
        const inset = 1.2;
        const ix = d.face === 'e' ? -inset : d.face === 'w' ? inset : 0, iz = d.face === 's' ? -inset : d.face === 'n' ? inset : 0;
        B.box(cx + ix - 0.15, d.y, cz + iz - 0.15, cx + ix + 0.15, d.y + 1.2, cz + iz + 0.15, { side: 'metal', color: 0x2b2f33 });
        addFacadeSign(B, this.materials.neon, d.word, d.face, cx + ix, cz + iz, d.y + 1.2, w, h);
        break;
      }
      case 'trim': {
        const y = d.y + 1.05;
        addNeonTube(B, d.x0, y, d.z0, d.x1, y, d.z0, d.color);
        addNeonTube(B, d.x0, y, d.z1, d.x1, y, d.z1, d.color);
        addNeonTube(B, d.x0, y, d.z0, d.x0, y, d.z1, d.color);
        addNeonTube(B, d.x1, y, d.z0, d.x1, y, d.z1, d.color);
        break;
      }
      case 'band':
        addNeonTube(B, d.x1 + 0.3, d.y, d.z0, d.x1 + 0.3, d.y, d.z1, d.color, 0.09);
        addNeonTube(B, d.x0, d.y, d.z0 - 0.3, d.x1, d.y, d.z0 - 0.3, d.color, 0.09);
        addNeonTube(B, d.x0, d.y, d.z1 + 0.3, d.x1, d.y, d.z1 + 0.3, d.color, 0.09);
        break;
      case 'wash':
        addFacadeWash(D, d.face, d.x0, d.z0, d.x1, d.z1, d.y, d.h, d.color);
        break;
    }
  }

  buildBalconies(D, d, tint) {
    const depth = 1.1, slabT = 0.15, rail = 1.0;
    const len = d.face === 'n' || d.face === 's' ? d.x1 - d.x0 : d.z1 - d.z0;
    const bays = Math.floor(len / d.bay);
    let floorIdx = 0;
    for (let y = d.y0 + d.floor; y < d.y1 - 0.5; y += d.floor, floorIdx++) {
      if (floorIdx % d.every !== 0) continue;
      for (let i = 0; i < bays; i++) {
        if (d.every > 1 && (i + floorIdx) % 2) continue;
        const a = (d.face === 'n' || d.face === 's' ? d.x0 : d.z0) + i * d.bay + 0.3;
        const b = a + d.bay - 0.6;
        let x0, x1, z0, z1;
        if (d.face === 'n') { x0 = a; x1 = b; z0 = d.z0 - depth; z1 = d.z0; }
        else if (d.face === 's') { x0 = a; x1 = b; z0 = d.z1; z1 = d.z1 + depth; }
        else if (d.face === 'w') { z0 = a; z1 = b; x0 = d.x0 - depth; x1 = d.x0; }
        else { z0 = a; z1 = b; x0 = d.x1; x1 = d.x1 + depth; }
        D.box(x0, y - slabT, z0, x1, y, z1, { side: 'concrete', color: 0xe8e4dc, bottom: 'concrete' });
        // baranda vidriada / metálica
        const rc = 0x46505a;
        if (d.face === 'n') D.box(x0, y, z0, x1, y + rail, z0 + 0.06, { side: 'metal', color: rc });
        else if (d.face === 's') D.box(x0, y, z1 - 0.06, x1, y + rail, z1, { side: 'metal', color: rc });
        else if (d.face === 'w') D.box(x0, y, z0, x0 + 0.06, y + rail, z1, { side: 'metal', color: rc });
        else D.box(x1 - 0.06, y, z0, x1, y + rail, z1, { side: 'metal', color: rc });
      }
    }
  }

  // ------------------------------------------------------------------ props
  buildProps() {
    const P = this.L.props;
    const col = this.collision;
    this.lightRefl ||= [];
    for (const l of P.lamps) {
      const y = l.y ?? CURB;
      const a = l.double ? 0 : l.rot + Math.PI;
      // punto del piso bajo la lámpara (para los reflejos con lluvia)
      this.lightRefl.push(l.x + Math.sin(a) * 1.6, y > 0.3 ? y + 0.03 : 0.06, l.z + Math.cos(a) * 1.6, 1, 0.72, 0.42, 0.55);
      this.addInstance(l.double ? 'lampDouble' : 'lamp', l.x, y, l.z, l.rot + Math.PI);
      this.addInstance('lightPool', l.x, y - CURB, l.z, l.double ? 0 : l.rot + Math.PI, 1);
      col.addBox(l.x - 0.15, 0, l.z - 0.15, l.x + 0.15, 7, l.z + 0.15, 'prop');
    }
    const rng = createRng(31337);
    const tint = () => new THREE.Color().setHSL(0.25 + rng.range(-0.05, 0.05), rng.range(0.3, 0.6), rng.range(0.75, 1));
    for (const t of P.trees) {
      const type = t.palm ? 'palm' : 'tree';
      this.addInstance(type, t.x, CURB, t.z, rng.range(0, Math.PI * 2), t.s, type === 'tree' ? tint() : null);
      col.addBox(t.x - 0.25, 0, t.z - 0.25, t.x + 0.25, 3, t.z + 0.25, 'prop');
    }
    for (const p of P.palms) {
      const y = p.beach ? beachGround(p.x) : CURB;
      this.addInstance('palm', p.x, y, p.z, rng.range(0, Math.PI * 2), p.s);
      col.addBox(p.x - 0.25, y, p.z - 0.25, p.x + 0.25, y + 3, p.z + 0.25, 'prop');
    }
    for (const t of P.trafficLights) {
      this.addInstance('trafficLight', t.x, CURB, t.z, t.rot);
      col.addBox(t.x - 0.15, 0, t.z - 0.15, t.x + 0.15, 5.6, t.z + 0.15, 'prop');
    }
    for (const b of P.benches) {
      this.addInstance('bench', b.x, b.y ?? CURB, b.z, b.rot);
      const s = Math.abs(Math.sin(b.rot)) > 0.7;
      col.addBox(b.x - (s ? 0.3 : 0.9), 0, b.z - (s ? 0.9 : 0.3), b.x + (s ? 0.3 : 0.9), (b.y ?? CURB) + 0.5, b.z + (s ? 0.9 : 0.3), 'prop');
    }
    for (const h of P.hydrants) {
      this.addInstance('hydrant', h.x, CURB, h.z, 0);
      col.addBox(h.x - 0.15, 0, h.z - 0.15, h.x + 0.15, 0.85, h.z + 0.15, 'prop');
    }
    for (const b of P.bins) {
      this.addInstance('bin', b.x, CURB, b.z, 0);
      col.addBox(b.x - 0.3, 0, b.z - 0.3, b.x + 0.3, 1, b.z + 0.3, 'prop');
    }
    for (const c of P.containers) {
      this.addInstance('container', c.x, c.y, c.z, c.rot, 1, new THREE.Color(c.color));
      col.addBox(c.x - 1.25, c.y, c.z - 3, c.x + 1.25, c.y + 2.6, c.z + 3, 'building');
    }
    for (const w of P.walls) {
      const D = this.chunkAt((w.x0 + w.x1) / 2, (w.z0 + w.z1) / 2).detail;
      if (w.type === 'hedge') D.box(w.x0, CURB, w.z0, w.x1, CURB + w.h, w.z1, { side: 'foliage', color: 0x2f6a2a });
      else if (w.type === 'picket') D.box(w.x0, CURB, w.z0, w.x1, CURB + w.h, w.z1, { side: 'paint', color: 0xf5f5f0 });
      else D.box(w.x0, CURB, w.z0, w.x1, CURB + w.h, w.z1, { side: 'metal', color: 0x7f8a8f });
      col.addBox(w.x0, 0, w.z0, w.x1, CURB + w.h, w.z1, 'wall');
    }
    for (const f of P.fountains) {
      const D = this.chunkAt(f.x, f.z).detail;
      D.cylinder('concrete', f.x, f.z, CURB, CURB + 0.6, f.r, 20, 0xe2ddd3);
      D.cylinder('pool', f.x, f.z, CURB, CURB + 0.55, f.r - 0.35, 20, 0xffffff);
      D.cylinder('concrete', f.x, f.z, CURB, CURB + 2.2, 0.5, 10, 0xe2ddd3);
      D.cylinder('concrete', f.x, f.z, CURB + 2.2, CURB + 2.4, 1.4, 14, 0xe2ddd3);
      const s = f.r * 0.75;
      this.collision.addBox(f.x - s, 0, f.z - s, f.x + s, CURB + 0.6, f.z + s, 'wall');
    }
  }

  // ------------------------------------------------------------------ alrededores
  buildOutskirts() {
    const L = this.L;
    const E = L.roadExtent;
    const far = 1600;
    // campo alrededor de la ciudad (sin superponerse con calles: evita parpadeos)
    const grass = (x0, z0, x1, z1) => {
      const n = Math.ceil(Math.max(x1 - x0, z1 - z0) / 200);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const ax = x0 + ((x1 - x0) * i) / n, bx = x0 + ((x1 - x0) * (i + 1)) / n;
        const az = z0 + ((z1 - z0) * j) / n, bz = z0 + ((z1 - z0) * (j + 1)) / n;
        this.chunkAt((ax + bx) / 2, (az + bz) / 2).ground.floor('grass', ax, az, bx, bz, 0, 0xc8d8b0);
      }
    };
    grass(-far, -far, E.min, far); // oeste
    grass(E.min, -far, BEACH.x0, E.min); // norte
    grass(E.min, E.max, BEACH.x0, far); // sur

    // playa con pendiente hacia el mar
    const beachZ0 = -far, beachZ1 = far;
    const groundAt = beachGround;
    L.groundAt = (x, z) => groundAt(x);
    this.collision.groundFn = (x, z) => (x > BEACH.x0 ? Math.max(groundAt(x), -0.6) : 0);
    const steps = 16;
    for (let i = 0; i < steps; i++) {
      const xa = BEACH.x0 + ((BEACH.x1 - BEACH.x0) * i) / steps, xb = BEACH.x0 + ((BEACH.x1 - BEACH.x0) * (i + 1)) / steps;
      for (let z = beachZ0; z < beachZ1; z += 200) {
        const g = this.chunkAt((xa + xb) / 2, z + 100).ground;
        const [tw, th] = g.tile('sand');
        g.quad('sand', [xa, groundAt(xa), z + 200], [xb, groundAt(xb), z + 200], [xb, groundAt(xb), z], [xa, groundAt(xa), z],
          [xa / tw, -(z + 200) / th, xb / tw, -(z + 200) / th, xb / tw, -z / th, xa / tw, -z / th]);
      }
    }
    // paseo costero de madera
    const bw = L.surfaces.find((s) => s.type === 'boardwalk');
    if (bw) {
      for (let z = bw.z0; z < bw.z1; z += 64) {
        const z1 = Math.min(bw.z1, z + 64);
        this.chunkAt(bw.x0 + 3, (z + z1) / 2).ground.box(bw.x0, -0.5, z, bw.x1, bw.y, z1, { side: 'wood', top: 'wood' });
      }
      this.collision.addBox(bw.x0, -0.5, bw.z0, bw.x1, bw.y, bw.z1, 'ground');
    }
    // océano: turquesa en la orilla, azul profundo mar adentro
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(3000, 4000, 60, 1), this.materials.get('water'));
    const uv = this.water.geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (3000 / 16), uv.getY(i) * (4000 / 16));
    const wp = this.water.geometry.getAttribute('position');
    const cols = new Float32Array(uv.count * 3);
    const shallow = new THREE.Color(0x7ff0e0), deep = new THREE.Color(0x2a6f9a), tmpc = new THREE.Color();
    for (let i = 0; i < wp.count; i++) {
      const dist = wp.getX(i) + 1500; // metros desde la orilla
      tmpc.copy(shallow).lerp(deep, Math.min(1, dist / 260));
      cols[i * 3] = tmpc.r; cols[i * 3 + 1] = tmpc.g; cols[i * 3 + 2] = tmpc.b;
    }
    this.water.geometry.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.buildCoast();
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(BEACH.waterX + 1500, -0.35, 0);
    this.water.receiveShadow = false;
    this.root.add(this.water);

    // colinas lejanas (horizonte)
    const hills = new MeshBuilder(this.materials);
    const hrng = createRng(555);
    const geo = new THREE.ConeGeometry(1, 1, 9, 3);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 46; i++) {
      const a = Math.PI * 0.55 + (i / 46) * Math.PI * 1.35 + hrng.range(-0.03, 0.03);
      const r = hrng.range(820, 1150);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = hrng.range(60, 170), w = hrng.range(140, 260);
      m.compose(new THREE.Vector3(x, h / 2 - 2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, hrng.range(0, 6), 0)), new THREE.Vector3(w, h, w * hrng.range(0.6, 1)));
      hills.addGeometry('paint', geo, m, (vi) => (vi < 10 ? 0x8a9a7a : hrng.pick([0x55703f, 0x4b6638, 0x607a46])));
    }
    this.hills = new THREE.Group();
    hills.build(this.hills, { castShadow: false, receiveShadow: false });
    this.root.add(this.hills);

    // límites invisibles del mundo
    const B = L.bounds;
    this.collision.addBox(B.minX - 5, -5, B.minZ - 5, B.minX, 60, B.maxZ + 5, 'bound');
    this.collision.addBox(B.maxX, -5, B.minZ - 5, B.maxX + 5, 60, B.maxZ + 5, 'bound');
    this.collision.addBox(B.minX - 5, -5, B.minZ - 5, B.maxX + 5, 60, B.minZ, 'bound');
    this.collision.addBox(B.minX - 5, -5, B.maxZ, B.maxX + 5, 60, B.maxZ + 5, 'bound');
  }

  // ------------------------------------------------------------------ costa
  buildCoast() {
    const L = this.L;
    const col = this.collision;
    const P = L.pier;
    const det = (x, z) => this.chunkAt(x, z).detail;
    const base = (x, z) => this.chunkAt(x, z).bld;
    // ---- muelle ----
    for (let x = P.x0; x < P.x1; x += 40) {
      const x1 = Math.min(P.x1, x + 40);
      base((x + x1) / 2, (P.z0 + P.z1) / 2).box(x, -0.6, P.z0, x1, P.deck, P.z1, { side: 'wood', top: 'wood' });
    }
    const pl = P.plat;
    base((pl.x0 + pl.x1) / 2, (pl.z0 + pl.z1) / 2).box(pl.x0, -0.6, pl.z0, pl.x1, P.deck, pl.z1, { side: 'wood', top: 'plaza' });
    col.addBox(P.x0, -0.6, P.z0, P.x1, P.deck, P.z1, 'ground');
    col.addBox(pl.x0, -0.6, pl.z0, pl.x1, P.deck, pl.z1, 'ground');
    // pilotes
    for (let x = P.x0 + 6; x < P.x1; x += 12) {
      for (const z of [P.z0 + 0.6, P.z1 - 0.6]) det(x, z).cylinder('wood', x, z, -3, -0.6, 0.35, 8, 0x8a6a4a, false);
    }
    // barandas (no se puede caer al agua)
    const rail = (x0, z0, x1, z1) => {
      det((x0 + x1) / 2, (z0 + z1) / 2).box(x0, P.deck, z0, x1, P.deck + 1.05, z1, { side: 'paint', color: 0xf2f2f2 });
      col.addBox(x0, P.deck - 1, z0, x1, P.deck + 1.1, z1, 'wall');
    };
    const sx = BEACH.waterX - 4; // la baranda empieza sobre el agua
    rail(sx, P.z0, pl.x0, P.z0 + 0.15);
    rail(sx, P.z1 - 0.15, pl.x0, P.z1);
    rail(pl.x0, pl.z0, pl.x1, pl.z0 + 0.15);
    rail(pl.x0, pl.z1 - 0.15, pl.x1, pl.z1);
    rail(pl.x1 - 0.15, pl.z0, pl.x1, pl.z1);
    rail(pl.x0, pl.z0, pl.x0 + 0.15, P.z0);
    rail(pl.x0, P.z1, pl.x0 + 0.15, pl.z1);
    // muros invisibles en el mar (salvo la entrada al muelle)
    col.addBox(BEACH.waterX + 12, -5, L.bounds.minZ - 5, BEACH.waterX + 16, 40, P.z0, 'bound');
    col.addBox(BEACH.waterX + 12, -5, P.z1, BEACH.waterX + 16, 40, L.bounds.maxZ + 5, 'bound');
    // kioscos sobre la plataforma
    for (const [kx, kz, c] of [[674, -165, 0xff8fa3], [674, -135, 0xa0e7e5]]) {
      base(kx, kz).box(kx - 2, P.deck, kz - 2, kx + 2, P.deck + 2.6, kz + 2, { side: 'paint', top: 'roofFlat', color: c });
      base(kx, kz).box(kx - 2.4, P.deck + 2.6, kz - 2.4, kx + 2.4, P.deck + 2.9, kz + 2.4, { side: 'paint', color: 0xffffff });
      col.addBox(kx - 2, 0, kz - 2, kx + 2, P.deck + 2.6, kz + 2, 'building');
    }
    this.buildFerrisWheel(P);

    // ---- equipamiento de playa ----
    const ground = (x) => beachGround(x);
    const umbrella = new THREE.ConeGeometry(1.5, 0.55, 10, 1, true);
    const m = new THREE.Matrix4();
    for (const u of L.beachProps.umbrellas) {
      const y = ground(u.x);
      const D = det(u.x, u.z);
      D.cylinder('metal', u.x, u.z, y, y + 2.3, 0.04, 6, 0xdddddd, false);
      m.makeTranslation(u.x, y + 2.45, u.z);
      D.addGeometry('paint', umbrella, m, (i) => (i % 2 ? u.color : 0xffffff));
      // dos reposeras
      const c = Math.cos(u.rot), s = Math.sin(u.rot);
      for (const k of [-0.8, 0.8]) {
        const lx = u.x + c * k + s * 1.4, lz = u.z - s * k + c * 1.4;
        D.box(lx - 0.35, y + 0.25, lz - 0.9, lx + 0.35, y + 0.35, lz + 0.9, { side: 'paint', color: 0xf5f5f5 });
        D.box(lx - 0.35, y + 0.35, lz - 0.95, lx + 0.35, y + 0.85, lz - 0.75, { side: 'paint', color: u.color });
      }
      col.addBox(u.x - 0.1, y, u.z - 0.1, u.x + 0.1, y + 2.3, u.z + 0.1, 'prop');
    }
    for (const t of L.beachProps.towers) {
      const y = ground(t.x);
      const D = det(t.x, t.z);
      for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) D.box(t.x + dx * 1.1 - 0.08, y, t.z + dz * 1.1 - 0.08, t.x + dx * 1.1 + 0.08, y + 2.6, t.z + dz * 1.1 + 0.08, { side: 'paint', color: 0xffffff });
      D.box(t.x - 1.4, y + 2.6, t.z - 1.4, t.x + 1.4, y + 4.4, t.z + 1.4, { side: 'paint', color: 0xe53935 });
      D.box(t.x - 1.7, y + 4.4, t.z - 1.7, t.x + 1.7, y + 4.7, t.z + 1.7, { side: 'paint', color: 0xffffff });
      col.addBox(t.x - 1.3, y, t.z - 1.3, t.x + 1.3, y + 4.7, t.z + 1.3, 'prop');
    }
    for (const h of L.beachProps.huts) {
      const y = ground(h.x);
      const B = base(h.x, h.z);
      B.box(h.x - 2, y, h.z - 1.6, h.x + 2, y + 2.4, h.z + 1.6, { side: 'mansion', top: null, color: h.color, vOrigin: y });
      B.gable('roofTile', h.x - 2.3, h.z - 1.9, h.x + 2.3, h.z + 1.9, y + 2.4, 1.1, false, 0xffffff, 'paint', h.color);
      col.addBox(h.x - 2, y, h.z - 1.6, h.x + 2, y + 3.4, h.z + 1.6, 'building');
    }
    for (const n of L.beachProps.nets) {
      const y = ground(n.x);
      const D = det(n.x, n.z);
      for (const dz of [-4.5, 4.5]) D.box(n.x - 0.05, y, n.z + dz - 0.05, n.x + 0.05, y + 2.5, n.z + dz + 0.05, { side: 'metal', color: 0xeeeeee });
      D.box(n.x - 0.02, y + 1.6, n.z - 4.5, n.x + 0.02, y + 2.45, n.z + 4.5, { side: 'paint', color: 0x222222 });
    }
    // chiringuito
    const ch = L.chiringuito;
    if (ch) {
      const y = ground(ch.x);
      const B = base(ch.x, ch.z);
      B.box(ch.x - 3, y, ch.z - 4, ch.x + 3, y + 1.1, ch.z + 4, { side: 'wood', top: 'wood' });
      for (const [dx, dz] of [[-3, -4], [3, -4], [3, 4], [-3, 4]]) B.box(ch.x + dx - 0.12, y, ch.z + dz - 0.12, ch.x + dx + 0.12, y + 3.2, ch.z + dz + 0.12, { side: 'wood' });
      m.makeTranslation(ch.x, y + 3.8, ch.z);
      B.addGeometry('paint', new THREE.ConeGeometry(5.6, 1.6, 8), m, () => 0xd8b46a);
      col.addBox(ch.x - 3, y, ch.z - 4, ch.x + 3, y + 1.1, ch.z + 4, 'building');
    }
    // carteles de neón sobre postes
    for (const s of L.poleSigns) {
      const by = s.base ?? CURB;
      addPoleSign(det(s.x, s.z), this.materials.neon, s.word, s.x, s.z, s.rot, s.w, s.w / this.materials.neon.aspect * 1.25, 2.6, by);
    }
  }

  // Rueda gigante del muelle: gira de día y se ilumina de noche.
  buildFerrisWheel(P) {
    const W = P.wheel;
    const g = new THREE.Group();
    g.position.set(W.x, P.deck, W.z);
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.5, metalness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.6, metalness: 0.5 });
    // patas en A
    for (const sz of [-1, 1]) {
      for (const sx of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, W.hub + 2, 0.6), white);
        leg.position.set(sx * 5.5, W.hub / 2, sz * 3.2);
        leg.rotation.z = sx * -0.22;
        g.add(leg);
      }
    }
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 7.5, 12).rotateX(Math.PI / 2), dark);
    axle.position.y = W.hub;
    g.add(axle);
    const wheel = new THREE.Group();
    wheel.position.y = W.hub;
    for (const z of [-2.6, 2.6]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(W.r, 0.28, 8, 64), white);
      rim.position.z = z;
      wheel.add(rim);
    }
    const N = 16;
    this.ferrisCabins = [];
    const cabinColors = [0xff2f7d, 0x2ff5ff, 0xffe14d, 0xb45cff, 0x4dff88, 0xff8a3d];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      for (const z of [-2.6, 2.6]) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.18, W.r, 0.18), white);
        spoke.position.set(Math.cos(a) * W.r / 2, Math.sin(a) * W.r / 2, z);
        spoke.rotation.z = a - Math.PI / 2;
        wheel.add(spoke);
      }
      const cabin = new THREE.Group();
      cabin.position.set(Math.cos(a) * W.r, Math.sin(a) * W.r, 0);
      const box = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2, 2.6), new THREE.MeshStandardMaterial({ color: cabinColors[i % cabinColors.length], roughness: 0.5 }));
      box.position.y = -1.4;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.25, 2.9), white);
      roof.position.y = -0.3;
      cabin.add(box, roof);
      wheel.add(cabin);
      this.ferrisCabins.push(cabin);
    }
    // luces del aro (instanciadas)
    const LN = 96;
    this.ferrisLightMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 6, 4), this.ferrisLightMat, LN * 2);
    const mm = new THREE.Matrix4(), cc = new THREE.Color();
    let k = 0;
    for (let i = 0; i < LN; i++) {
      const a = (i / LN) * Math.PI * 2;
      for (const z of [-2.9, 2.9]) {
        mm.makeTranslation(Math.cos(a) * W.r, Math.sin(a) * W.r, z);
        lights.setMatrixAt(k, mm);
        lights.setColorAt(k, cc.setHSL((i / LN) * 3 % 1, 1, 0.6));
        k++;
      }
    }
    wheel.add(lights);
    g.add(wheel);
    g.rotation.y = 0; // el plano de la rueda mira hacia la ciudad (eje de giro = X)
    wheel.rotation.order = 'YXZ';
    g.rotation.y = Math.PI / 2;
    g.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) o.castShadow = true; });
    this.ferris = { group: g, wheel };
    this.root.add(g);
    // patas a lo largo de Z (el plano de la rueda), separadas 3.2 m en X
    this.collision.addBox(W.x - 4, 0, W.z - 7.5, W.x + 4, W.hub + 2, W.z + 7.5, 'building');
  }

  // ------------------------------------------------------------------ final
  finalize() {
    const poolTex = makeLightPoolTexture();
    this.lightPoolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffd6a0 });
    const poolGeo = new THREE.PlaneGeometry(9, 9);
    poolGeo.rotateX(-Math.PI / 2);
    poolGeo.translate(0, CURB + 0.08, 1.6);

    const dummy = new THREE.Object3D();
    for (const ch of this.chunks.values()) {
      ch.ground.build(ch.baseGroup, { castShadow: false, receiveShadow: true });
      ch.bld.build(ch.baseGroup, { castShadow: true, receiveShadow: true });
      ch.detail.build(ch.detailGroup, { castShadow: true, receiveShadow: true });
      ch.marks.build(ch.detailGroup, { castShadow: false, receiveShadow: true });
      for (const [type, list] of Object.entries(ch.inst)) {
        if (type === 'lightPool') {
          const im = new THREE.InstancedMesh(poolGeo, this.lightPoolMat, list.length);
          list.forEach((it, i) => {
            dummy.position.set(it.x, it.y, it.z);
            dummy.rotation.set(0, it.rot, 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            im.setMatrixAt(i, dummy.matrix);
          });
          im.computeBoundingSphere();
          im.renderOrder = 2;
          im.userData.nightOnly = true;
          ch.detailGroup.add(im);
          continue;
        }
        const geos = this.props[type];
        if (!geos) continue;
        const anyColor = list.some((it) => it.color);
        const white = new THREE.Color(1, 1, 1);
        for (const [matKey, geo] of geos) {
          const im = new THREE.InstancedMesh(geo, this.materials.get(matKey), list.length);
          const tinted = anyColor && (matKey === 'foliage' || matKey === 'container');
          list.forEach((it, i) => {
            dummy.position.set(it.x, it.y, it.z);
            dummy.rotation.set(0, it.rot, 0);
            dummy.scale.setScalar(it.scale);
            dummy.updateMatrix();
            im.setMatrixAt(i, dummy.matrix);
            if (tinted) im.setColorAt(i, it.color || white);
          });
          if (im.instanceColor) im.instanceColor.needsUpdate = true;
          im.computeBoundingSphere();
          im.castShadow = type !== 'hydrant' && type !== 'bin';
          im.receiveShadow = true;
          ch.detailGroup.add(im);
        }
      }
      // el neón no proyecta sombras y se dibuja después de lo opaco
      for (const grp of [ch.baseGroup, ch.detailGroup]) {
        for (const o of grp.children) {
          if (o.material?.isMeshBasicMaterial && !o.isInstancedMesh) {
            o.castShadow = false;
            o.receiveShadow = false;
            o.renderOrder = 3;
          }
        }
      }
      ch.baseGroup.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
      ch.detailGroup.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
      this.root.add(ch.group);
      ch.inst = null;
      ch.ground = ch.bld = ch.detail = ch.marks = null;
    }
  }

  // Visibilidad por distancia (LOD por zonas). Llamar cada pocos frames.
  updateVisibility(camPos, drawDistance, detailDistance) {
    for (const ch of this.chunks.values()) {
      const dx = Math.max(0, Math.abs(camPos.x - ch.center.x) - CHUNK / 2);
      const dz = Math.max(0, Math.abs(camPos.z - ch.center.z) - CHUNK / 2);
      const d = Math.hypot(dx, dz);
      ch.group.visible = d < drawDistance + ch.maxHeight * 0.5;
      ch.detailGroup.visible = d < detailDistance;
    }
  }

  // reflejo de color de un cartel de neón en la vereda/calle mojada de enfrente
  addSignReflection(word, face, cx, cz, w) {
    const cell = this.materials.neon.cells.get(word);
    if (!cell) return;
    const n = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[face];
    if (!n) return;
    const c = new THREE.Color(cell.color);
    this.lightRefl ||= [];
    this.lightRefl.push(cx + n[0] * 5, 0.06, cz + n[1] * 5, c.r * 1.3, c.g * 1.3, c.b * 1.3, w);
  }

  setNight(night, wet = 0) {
    // con el piso mojado la luz de los faroles se refleja más
    if (this.lightPoolMat) this.lightPoolMat.opacity = Math.max(0, night - 0.15) * (0.75 + wet * 0.45);
    if (this.ferrisLightMat) this.ferrisLightMat.color.setScalar(0.35 + night * 1.6);
  }

  update(dt, time) {
    if (this.ferris) {
      const w = this.ferris.wheel;
      w.rotation.z += dt * 0.06;
      // las cabinas siempre quedan colgando hacia abajo
      for (const c of this.ferrisCabins) c.rotation.z = -w.rotation.z;
    }
    const wm = this.materials.get('water');
    if (wm.map) {
      wm.map.offset.x = (time * 0.006) % 1;
      wm.map.offset.y = (time * 0.004) % 1;
    }
  }
}

// Altura de la arena: baja suavemente desde el paseo hasta el mar.
export function beachGround(x) {
  if (x <= BEACH.x0) return 0;
  const t = Math.min(1, (x - BEACH.x0) / (BEACH.x1 - BEACH.x0));
  return 0.05 - t * 1.6;
}

function faceCenter(d) {
  const cx = (d.x0 + d.x1) / 2, cz = (d.z0 + d.z1) / 2;
  if (d.face === 'n') return { cx, cz: d.z0 };
  if (d.face === 's') return { cx, cz: d.z1 };
  if (d.face === 'w') return { cx: d.x0, cz };
  return { cx: d.x1, cz };
}

function stepBox(face, cx, cz) {
  const y0 = CURB, y1 = CURB + 0.18;
  if (face === 'n') return [cx - 0.9, y0, cz - 0.9, cx + 0.9, y1, cz];
  if (face === 's') return [cx - 0.9, y0, cz, cx + 0.9, y1, cz + 0.9];
  if (face === 'w') return [cx - 0.9, y0, cz - 0.9, cx, y1, cz + 0.9];
  return [cx, y0, cz - 0.9, cx + 0.9, y1, cz + 0.9];
}
