import * as THREE from 'three';

// ============================================================================
// Acumulador de geometría: junta miles de cajas/quads en pocas mallas por
// material (pocas draw calls = buen rendimiento en GPUs integradas).
// UV en metros reales divididos por el tamaño del módulo de textura.
// ============================================================================

const _c = new THREE.Color();

export class MeshBuilder {
  constructor(materials) {
    this.materials = materials;
    this.buckets = new Map();
  }

  bucket(key) {
    let b = this.buckets.get(key);
    if (!b) {
      b = { p: [], n: [], u: [], c: [], i: [] };
      this.buckets.set(key, b);
    }
    return b;
  }

  tile(key) {
    const t = this.materials.texInfo(key);
    return t ? [t.tileW, t.tileH] : [1, 1];
  }

  // Quad con vértices en orden antihorario visto desde el frente.
  quad(key, a, b, c, d, uvs, color = 0xffffff) {
    const B = this.bucket(key);
    const base = B.p.length / 3;
    B.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
    // normal = (b - a) x (d - a)
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 4; k++) B.n.push(nx, ny, nz);
    B.u.push(...uvs);
    _c.set(color);
    for (let k = 0; k < 4; k++) B.c.push(_c.r, _c.g, _c.b);
    B.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  tri(key, a, b, c, uvs, color = 0xffffff) {
    const B = this.bucket(key);
    const base = B.p.length / 3;
    B.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 3; k++) B.n.push(nx, ny, nz);
    B.u.push(...uvs);
    _c.set(color);
    for (let k = 0; k < 3; k++) B.c.push(_c.r, _c.g, _c.b);
    B.i.push(base, base + 1, base + 2);
  }

  // Plano horizontal (piso) con UV mundial.
  floor(key, x0, z0, x1, z1, y, color = 0xffffff) {
    const [tw, th] = this.tile(key);
    this.quad(key, [x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0],
      [x0 / tw, -z1 / th, x1 / tw, -z1 / th, x1 / tw, -z0 / th, x0 / tw, -z0 / th], color);
  }

  // Caja. opts: side (material de caras), top (material del techo o null), bottom,
  // color, vOrigin (altura de referencia para alinear pisos), uOffset, faces (subconjunto 'nsewtb').
  box(x0, y0, z0, x1, y1, z1, opts = {}) {
    const side = opts.side ?? 'paint';
    const top = opts.top === undefined ? side : opts.top;
    const color = opts.color ?? 0xffffff;
    const faces = opts.faces || 'nsewt';
    const [tw, th] = this.tile(side);
    const vo = opts.vOrigin ?? y0;
    const uo = opts.uOffset ?? 0;
    const v0 = (y0 - vo) / th, v1 = (y1 - vo) / th;
    const dx = x1 - x0, dz = z1 - z0;
    if (faces.includes('e')) this.quad(side, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [uo, v0, uo + dz / tw, v0, uo + dz / tw, v1, uo, v1], color);
    if (faces.includes('w')) this.quad(side, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [uo, v0, uo + dz / tw, v0, uo + dz / tw, v1, uo, v1], color);
    if (faces.includes('s')) this.quad(side, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [uo, v0, uo + dx / tw, v0, uo + dx / tw, v1, uo, v1], color);
    if (faces.includes('n')) this.quad(side, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [uo, v0, uo + dx / tw, v0, uo + dx / tw, v1, uo, v1], color);
    if (top && faces.includes('t')) this.floor(top, x0, z0, x1, z1, y1, opts.topColor ?? color);
    if (opts.bottom) {
      const bk = opts.bottom;
      this.quad(bk, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, 0, 1, 0, 1, 1, 0, 1], opts.bottomColor ?? color);
    }
  }

  // Panel vertical delgado sobre una fachada (puertas, portones), mirando hacia 'face'.
  facePanel(key, face, cx, cz, w, y0, h, offset = 0.04, color = 0xffffff) {
    const hw = w / 2;
    const uvs = [0, 0, 1, 0, 1, 1, 0, 1];
    if (face === 's') this.quad(key, [cx - hw, y0, cz + offset], [cx + hw, y0, cz + offset], [cx + hw, y0 + h, cz + offset], [cx - hw, y0 + h, cz + offset], uvs, color);
    else if (face === 'n') this.quad(key, [cx + hw, y0, cz - offset], [cx - hw, y0, cz - offset], [cx - hw, y0 + h, cz - offset], [cx + hw, y0 + h, cz - offset], uvs, color);
    else if (face === 'e') this.quad(key, [cx + offset, y0, cz + hw], [cx + offset, y0, cz - hw], [cx + offset, y0 + h, cz - hw], [cx + offset, y0 + h, cz + hw], uvs, color);
    else this.quad(key, [cx - offset, y0, cz - hw], [cx - offset, y0, cz + hw], [cx - offset, y0 + h, cz + hw], [cx - offset, y0 + h, cz - hw], uvs, color);
  }

  // Techo a dos aguas sobre un rectángulo.
  gable(key, x0, z0, x1, z1, y, h, alongX, color, wallKey, wallColor) {
    const [tw, th] = this.tile(key);
    if (alongX) {
      const zm = (z0 + z1) / 2, yt = y + h;
      const slope = Math.hypot(zm - z0, h);
      this.quad(key, [x0, y, z1], [x1, y, z1], [x1, yt, zm], [x0, yt, zm], [x0 / tw, 0, x1 / tw, 0, x1 / tw, slope / th, x0 / tw, slope / th], color);
      this.quad(key, [x1, y, z0], [x0, y, z0], [x0, yt, zm], [x1, yt, zm], [x1 / tw, 0, x0 / tw, 0, x0 / tw, slope / th, x1 / tw, slope / th], color);
      this.tri(wallKey, [x0 + 0.5, y, z0 + 0.5], [x0 + 0.5, y, z1 - 0.5], [x0 + 0.5, yt - 0.3, zm], [0, 0, 0, 0, 0, 0], wallColor);
      this.tri(wallKey, [x1 - 0.5, y, z1 - 0.5], [x1 - 0.5, y, z0 + 0.5], [x1 - 0.5, yt - 0.3, zm], [0, 0, 0, 0, 0, 0], wallColor);
    } else {
      const xm = (x0 + x1) / 2, yt = y + h;
      const slope = Math.hypot(xm - x0, h);
      this.quad(key, [x1, y, z1], [x1, y, z0], [xm, yt, z0], [xm, yt, z1], [z1 / tw, 0, z0 / tw, 0, z0 / tw, slope / th, z1 / tw, slope / th], color);
      this.quad(key, [x0, y, z0], [x0, y, z1], [xm, yt, z1], [xm, yt, z0], [z0 / tw, 0, z1 / tw, 0, z1 / tw, slope / th, z0 / tw, slope / th], color);
      this.tri(wallKey, [x0 + 0.5, y, z1 - 0.5], [x1 - 0.5, y, z1 - 0.5], [xm, yt - 0.3, z1 - 0.5], [0, 0, 0, 0, 0, 0], wallColor);
      this.tri(wallKey, [x1 - 0.5, y, z0 + 0.5], [x0 + 0.5, y, z0 + 0.5], [xm, yt - 0.3, z0 + 0.5], [0, 0, 0, 0, 0, 0], wallColor);
    }
  }

  // Cilindro vertical (chimeneas, silos, postes gruesos).
  cylinder(key, cx, cz, y0, y1, r, seg = 10, color = 0xffffff, cap = true) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r;
      const x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
      this.quad(key, [x1, y0, z1], [x0, y0, z0], [x0, y1, z0], [x1, y1, z1], [i / seg, 0, (i + 1) / seg, 0, (i + 1) / seg, 1, i / seg, 1], color);
      if (cap) this.tri(key, [cx, y1, cz], [x1, y1, z1], [x0, y1, z0], [0, 0, 0, 0, 0, 0], color);
    }
  }

  // Agrega una geometría de Three.js transformada por una matriz (para formas orgánicas).
  addGeometry(key, geometry, matrix, colorFn) {
    const B = this.bucket(key);
    const base = B.p.length / 3;
    const pos = geometry.getAttribute('position');
    const nor = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      B.p.push(v.x, v.y, v.z);
      v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      B.n.push(v.x, v.y, v.z);
      if (uv) B.u.push(uv.getX(i), uv.getY(i)); else B.u.push(0, 0);
      _c.set(colorFn ? colorFn(i) : 0xffffff);
      B.c.push(_c.r, _c.g, _c.b);
    }
    if (geometry.index) {
      const idx = geometry.index.array;
      for (let i = 0; i < idx.length; i++) B.i.push(base + idx[i]);
    } else {
      for (let i = 0; i < pos.count; i++) B.i.push(base + i);
    }
  }

  isEmpty() {
    return this.buckets.size === 0;
  }

  // Devuelve geometrías por material (para InstancedMesh de props).
  toGeometries() {
    const out = new Map();
    for (const [key, B] of this.buckets) {
      if (!B.i.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(B.u, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
      g.setIndex(B.i);
      g.computeBoundingSphere();
      out.set(key, g);
    }
    this.buckets.clear();
    return out;
  }

  // Crea una malla por material.
  build(group, { castShadow = false, receiveShadow = true } = {}) {
    const meshes = [];
    for (const [key, B] of this.buckets) {
      if (!B.i.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(B.u, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
      g.setIndex(B.i);
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const m = new THREE.Mesh(g, this.materials.get(key));
      m.castShadow = castShadow;
      m.receiveShadow = receiveShadow;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      group.add(m);
      meshes.push(m);
    }
    this.buckets.clear();
    return meshes;
  }
}
