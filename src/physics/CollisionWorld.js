// Mundo de colisiones estático: cajas alineadas a ejes (AABB) en una grilla espacial.
// Mucho más liviano que un motor de física completo y suficiente para una ciudad en grilla.
// Cada caja: { minX, minY, minZ, maxX, maxY, maxZ, type }.

const CELL = 16;

export class CollisionWorld {
  constructor() {
    this.boxes = [];
    this.cells = new Map();
    this.stamp = 0;
    this.marks = [];
    this.groundFn = null; // función extra de altura de terreno (playa)
  }

  add(box) {
    const id = this.boxes.length;
    this.boxes.push(box);
    this.marks.push(0);
    const cx0 = Math.floor(box.minX / CELL), cx1 = Math.floor(box.maxX / CELL);
    const cz0 = Math.floor(box.minZ / CELL), cz1 = Math.floor(box.maxZ / CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const key = cx * 73856093 ^ cz * 19349663;
        let list = this.cells.get(key);
        if (!list) this.cells.set(key, (list = []));
        list.push(id);
      }
    }
    return id;
  }

  addBox(x0, y0, z0, x1, y1, z1, type = 'solid') {
    return this.add({ minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minY: y0, maxY: y1, minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), type });
  }

  // Devuelve las cajas que tocan el rectángulo XZ (sin duplicados).
  query(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    this.stamp++;
    const cx0 = Math.floor(minX / CELL), cx1 = Math.floor(maxX / CELL);
    const cz0 = Math.floor(minZ / CELL), cz1 = Math.floor(maxZ / CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = this.cells.get(cx * 73856093 ^ cz * 19349663);
        if (!list) continue;
        for (const id of list) {
          if (this.marks[id] === this.stamp) continue;
          this.marks[id] = this.stamp;
          const b = this.boxes[id];
          if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue;
          out.push(b);
        }
      }
    }
    return out;
  }

  // Altura del piso bajo un punto (considerando cajas cuyo techo está por debajo de maxY).
  groundHeight(x, z, maxY, radius = 0) {
    let h = this.groundFn ? this.groundFn(x, z) : 0;
    const list = this.query(x - radius, z - radius, x + radius, z + radius, this._tmp || (this._tmp = []));
    for (const b of list) {
      if (b.maxY > maxY) continue;
      if (x + radius < b.minX || x - radius > b.maxX || z + radius < b.minZ || z - radius > b.maxZ) continue;
      if (b.maxY > h) h = b.maxY;
    }
    return h;
  }

  // Resuelve un círculo (cilindro vertical) contra las cajas. Modifica pos y devuelve true si chocó.
  // stepHeight: obstáculos más bajos que esto se suben en lugar de chocar.
  resolveCylinder(pos, radius, height, stepHeight, normalOut) {
    let hit = false;
    const feet = pos.y;
    const list = this.query(pos.x - radius - 0.5, pos.z - radius - 0.5, pos.x + radius + 0.5, pos.z + radius + 0.5, this._tmp2 || (this._tmp2 = []));
    for (let iter = 0; iter < 2; iter++) {
      for (const b of list) {
        if (b.maxY <= feet + stepHeight || b.minY >= feet + height) continue;
        const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
        let dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = radius - d;
          dx /= d; dz /= d;
          pos.x += dx * push;
          pos.z += dz * push;
          if (normalOut) { normalOut.x = dx; normalOut.z = dz; }
        } else {
          // centro dentro de la caja: salir por la cara más cercana
          const l = pos.x - b.minX, r = b.maxX - pos.x, n = pos.z - b.minZ, s = b.maxZ - pos.z;
          const m = Math.min(l, r, n, s);
          if (m === l) { pos.x = b.minX - radius; if (normalOut) { normalOut.x = -1; normalOut.z = 0; } }
          else if (m === r) { pos.x = b.maxX + radius; if (normalOut) { normalOut.x = 1; normalOut.z = 0; } }
          else if (m === n) { pos.z = b.minZ - radius; if (normalOut) { normalOut.x = 0; normalOut.z = -1; } }
          else { pos.z = b.maxZ + radius; if (normalOut) { normalOut.x = 0; normalOut.z = 1; } }
        }
        hit = true;
      }
    }
    return hit;
  }

  // Rayo (segmento) contra todas las cajas: devuelve la fracción t (0..1) del primer impacto o 1.
  raycast(ox, oy, oz, ex, ey, ez, pad = 0) {
    const dx = ex - ox, dy = ey - oy, dz = ez - oz;
    const list = this.query(Math.min(ox, ex) - pad, Math.min(oz, ez) - pad, Math.max(ox, ex) + pad, Math.max(oz, ez) + pad, this._tmp3 || (this._tmp3 = []));
    let best = 1;
    for (const b of list) {
      if (b.type === 'ghost' || b.type === 'prop' || b.type === 'bound') continue;
      const t = segmentBox(ox, oy, oz, dx, dy, dz, b.minX - pad, b.minY - pad, b.minZ - pad, b.maxX + pad, b.maxY + pad, b.maxZ + pad);
      if (t >= 0 && t < best) best = t;
    }
    return best;
  }
}

function segmentBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = 0, tmax = 1;
  const o = [ox, oy, oz], d = [dx, dy, dz], mn = [x0, y0, z0], mx = [x1, y1, z1];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < mn[a] || o[a] > mx[a]) return -1;
    } else {
      const inv = 1 / d[a];
      let t1 = (mn[a] - o[a]) * inv, t2 = (mx[a] - o[a]) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}
