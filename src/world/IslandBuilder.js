import * as THREE from 'three';
import { ISLAND, SEA, fbm } from './Island.js';
import { addHaze } from './Materials.js';
import { createRng } from './rng.js';

// ============================================================================
// Construye la isla dentro de los "chunks" de la ciudad (así se reutiliza el
// recorte por distancia): terreno, rutas con líneas pintadas, árboles y los
// lugares (pueblo, faro, observatorio, rancho, mirador, lago).
// Además arma una versión liviana de toda la isla que se dibuja "detrás" de
// todo: así las montañas se ven desde lejos aunque estén fuera de la
// distancia de dibujado.
// ============================================================================

const CHUNK = 128;
const _c = new THREE.Color();

const COL = {
  sand: 0xe8d6a6, wetSand: 0xc9b58a, seabed: 0xc7b68a, deep: 0x3d6a74,
  grass: 0x7fae52, lush: 0x5f9a45, forest: 0x4b7f3a, dry: 0xa8b066,
  rock: 0x8f8a80, rockDark: 0x6f6b64, dirt: 0x9c8664, field: 0xc9b25a, field2: 0x7d9b3c,
  city: 0x8b8a86,
};

export class IslandBuilder {
  constructor(island, city, materials, collision, quality) {
    this.I = island;
    this.city = city;
    this.materials = materials;
    this.collision = collision;
    this.quality = quality;
    this.root = new THREE.Group();
    this.root.name = 'Isla';
    this.animated = [];
    this.fields = [];
  }

  build() {
    this.collectFields();
    this.buildTerrain();
    this.buildRoads();
    this.buildPlaces();
    this.buildTrees();
    this.buildLake();
    this.buildFar();
  }

  // ------------------------------------------------------------ colores
  colorAt(x, z, h, i, j) {
    const I = this.I;
    const s = I.coastDist(x, z);
    const slope = I.slope(i, j);
    if (h < SEA - 0.05) {
      // fondo del mar: arena clara cerca de la orilla, oscuro mar adentro
      return _c.set(COL.seabed).lerp(_c.clone().set(COL.deep), Math.min(1, (SEA - h) / 8)).getHex();
    }
    if (I.cityDist(x, z) <= 0) return COL.city;
    if (s < 90 && h < 1.4) return h < SEA + 0.12 ? COL.wetSand : COL.sand;
    // campos del rancho
    for (const f of this.fields) {
      if (x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1) return Math.floor((x - f.x0) / 10) % 2 ? COL.field : COL.field2;
    }
    const n = fbm(x * 0.01, z * 0.01, 3);
    let col;
    if (slope > 0.9 || h > 185) col = n > 0.5 ? COL.rock : COL.rockDark;
    else {
      const forest = fbm(x * 0.004 + 50, z * 0.004 - 20, 3);
      col = forest > 0.52 ? COL.forest : n > 0.55 ? COL.dry : n > 0.42 ? COL.grass : COL.lush;
      if (slope > 0.55) col = _c.set(col).lerp(_c.clone().set(COL.rock), Math.min(1, (slope - 0.55) / 0.35)).getHex();
      if (h > 120) col = _c.set(col).lerp(_c.clone().set(COL.dry), Math.min(1, (h - 120) / 50)).getHex();
    }
    // banquina de tierra al costado de las rutas
    const rw = I.roadW[j * I.W + i];
    if (rw > 0.25 && rw < 1) col = _c.set(col).lerp(_c.clone().set(COL.dirt), (rw - 0.25) * 0.7).getHex();
    return col;
  }

  collectFields() {
    const r = this.I.places.find((p) => p.id === 'rancho');
    if (!r) return;
    this.fields.push({ x0: r.x - 160, z0: r.z + 40, x1: r.x - 40, z1: r.z + 130 });
    this.fields.push({ x0: r.x + 50, z0: r.z - 130, x1: r.x + 150, z1: r.z - 50 });
  }

  // ------------------------------------------------------------ terreno
  buildTerrain() {
    const I = this.I;
    const step = this.quality === 'low' ? 2 : 1; // celdas de 8 m en calidad baja
    const c = ISLAND.cell * step;
    const per = CHUNK / c;
    const [tw, th] = this.city.chunkAt(0, 0).ground.tile('terrain');
    const cx0 = Math.floor(ISLAND.minX / CHUNK), cx1 = Math.ceil(ISLAND.maxX / CHUNK);
    const cz0 = Math.floor(ISLAND.minZ / CHUNK), cz1 = Math.ceil(ISLAND.maxZ / CHUNK);
    for (let cz = cz0; cz < cz1; cz++) {
      for (let cx = cx0; cx < cx1; cx++) {
        const x0 = cx * CHUNK, z0 = cz * CHUNK;
        const verts = [], norms = [], uvs = [], cols = [], idx = [];
        let maxH = -99, any = false;
        const vid = new Map();
        const vertex = (gi, gj) => {
          const key = gi * 100000 + gj;
          if (vid.has(key)) return vid.get(key);
          const x = ISLAND.minX + gi * ISLAND.cell, z = ISLAND.minZ + gj * ISLAND.cell;
          const h = I.heightAtCell(gi, gj);
          // normal por diferencias centrales
          const hl = I.heightAtCell(gi - step, gj), hr = I.heightAtCell(gi + step, gj);
          const hd = I.heightAtCell(gi, gj - step), hu = I.heightAtCell(gi, gj + step);
          const nx = hl - hr, ny = 2 * c, nz = hd - hu;
          const nl = Math.hypot(nx, ny, nz);
          verts.push(x, h, z);
          norms.push(nx / nl, ny / nl, nz / nl);
          uvs.push(x / tw, -z / th);
          _c.set(this.colorAt(x, z, h, gi, gj));
          cols.push(_c.r, _c.g, _c.b);
          maxH = Math.max(maxH, h);
          const id = verts.length / 3 - 1;
          vid.set(key, id);
          return id;
        };
        for (let b = 0; b < per; b++) {
          for (let a = 0; a < per; a++) {
            const x = x0 + a * c, z = z0 + b * c;
            const gi = Math.round((x - ISLAND.minX) / ISLAND.cell), gj = Math.round((z - ISLAND.minZ) / ISLAND.cell);
            if (gi < 0 || gj < 0 || gi + step >= I.W || gj + step >= I.H) continue;
            // dentro de la ciudad y la playa ya hay piso propio
            const inCity = (px, pz) => I.cityDist(px, pz) <= 0 || I.inCityBeach(px, pz);
            if (inCity(x + 1, z + 1) && inCity(x + c - 1, z + 1) && inCity(x + 1, z + c - 1) && inCity(x + c - 1, z + c - 1)) continue;
            // mar profundo: no hace falta dibujar el fondo
            const hs = [I.heightAtCell(gi, gj), I.heightAtCell(gi + step, gj), I.heightAtCell(gi, gj + step), I.heightAtCell(gi + step, gj + step)];
            if (Math.max(...hs) < -7) continue;
            const v00 = vertex(gi, gj), v10 = vertex(gi + step, gj), v01 = vertex(gi, gj + step), v11 = vertex(gi + step, gj + step);
            // misma diagonal que Island.sample()
            idx.push(v00, v01, v10, v10, v01, v11);
            any = true;
          }
        }
        if (!any) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geo.setIndex(idx);
        const ch = this.city.chunkAt(x0 + CHUNK / 2, z0 + CHUNK / 2);
        const colArr = cols;
        ch.ground.addGeometry('terrain', geo, new THREE.Matrix4(), (vi) => _c.setRGB(colArr[vi * 3], colArr[vi * 3 + 1], colArr[vi * 3 + 2]).getHex());
        ch.maxHeight = Math.max(ch.maxHeight, maxH * 2.5);
        geo.dispose();
      }
    }
  }

  // ------------------------------------------------------------ rutas
  buildRoads() {
    for (const r of this.I.roads) {
      const pts = r.pts;
      const hw = r.width / 2;
      const B = (p) => this.city.chunkAt(p.x, p.z);
      const [tw, th] = B(pts[0]).ground.tile('asphalt');
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
        const ch = B(mid);
        const ya = a.y + 0.05, yb = b.y + 0.05;
        const L = (p, o) => [p.x - p.tz * o, 0, p.z + p.tx * o];
        const al = L(a, -hw), ar = L(a, hw), bl = L(b, -hw), br = L(b, hw);
        al[1] = ar[1] = ya; bl[1] = br[1] = yb;
        ch.ground.quad('asphalt', ar, br, bl, al, [hw * 2 / tw, a.d / th, hw * 2 / tw, b.d / th, 0, b.d / th, 0, a.d / th]);
        // líneas: bordes blancos y doble amarilla al centro (cortada cada tanto)
        const line = (off, w, color, dashed) => {
          if (dashed && Math.floor(a.d / 4) % 2) return;
          const p0 = L(a, off - w / 2), p1 = L(a, off + w / 2), q0 = L(b, off - w / 2), q1 = L(b, off + w / 2);
          p0[1] = p1[1] = ya + 0.02; q0[1] = q1[1] = yb + 0.02;
          ch.marks.quad('marking', p1, q1, q0, p0, [0, 0, 1, 0, 1, 1, 0, 1], color);
        };
        line(-hw + 0.45, 0.15, 0xf2f2f2, false);
        line(hw - 0.45, 0.15, 0xf2f2f2, false);
        line(-0.12, 0.12, 0xf2c94c, false);
        line(0.12, 0.12, 0xf2c94c, false);
        // guardarraíl donde la ruta va alta sobre el terreno (curvas de montaña)
        if (i % 2 === 0) {
          for (const side of [-1, 1]) {
            const px = a.x - a.tz * (hw + 0.6) * side, pz = a.z + a.tx * (hw + 0.6) * side;
            const ground = this.I.rawHeight(px, pz);
            if (a.y - ground > 3.5) {
              const q = L(b, (hw + 0.6) * side);
              const p = [px, ya, pz];
              ch.detail.quad('metal', [p[0], ya + 0.3, p[2]], [q[0], yb + 0.3, q[2]], [q[0], yb + 0.75, q[2]], [p[0], ya + 0.75, p[2]], [0, 0, 1, 0, 1, 1, 0, 1], 0xb8bcc0);
              ch.detail.quad('metal', [q[0], yb + 0.3, q[2]], [p[0], ya + 0.3, p[2]], [p[0], ya + 0.75, p[2]], [q[0], yb + 0.75, q[2]], [0, 0, 1, 0, 1, 1, 0, 1], 0xb8bcc0);
            }
          }
        }
      }
      // carteles con el nombre de la ruta al salir de la ciudad
      const p = pts[Math.min(pts.length - 1, 20)];
      const ch = B(p);
      const sx = p.x - p.tz * (hw + 2.5), sz = p.z + p.tx * (hw + 2.5);
      ch.detail.cylinder('metal', sx, sz, p.y, p.y + 3.2, 0.06, 6, 0x9aa0a6);
      ch.detail.box(sx - 1.4, p.y + 2.4, sz - 0.05, sx + 1.4, p.y + 3.3, sz + 0.05, { side: 'paint', color: 0x1f6f43 });
    }
  }

  // ------------------------------------------------------------ lugares
  buildPlaces() {
    const rng = createRng(919);
    for (const p of this.I.places) {
      if (p.type === 'village') this.buildVillage(p, rng);
      else if (p.type === 'lighthouse') this.buildLighthouse(p);
      else if (p.type === 'observatory') this.buildObservatory(p);
      else if (p.type === 'ranch') this.buildRanch(p, rng);
      else if (p.type === 'mirador') this.buildMirador(p);
    }
  }

  // casa simple con techo a dos aguas
  house(x, z, w, d, y, h, wallColor, roofColor, alongX = w >= d) {
    if (this.distToRoad(x, z) < Math.max(w, d) / 2 + 2) return;
    const ch = this.city.chunkAt(x, z);
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
    ch.bld.box(x0, y - 0.5, z0, x1, y + h, z1, { side: 'house', top: null, color: wallColor, vOrigin: y });
    ch.bld.gable('roofTile', x0 - 0.4, z0 - 0.4, x1 + 0.4, z1 + 0.4, y + h, Math.min(w, d) * 0.35, alongX, roofColor, 'paint', wallColor);
    ch.maxHeight = Math.max(ch.maxHeight, y + h + 6);
    this.collision.addBox(x0, y - 1, z0, x1, y + h + 2, z1, 'building');
  }

  buildVillage(p, rng) {
    const y = p.y;
    const walls = [0xf4e3c1, 0xc9e4de, 0xf7d6e0, 0xfdf0d5, 0xbde0fe, 0xffd6a5, 0xe2ece9];
    const roofs = [0xb5523b, 0x8d4b3b, 0x3d5a80, 0x6b705c];
    // casas alrededor de una placita, todas sobre la explanada
    const spots = [[-32, -24], [-14, -30], [6, -32], [26, -26], [36, -6], [34, 16], [-36, 0], [-34, 20], [-16, 30], [16, 32]];
    for (const [ox, oz] of spots) {
      const w = rng.range(7, 10), d = rng.range(6, 9);
      const hx = p.x + ox, hz = p.z + oz;
      // ninguna casa encima de la ruta
      if (this.distToRoad(hx, hz) < 13) continue;
      this.house(hx, hz, w, d, y, rng.range(3.2, 5.5), rng.pick(walls), rng.pick(roofs));
    }
    const ch = this.city.chunkAt(p.x, p.z);
    // plaza con fuente y árboles
    ch.ground.floor('plaza', p.x - 14, p.z - 14, p.x + 14, p.z + 14, y + 0.03);
    ch.detail.cylinder('concrete', p.x, p.z, y, y + 0.6, 2.4, 14, 0xd8d2c4);
    ch.detail.cylinder('pool', p.x, p.z, y, y + 0.55, 2.1, 14, 0xffffff);
    for (const [ox, oz] of [[-10, -10], [10, -10], [-10, 10], [10, 10]]) this.city.addInstance('palm', p.x + ox, y, p.z + oz, rng.range(0, 6), rng.range(0.9, 1.2));
    // muelle de pesca hacia el mar y botes
    const dir = this.seaDirection(p.x, p.z);
    const len = 70;
    for (let k = 0; k < len; k += 4) {
      const cx = p.x + dir.x * (40 + k), cz = p.z + dir.z * (40 + k);
      const cc = this.city.chunkAt(cx, cz);
      cc.detail.box(cx - 2.2, 0.35, cz - 2.2, cx + 2.2, 0.6, cz + 2.2, { side: 'wood' });
      cc.detail.cylinder('wood', cx + 2, cz + 2, -2, 0.4, 0.18, 6);
      this.collision.addBox(cx - 2.2, -2, cz - 2.2, cx + 2.2, 0.6, cz + 2.2, 'ground');
    }
    for (let k = 0; k < 4; k++) {
      const off = (k % 2 ? 1 : -1) * 6;
      const bx = p.x + dir.x * (55 + k * 12) - dir.z * off, bz = p.z + dir.z * (55 + k * 12) + dir.x * off;
      const cc = this.city.chunkAt(bx, bz);
      const color = rng.pick([0xe63946, 0x1d3557, 0xf1faee, 0x2a9d8f, 0xe9c46a]);
      cc.detail.box(bx - 1.2, -0.25, bz - 3, bx + 1.2, 0.6, bz + 3, { side: 'paint', color, top: 'wood' });
      cc.detail.box(bx - 0.6, 0.6, bz - 0.5, bx + 0.6, 1.6, bz + 1.2, { side: 'paint', color: 0xf4f4f4 });
    }
  }

  distToRoad(x, z) {
    let best = Infinity;
    for (const r of this.I.roads) for (const q of r.pts) best = Math.min(best, Math.hypot(q.x - x, q.z - z) - r.width / 2);
    return best;
  }

  seaDirection(x, z) {
    // dirección (aprox.) hacia la costa más cercana
    let best = { x: 0, z: -1 }, bd = Infinity;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
      const dx = Math.cos(a), dz = Math.sin(a);
      for (let d = 10; d < 400; d += 10) {
        if (this.I.coastDist(x + dx * d, z + dz * d) < 0) {
          if (d < bd) { bd = d; best = { x: dx, z: dz }; }
          break;
        }
      }
    }
    return best;
  }

  buildLighthouse(p) {
    const y = p.y;
    const ch = this.city.chunkAt(p.x, p.z);
    const H = 24;
    // torre a rayas blancas y rojas
    for (let k = 0; k < 6; k++) {
      const y0 = y + (k * H) / 6, y1 = y + ((k + 1) * H) / 6;
      const r = 3.2 - k * 0.25;
      ch.bld.cylinder('paint', p.x, p.z, y0, y1, r, 16, k % 2 ? 0xc0392b : 0xf5f5f5, k === 5);
    }
    ch.bld.cylinder('metal', p.x, p.z, y + H, y + H + 0.4, 2.6, 16, 0x2b2f33);
    ch.bld.cylinder('glass', p.x, p.z, y + H + 0.4, y + H + 3.2, 1.6, 12, 0xffffff, false);
    ch.bld.cylinder('paint', p.x, p.z, y + H + 3.2, y + H + 4.2, 1.9, 12, 0xc0392b);
    ch.maxHeight = Math.max(ch.maxHeight, 300);
    this.collision.addBox(p.x - 3, y - 1, p.z - 3, p.x + 3, y + H + 4, p.z + 3, 'building');
    this.house(p.x + 12, p.z - 9, 8, 6, y, 3.5, 0xf5f5f5, 0x8d4b3b);
    // luz giratoria (se ve de noche)
    const beamGeo = new THREE.ConeGeometry(4, 110, 16, 6, true);
    beamGeo.translate(0, -55, 0);
    beamGeo.rotateZ(Math.PI / 2);
    // se desvanece a lo largo del haz
    const bp = beamGeo.getAttribute('position');
    const bc = new Float32Array(bp.count * 3);
    for (let k = 0; k < bp.count; k++) {
      const t = Math.min(1, Math.abs(bp.getX(k)) / 110);
      const v = Math.pow(1 - t, 1.6);
      bc[k * 3] = v; bc[k * 3 + 1] = v * 0.95; bc[k * 3 + 2] = v * 0.75;
    }
    beamGeo.setAttribute('color', new THREE.BufferAttribute(bc, 3));
    const beamMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const beam = new THREE.Group();
    beam.position.set(p.x, y + H + 1.8, p.z);
    const m1 = new THREE.Mesh(beamGeo, beamMat);
    const m2 = new THREE.Mesh(beamGeo, beamMat);
    m2.rotation.y = Math.PI;
    beam.add(m1, m2);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff6d0, toneMapped: false }));
    beam.add(lamp);
    this.root.add(beam);
    this.animated.push({ kind: 'beam', obj: beam, mat: beamMat, lamp });
  }

  buildObservatory(p) {
    const y = p.y;
    const ch = this.city.chunkAt(p.x, p.z);
    ch.ground.floor('concrete', p.x - 30, p.z - 30, p.x + 30, p.z + 30, y + 0.03, 0xdedad2);
    // edificio y cúpula
    ch.bld.cylinder('paint', p.x, p.z, y - 0.5, y + 9, 10, 24, 0xf2f2ee);
    const dome = new THREE.SphereGeometry(10.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    ch.bld.addGeometry('metal', dome, new THREE.Matrix4().makeTranslation(p.x, y + 9, p.z), () => 0xe8ecf0);
    ch.bld.box(p.x - 1.2, y + 12, p.z - 10.5, p.x + 1.2, y + 19, p.z - 3, { side: 'paint', color: 0x2b2f33 });
    this.collision.addBox(p.x - 10, y - 1, p.z - 10, p.x + 10, y + 19, p.z + 10, 'building');
    this.house(p.x + 20, p.z - 18, 10, 7, y, 3.6, 0xe9ecef, 0x5c677d);
    // antenas con luces rojas
    for (const [ox, oz, h] of [[-22, 14, 46], [22, 20, 34]]) {
      const ax = p.x + ox, az = p.z + oz;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) ch.detail.box(ax + sx * 1.2 - 0.12, y, az + sz * 1.2 - 0.12, ax + sx * 1.2 + 0.12, y + h, az + sz * 1.2 + 0.12, { side: 'metal', color: 0xc0392b });
      for (let k = 6; k < h; k += 6) ch.detail.box(ax - 1.3, y + k, az - 1.3, ax + 1.3, y + k + 0.2, az + 1.3, { side: 'metal', color: 0xf2f2f2 });
      ch.detail.box(ax - 0.35, y + h, az - 0.35, ax + 0.35, y + h + 0.7, az + 0.35, { side: 'neonTube', color: 0xff2020 });
      this.collision.addBox(ax - 1.5, y, az - 1.5, ax + 1.5, y + h, az + 1.5, 'building');
    }
    ch.maxHeight = Math.max(ch.maxHeight, 400);
    // barandas del borde de la explanada
    this.railing(p.x, p.z, 30, y);
  }

  railing(cx, cz, r, y) {
    const ch = this.city.chunkAt(cx, cz);
    const seg = 28;
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      if (k % 7 === 0) continue; // entradas
      const p0 = [cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r];
      ch.detail.quad('metal', [p0[0], y + 0.9, p0[2]], [p1[0], y + 0.9, p1[2]], [p1[0], y + 1.05, p1[2]], [p0[0], y + 1.05, p0[2]], [0, 0, 1, 0, 1, 1, 0, 1], 0x9aa0a6);
      ch.detail.quad('metal', [p1[0], y + 0.9, p1[2]], [p0[0], y + 0.9, p0[2]], [p0[0], y + 1.05, p0[2]], [p1[0], y + 1.05, p1[2]], [0, 0, 1, 0, 1, 1, 0, 1], 0x9aa0a6);
      ch.detail.cylinder('metal', p0[0], p0[2], y, y + 1.05, 0.05, 5, 0x9aa0a6);
    }
  }

  buildMirador(p) {
    const y = p.y;
    const ch = this.city.chunkAt(p.x, p.z);
    ch.ground.floor('wood', p.x - 9, p.z - 9, p.x + 9, p.z + 9, y + 0.08);
    this.railing(p.x, p.z, 12, y);
    for (const [ox, oz, rot] of [[-5, 0, Math.PI / 2], [5, 0, -Math.PI / 2], [0, 5, Math.PI]]) this.city.addInstance('bench', p.x + ox, y, p.z + oz, rot, 1);
    this.city.addInstance('lamp', p.x + 8, y, p.z + 8, 0, 1);
  }

  buildRanch(p, rng) {
    const y = p.y;
    const ch = this.city.chunkAt(p.x, p.z);
    // granero rojo, casa, silo y corral
    ch.bld.box(p.x - 14, y - 0.5, p.z - 26, p.x + 4, y + 7, p.z - 12, { side: 'paint', top: null, color: 0xa4302a });
    ch.bld.gable('roofMetal', p.x - 14.5, p.z - 26.5, p.x + 4.5, p.z - 11.5, y + 7, 5, true, 0x6b6b6b, 'paint', 0xa4302a);
    ch.bld.facePanel('garageDoor', 's', p.x - 5, p.z - 12, 6, y, 5, 0.05, 0xf2f2f2);
    this.collision.addBox(p.x - 14, y - 1, p.z - 26, p.x + 4, y + 12, p.z - 12, 'building');
    ch.bld.cylinder('metal', p.x + 12, p.z - 20, y - 0.5, y + 14, 3.2, 14, 0xc9ccd0);
    const domeGeo = new THREE.SphereGeometry(3.2, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    ch.bld.addGeometry('metal', domeGeo, new THREE.Matrix4().makeTranslation(p.x + 12, y + 14, p.z - 20), () => 0xc9ccd0);
    this.collision.addBox(p.x + 9, y - 1, p.z - 23, p.x + 15, y + 17, p.z - 17, 'building');
    this.house(p.x + 18, p.z + 10, 12, 9, y, 4, 0xfdf0d5, 0x8d4b3b);
    // cerca de madera alrededor del corral
    const fence = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.ceil(len / 3);
      for (let k = 0; k <= n; k++) {
        const fx = x0 + ((x1 - x0) * k) / n, fz = z0 + ((z1 - z0) * k) / n;
        ch.detail.box(fx - 0.08, y, fz - 0.08, fx + 0.08, y + 1.2, fz + 0.08, { side: 'wood' });
      }
      for (const hh of [0.5, 1.0]) {
        const dx = (z1 - z0) / len * 0.05, dz = (x1 - x0) / len * 0.05;
        ch.detail.quad('wood', [x0 - dx, y + hh, z0 + dz], [x1 - dx, y + hh, z1 + dz], [x1 - dx, y + hh + 0.15, z1 + dz], [x0 - dx, y + hh + 0.15, z0 + dz], [0, 0, len / 3, 0, len / 3, 1, 0, 1]);
        ch.detail.quad('wood', [x1 + dx, y + hh, z1 - dz], [x0 + dx, y + hh, z0 - dz], [x0 + dx, y + hh + 0.15, z0 - dz], [x1 + dx, y + hh + 0.15, z1 - dz], [0, 0, len / 3, 0, len / 3, 1, 0, 1]);
      }
    };
    fence(p.x - 30, p.z + 2, p.x + 2, p.z + 2);
    fence(p.x - 30, p.z + 2, p.x - 30, p.z + 30);
    fence(p.x - 30, p.z + 30, p.x + 2, p.z + 30);
    for (let k = 0; k < 8; k++) this.city.addInstance('palmFar', p.x + rng.range(-40, 40), y, p.z + rng.range(30, 44), rng.range(0, 6), rng.range(0.9, 1.3));
  }

  // ------------------------------------------------------------ árboles
  buildTrees() {
    const I = this.I;
    const rng = createRng(2024);
    const density = { low: 0.4, medium: 0.75, high: 1 }[this.quality] ?? 0.75;
    const spacing = 13;
    const tint = () => _c.setHSL(rng.range(0.24, 0.34), rng.range(0.35, 0.55), rng.range(0.3, 0.42)).clone();
    for (let z = ISLAND.minZ + 8; z < ISLAND.maxZ - 8; z += spacing) {
      for (let x = ISLAND.minX + 8; x < ISLAND.maxX - 8; x += spacing) {
        const px = x + rng.range(-5, 5), pz = z + rng.range(-5, 5);
        const keep = rng.next();
        if (I.cityDist(px, pz) < 25 || I.inCityBeach(px, pz)) continue;
        const s = I.coastDist(px, pz);
        if (s < 20) continue;
        if (I.roadWeight(px, pz) > 0.05) continue;
        if (this.nearPlace(px, pz)) continue;
        const h = I.sample(px, pz);
        if (h < SEA + 0.6 || h > 185) continue;
        const gi = Math.round((px - ISLAND.minX) / ISLAND.cell), gj = Math.round((pz - ISLAND.minZ) / ISLAND.cell);
        if (I.slope(gi, gj) > 0.8) continue;
        if (Math.hypot(px - I.lake.x, pz - I.lake.z) < I.lake.r + 6) continue;
        if (this.fields.some((f) => px > f.x0 - 4 && px < f.x1 + 4 && pz > f.z0 - 4 && pz < f.z1 + 4)) continue;
        const forest = fbm(px * 0.004 + 50, pz * 0.004 - 20, 3);
        let p = forest > 0.52 ? 0.85 : forest > 0.46 ? 0.3 : 0.07;
        if (s < 140) p = 0.22; // palmeras cerca de la costa
        if (keep > p * density) continue;
        if (s < 140) this.city.addInstance('palmFar', px, h - 0.1, pz, rng.range(0, 6), rng.range(0.85, 1.35));
        else this.city.addInstance('treeFar', px, h - 0.15, pz, rng.range(0, 6), rng.range(0.9, 1.6), tint());
      }
    }
  }

  nearPlace(x, z) {
    for (const p of this.I.places) if (p.r > 0 && Math.hypot(x - p.x, z - p.z) < p.r + 8) return true;
    return false;
  }

  // ------------------------------------------------------------ lago
  buildLake() {
    const lk = this.I.lake;
    const geo = new THREE.CircleGeometry(lk.r + 30, 48);
    geo.rotateX(-Math.PI / 2);
    const cols = new Float32Array(geo.getAttribute('position').count * 3);
    for (let i = 0; i < cols.length; i += 3) { cols[i] = 0.55; cols[i + 1] = 0.85; cols[i + 2] = 0.8; }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 14, uv.getY(i) * 14);
    const water = new THREE.Mesh(geo, this.materials.get('water'));
    water.position.set(lk.x, lk.level, lk.z);
    this.root.add(water);
    // muellecito
    const ch = this.city.chunkAt(lk.x, lk.z - lk.r);
    const y = lk.level + 0.45;
    ch.detail.box(lk.x - 1.5, y - 0.2, lk.z - lk.r - 4, lk.x + 1.5, y, lk.z - lk.r + 18, { side: 'wood' });
    this.collision.addBox(lk.x - 1.5, y - 2, lk.z - lk.r - 4, lk.x + 1.5, y, lk.z - lk.r + 18, 'ground');
  }

  // ------------------------------------------------------------ isla lejana
  // Malla liviana de toda la isla (celdas de 24 m) + océano, dibujada antes que
  // todo y escalada hacia la cámara para que entre en el rango de dibujado.
  buildFar() {
    const I = this.I;
    const st = 6; // 6 celdas = 24 m
    const nx = Math.floor((I.W - 1) / st), nz = Math.floor((I.H - 1) / st);
    const pos = [], col = [], idx = [];
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const gi = i * st, gj = j * st;
        const x = ISLAND.minX + gi * ISLAND.cell, z = ISLAND.minZ + gj * ISLAND.cell;
        const h = I.heightAtCell(gi, gj);
        pos.push(x, Math.max(h, SEA - 2), z);
        _c.set(h < SEA ? 0x2c6a80 : this.colorAt(x, z, h, gi, gj));
        // de lejos el bosque se ve más oscuro (no hay árboles dibujados)
        if (h > SEA && fbm(x * 0.004 + 50, z * 0.004 - 20, 3) > 0.52) _c.multiplyScalar(0.78);
        col.push(_c.r, _c.g, _c.b);
      }
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    // edificios altos (de lejos se ve el perfil de la ciudad)
    const box = (x0, z0, x1, z1, y1, color) => {
      _c.set(color);
      const base = pos.length / 3;
      const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
      for (const [x, z] of corners) { pos.push(x, 0, z); col.push(_c.r * 0.8, _c.g * 0.8, _c.b * 0.8); }
      for (const [x, z] of corners) { pos.push(x, y1, z); col.push(_c.r, _c.g, _c.b); }
      for (let k = 0; k < 4; k++) {
        const a = base + k, b = base + ((k + 1) % 4), c = a + 4, d = b + 4;
        idx.push(a, c, b, b, c, d);
      }
      idx.push(base + 4, base + 7, base + 5, base + 5, base + 7, base + 6);
    };
    for (const bld of this.city.L.buildings) {
      const f = bld.footprint;
      if (!f || !(bld.height > 18) || !bld.top) continue;
      const c = bld.style === 'glass' ? 0x7f9bb5 : bld.style === 'hotel' ? 0xe8dcc8 : 0xb9b3a8;
      box(f.x0, f.z0, f.x1, f.z1, bld.top.y, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.impScale = { scale: { value: 0.2 }, min: { value: 300 } };
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    addHaze(mat, this.impScale);
    const far = new THREE.Mesh(geo, mat);
    far.frustumCulled = false;
    far.renderOrder = -8;
    far.matrixAutoUpdate = false;
    // océano lejano
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), (() => {
      const m = new THREE.MeshLambertMaterial({ color: 0x2c6a80 });
      addHaze(m, this.impScale);
      return m;
    })());
    sea.position.set(-250, SEA - 0.3, -250);
    sea.updateMatrix();
    sea.frustumCulled = false;
    sea.renderOrder = -9;
    sea.matrixAutoUpdate = false;
    // después de dibujar lo lejano se borra la profundidad: lo cercano siempre queda adelante
    const clear = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.001), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    clear.frustumCulled = false;
    clear.renderOrder = -7;
    clear.onBeforeRender = (renderer) => {
      renderer.state.buffers.depth.setMask(true);
      renderer.clearDepth();
    };
    this.farGroup = new THREE.Group();
    this.farGroup.add(sea, far, clear);
    this.root.add(this.farGroup);
  }

  update(dt, time, night, camera) {
    if (this.impScale && camera) {
      this.impScale.scale.value = Math.min(0.35, (camera.far * 0.85) / 3400);
      this.impScale.min.value = Math.max(60, (camera.far - 60) * 0.85);
    }
    for (const a of this.animated) {
      if (a.kind === 'beam') {
        a.obj.rotation.y = time * 0.9;
        a.mat.opacity = Math.max(0, night - 0.2) * 0.12;
        a.lamp.visible = night > 0.2;
      }
    }
  }
}
