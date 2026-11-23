import * as THREE from 'three';
import { GRID } from '../world/CityLayout.js';

// ============================================================================
// Navegación: rutas por la grilla de calles (A*) para el GPS, la policía y
// los autos de las misiones. Prefiere avenidas y autopistas (más rápidas).
// ============================================================================

export class RouteFinder {
  constructor(layout) {
    this.L = layout;
    this.n = GRID.blocks + 1;
    this.xs = layout.lines.x.map((l) => l.pos);
    this.zs = layout.lines.z.map((l) => l.pos);
    this.speedX = layout.lines.x.map((l) => l.speed);
    this.speedZ = layout.lines.z.map((l) => l.speed);
  }

  // Desplazamiento lateral (a la derecha) del primer carril de la calle entre a y b.
  laneOffset = (a, b) => {
    const vertical = Math.abs(a.x - b.x) < 1.5 && Math.abs(a.z - b.z) > 1;
    const horizontal = Math.abs(a.z - b.z) < 1.5 && Math.abs(a.x - b.x) > 1;
    let line = null;
    if (vertical) line = this.L.lines.x.find((l) => Math.abs(l.pos - a.x) < 1.5);
    else if (horizontal) line = this.L.lines.z.find((l) => Math.abs(l.pos - a.z) < 1.5);
    if (!line) return 1.75;
    return line.median / 2 + line.laneWidth / 2;
  };

  nearestNode(x, z) {
    let bi = 0, bj = 0, bd = Infinity;
    for (let i = 0; i < this.n; i++) for (let j = 0; j < this.n; j++) {
      const d = Math.abs(this.xs[i] - x) + Math.abs(this.zs[j] - z);
      if (d < bd) { bd = d; bi = i; bj = j; }
    }
    return [bi, bj];
  }

  // punto más cercano sobre alguna calle (para entrar/salir de la grilla)
  snapToRoad(x, z) {
    let best = null, bd = Infinity;
    for (let i = 0; i < this.n; i++) {
      const cz = THREE.MathUtils.clamp(z, this.zs[0], this.zs[this.n - 1]);
      const d = Math.abs(this.xs[i] - x) + Math.abs(cz - z);
      if (d < bd) { bd = d; best = new THREE.Vector3(this.xs[i], 0, cz); }
    }
    for (let j = 0; j < this.n; j++) {
      const cx = THREE.MathUtils.clamp(x, this.xs[0], this.xs[this.n - 1]);
      const d = Math.abs(this.zs[j] - z) + Math.abs(cx - x);
      if (d < bd) { bd = d; best = new THREE.Vector3(cx, 0, this.zs[j]); }
    }
    return best;
  }

  // Tramo de calle donde está un punto (ya ajustado a la calle): sus dos esquinas.
  segmentOf(p) {
    const n = this.n;
    const idx = (arr, v) => {
      for (let k = 0; k < n - 1; k++) if (v >= arr[k] - 0.01 && v <= arr[k + 1] + 0.01) return k;
      return v < arr[0] ? 0 : n - 2;
    };
    const ix = this.xs.findIndex((x) => Math.abs(x - p.x) < 0.6);
    if (ix >= 0) {
      const j = idx(this.zs, p.z);
      return { nodes: [[ix, j], [ix, j + 1]], speed: this.speedX[ix], key: `x${ix}_${j}` };
    }
    const jz = this.zs.findIndex((z) => Math.abs(z - p.z) < 0.6);
    const i = idx(this.xs, p.x);
    return { nodes: [[i, jz < 0 ? 0 : jz], [i + 1, jz < 0 ? 0 : jz]], speed: this.speedZ[Math.max(0, jz)], key: `z${jz}_${i}` };
  }

  nodePos(i, j) {
    return new THREE.Vector3(this.xs[i], 0, this.zs[j]);
  }

  // Devuelve una polilínea (Vector3[]) desde "from" hasta "to" siguiendo calles.
  // Sale del tramo actual hacia la esquina que más conviene (sin ir para atrás).
  route(from, to) {
    const a = this.snapToRoad(from.x, from.z), b = this.snapToRoad(to.x, to.z);
    const start = [new THREE.Vector3(from.x, 0, from.z), a];
    const end = [b, new THREE.Vector3(to.x, 0, to.z)];
    const sa = this.segmentOf(a), sb = this.segmentOf(b);
    if (sa.key === sb.key) return simplify([...start, ...end]);
    const n = this.n, N = n * n;
    const dist = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const done = new Uint8Array(N);
    const id = (i, j) => i * n + j;
    for (const [i, j] of sa.nodes) dist[id(i, j)] = Math.min(dist[id(i, j)], a.distanceTo(this.nodePos(i, j)) / sa.speed);
    // Dijkstra (121 nodos: trivial)
    for (;;) {
      let u = -1, best = Infinity;
      for (let k = 0; k < N; k++) if (!done[k] && dist[k] < best) { best = dist[k]; u = k; }
      if (u < 0) break;
      done[u] = 1;
      const i = Math.floor(u / n), j = u % n;
      const nbrs = [[i + 1, j, this.speedZ[j]], [i - 1, j, this.speedZ[j]], [i, j + 1, this.speedX[i]], [i, j - 1, this.speedX[i]]];
      for (const [ni, nj, sp] of nbrs) {
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const v = id(ni, nj);
        const len = Math.abs(this.xs[ni] - this.xs[i]) + Math.abs(this.zs[nj] - this.zs[j]);
        const c = dist[u] + len / sp + 0.6;
        if (c < dist[v]) { dist[v] = c; prev[v] = u; }
      }
    }
    let goal = -1, bestTotal = Infinity;
    for (const [i, j] of sb.nodes) {
      const t = dist[id(i, j)] + this.nodePos(i, j).distanceTo(b) / sb.speed;
      if (t < bestTotal) { bestTotal = t; goal = id(i, j); }
    }
    const nodes = [];
    for (let u = goal; u >= 0; u = prev[u]) nodes.push(this.nodePos(Math.floor(u / n), u % n));
    nodes.reverse();
    return simplify([...start, ...nodes, ...end]);
  }
}

function simplify(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) if (pts[i].distanceTo(out[out.length - 1]) > 0.5) out.push(pts[i]);
  return out;
}

// ============================================================================
// Marcadores 3D: columnas de luz para objetivos y puntos de inicio de misión.
// ============================================================================
export class MarkerSystem {
  constructor(scene) {
    this.scene = scene;
    this.markers = new Set();
    const c = document.createElement('canvas');
    c.width = 4; c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0.9)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 128);
    this.tex = new THREE.CanvasTexture(c);
    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0);
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2);
    this.time = 0;
  }

  // opts: { color, radius, height, label }
  add(x, y, z, opts = {}) {
    const color = new THREE.Color(opts.color ?? 0xffd166);
    const r = opts.radius ?? 1.6, h = opts.height ?? 7;
    const group = new THREE.Group();
    const beam = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ map: this.tex, color, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
    beam.scale.set(r, h, r);
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    ring.scale.setScalar(r);
    ring.position.y = 0.08;
    group.add(beam, ring);
    group.position.set(x, y, z);
    group.renderOrder = 4;
    this.scene.add(group);
    const m = { x, y, z, r, group, beam, ring, color: '#' + color.getHexString(), label: opts.label || '', icon: opts.icon || null };
    this.markers.add(m);
    return m;
  }

  remove(m) {
    if (!m || !this.markers.has(m)) return;
    this.markers.delete(m);
    this.scene.remove(m.group);
    m.beam.material.dispose();
    m.ring.material.dispose();
  }

  move(m, x, y, z) {
    m.x = x; m.y = y; m.z = z;
    m.group.position.set(x, y, z);
  }

  update(dt) {
    this.time += dt;
    const s = 1 + Math.sin(this.time * 3) * 0.06;
    for (const m of this.markers) {
      m.ring.scale.setScalar(m.r * s);
      m.beam.material.opacity = 0.75 + Math.sin(this.time * 2) * 0.15;
    }
  }

  inside(m, p, extra = 0) {
    return Math.hypot(p.x - m.x, p.z - m.z) < m.r + extra && Math.abs(p.y - m.y) < 4;
  }
}
