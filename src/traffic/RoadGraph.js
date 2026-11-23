import * as THREE from 'three';
import { CURB } from '../world/CityLayout.js';

// ============================================================================
// Red vial para la IA: carriles (con sentido, mano derecha), conectores de
// giro dentro de cada intersección y ciclo de semáforos por intersección.
// ============================================================================

// Ciclo: verde N-S, amarillo N-S, todo rojo, verde E-O, amarillo E-O, todo rojo
const GREEN = 13, YELLOW = 3, ALLRED = 1.5;
const CYCLE = (GREEN + YELLOW + ALLRED) * 2;

export class RoadGraph {
  constructor(layout) {
    this.L = layout;
    this.lanes = [];
    this.byEnd = new Map(); // intersección -> carriles entrantes
    this.intersections = new Map();
    this.time = 0;
    for (const it of layout.intersections) {
      this.intersections.set(it.id, { ...it, offset: ((it.ix * 7 + it.iz * 3) % 10) * 3.1 });
    }
    this.buildLanes();
    this.buildConnectors();
  }

  buildLanes() {
    for (const r of this.L.roads) {
      const spec = r.spec;
      const hm = spec.median / 2;
      // índice de línea para saber qué intersecciones une
      for (const dir of [1, -1]) {
        for (let k = 0; k < spec.lanesPerDir; k++) {
          // mano derecha: eje x (N-S): +t va al norte (-z); eje z (E-O): +t va al este (+x)
          const sideT = (hm + (k + 0.5) * spec.laneWidth);
          let t, sFrom, sTo;
          if (r.axis === 'x') {
            t = dir > 0 ? sideT : -sideT; // dir>0: hacia el norte
            sFrom = dir > 0 ? r.to : r.from; sTo = dir > 0 ? r.from : r.to;
          } else {
            t = dir > 0 ? sideT : -sideT; // dir>0: hacia el este
            sFrom = dir > 0 ? r.from : r.to; sTo = dir > 0 ? r.to : r.from;
          }
          const P = (s) => (r.axis === 'x' ? new THREE.Vector3(r.pos + t, CURB * 0, s) : new THREE.Vector3(s, 0, r.pos + t));
          const a = P(sFrom), b = P(sTo);
          const lane = {
            id: this.lanes.length, road: r, axis: r.axis, k, lanes: spec.lanesPerDir,
            a, b, len: a.distanceTo(b), dir: new THREE.Vector3().subVectors(b, a).normalize(),
            speed: spec.speed, next: [],
          };
          lane.heading = Math.atan2(lane.dir.x, lane.dir.z);
          lane.endIntersection = this.intersectionNear(b);
          lane.startIntersection = this.intersectionNear(a);
          this.lanes.push(lane);
          if (lane.endIntersection) {
            const list = this.byEnd.get(lane.endIntersection.id) || [];
            list.push(lane);
            this.byEnd.set(lane.endIntersection.id, list);
          }
        }
      }
    }
  }

  intersectionNear(p) {
    let best = null, bd = Infinity;
    for (const it of this.intersections.values()) {
      const d = Math.abs(it.x - p.x) + Math.abs(it.z - p.z);
      if (d < bd) { bd = d; best = it; }
    }
    return bd < 30 ? best : null;
  }

  // Conectores: de cada carril entrante a los salientes (recto, derecha, izquierda)
  buildConnectors() {
    for (const lane of this.lanes) {
      const it = lane.endIntersection;
      if (!it) continue;
      const outs = this.lanes.filter((o) => o.startIntersection === it && o.road !== lane.road);
      for (const o of outs) {
        const cross = lane.dir.x * o.dir.z - lane.dir.z * o.dir.x; // >0: gira a la izquierda (rumbo crece)
        const dot = lane.dir.dot(o.dir);
        let turn;
        if (dot > 0.9) turn = 'straight';
        else if (dot < -0.9) continue; // sin vueltas en U
        else turn = cross < 0 ? 'left' : 'right';
        // rumbo: h = atan2(x,z). Girar a la izquierda aumenta h; cross(x,z) definido así es negativo para izquierda
        if (turn === 'straight' && o.k !== Math.min(lane.k, o.lanes - 1)) continue;
        if (turn === 'right' && (lane.k !== lane.lanes - 1 || o.k !== o.lanes - 1)) continue;
        if (turn === 'left' && (lane.k !== 0 || o.k !== 0)) continue;
        const p0 = lane.b, p2 = o.a;
        let ctrl;
        if (turn === 'straight') ctrl = p0.clone().lerp(p2, 0.5);
        else {
          // punto de control en la intersección de ambas rectas
          ctrl = lineIntersect(p0, lane.dir, p2, o.dir) || p0.clone().lerp(p2, 0.5);
        }
        const pts = [];
        for (let i = 0; i <= 8; i++) {
          const t = i / 8;
          pts.push(new THREE.Vector3(
            (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * ctrl.x + t * t * p2.x, 0,
            (1 - t) * (1 - t) * p0.z + 2 * (1 - t) * t * ctrl.z + t * t * p2.z,
          ));
        }
        let len = 0;
        for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
        lane.next.push({ to: o, pts, len, turn });
      }
    }
  }

  update(dt) {
    this.time += dt;
  }

  // Estado del semáforo para un eje ('x' = calles N-S, 'z' = calles E-O)
  signal(itId, axis) {
    const it = this.intersections.get(itId);
    if (!it) return 'green';
    let t = (this.time + it.offset) % CYCLE;
    const first = axis === 'x';
    if (!first) t = (t + CYCLE / 2) % CYCLE;
    if (t < GREEN) return 'green';
    if (t < GREEN + YELLOW) return 'yellow';
    return 'red';
  }

  // Punto y rumbo a una distancia d sobre un carril
  pointOnLane(lane, d, out = new THREE.Vector3()) {
    return out.copy(lane.a).addScaledVector(lane.dir, THREE.MathUtils.clamp(d, 0, lane.len));
  }

  randomLane(rnd) {
    return this.lanes[Math.floor(rnd() * this.lanes.length)];
  }
}

function lineIntersect(p, d, q, e) {
  const den = d.x * e.z - d.z * e.x;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((q.x - p.x) * e.z - (q.z - p.z) * e.x) / den;
  return new THREE.Vector3(p.x + d.x * t, 0, p.z + d.z * t);
}
