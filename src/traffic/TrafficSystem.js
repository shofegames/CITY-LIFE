import * as THREE from 'three';
import { VEHICLE_TYPES, pickTrafficType } from '../vehicles/VehicleTypes.js';
import { bus } from '../core/EventBus.js';

// ============================================================================
// Traffic System: autos manejados por IA sobre la red de carriles.
// - Siguen su carril (pure pursuit) y eligen giros en cada esquina
// - Respetan semáforos (frenan antes de la línea de detención)
// - Mantienen distancia con el auto de adelante y con peatones
// - Tocan bocina si el jugador los bloquea
// - Aparecen fuera de la vista del jugador y desaparecen lejos (pool)
// ============================================================================

const SPAWN_MIN = 70, SPAWN_MAX = 190, DESPAWN = 240;

export class TrafficSystem {
  constructor(graph, vehicles, settings) {
    this.graph = graph;
    this.vs = vehicles;
    this.settings = settings;
    this.agents = new Map(); // vehicle -> estado IA
    this.spawnTimer = 0;
    this._p = new THREE.Vector3();
    this._frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
    bus.on('vehicle:removed', (v) => this.agents.delete(v));
  }

  get maxCars() {
    return Math.round(26 * this.settings.preset.trafficDensity);
  }

  // ---------------------------------------------------------------- aparición
  manage(dt, playerPos, camera) {
    this.spawnTimer -= dt;
    // eliminar lejanos
    for (const [v, ag] of this.agents) {
      const d = Math.hypot(v.pos.x - playerPos.x, v.pos.z - playerPos.z);
      if (d > DESPAWN || (ag.stuck > 12 && d > 40)) this.vs.remove(v);
    }
    if (this.spawnTimer > 0 || this.agents.size >= this.maxCars) return;
    this.spawnTimer = 0.35;
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._m);
    for (let tries = 0; tries < 8; tries++) {
      const lane = this.graph.randomLane(Math.random);
      const d = 12 + Math.random() * Math.max(1, lane.len - 30);
      const p = this.graph.pointOnLane(lane, d, this._p);
      const dist = Math.hypot(p.x - playerPos.x, p.z - playerPos.z);
      if (dist < SPAWN_MIN || dist > SPAWN_MAX) continue;
      p.y = 1;
      if (dist < 140 && this._frustum.containsPoint(p)) continue;
      if (this.vs.vehicles.some((v) => Math.abs(v.pos.x - p.x) < 12 && Math.abs(v.pos.z - p.z) < 12)) continue;
      const type = pickTrafficType(Math.random);
      const palette = VEHICLE_TYPES[type].palette;
      const v = this.vs.spawn(type, palette[Math.floor(Math.random() * palette.length)], p.x, p.z, lane.heading, { kind: 'traffic', awake: true });
      if (!v) return;
      v.driver = 'ai';
      const ag = {
        lane, conn: null, connIdx: 0, next: null, d,
        personality: 0.82 + Math.random() * 0.28, stuck: 0, honk: 0, blockedByPlayer: 0, reverseT: 0,
      };
      ag.next = this.pickNext(lane);
      const sp = lane.speed * ag.personality * 0.7;
      v.vx = Math.sin(lane.heading) * sp;
      v.vz = Math.cos(lane.heading) * sp;
      this.agents.set(v, ag);
      return;
    }
  }

  pickNext(lane) {
    const opts = lane.next;
    if (!opts.length) return null;
    const w = opts.map((o) => (o.turn === 'straight' ? 0.55 : o.turn === 'right' ? 0.25 : 0.2));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < opts.length; i++) {
      r -= w[i];
      if (r <= 0) return opts[i];
    }
    return opts[0];
  }

  // Cuando el jugador roba el auto, la IA lo suelta.
  release(v) {
    this.agents.delete(v);
    v.kind = 'free';
    v.controls.hold = false;
  }

  // ---------------------------------------------------------------- conducción
  fixedUpdate(dt, playerPos, playerVehicle, playerOnFoot, pedsOnRoad = []) {
    this.graph.update(dt);
    for (const [v, ag] of this.agents) this.drive(v, ag, dt, playerPos, playerVehicle, playerOnFoot, pedsOnRoad);
  }

  drive(v, ag, dt, playerPos, playerVehicle, playerOnFoot, pedsOnRoad) {
    const ctl = v.controls;
    if (v.dead) {
      ctl.throttle = 0; ctl.hold = true; ctl.steer = 0;
      return;
    }
    const f = v.forward;
    // ---- progreso sobre el camino ----
    let remaining; // metros hasta el final del carril actual (o del conector)
    if (!ag.conn) {
      ag.d = (v.pos.x - ag.lane.a.x) * ag.lane.dir.x + (v.pos.z - ag.lane.a.z) * ag.lane.dir.z;
      remaining = ag.lane.len - ag.d;
      if (remaining < 0.8) {
        if (!ag.next) { ag.stuck = 99; return; }
        ag.conn = ag.next;
        ag.connIdx = 0;
      }
    }
    if (ag.conn) {
      const pts = ag.conn.pts;
      while (ag.connIdx < pts.length - 1 && dist2(v.pos, pts[ag.connIdx + 1]) < dist2(v.pos, pts[ag.connIdx])) ag.connIdx++;
      const end = pts[pts.length - 1];
      if (ag.connIdx >= pts.length - 2 && dist2(v.pos, end) < 9) {
        ag.lane = ag.conn.to;
        ag.conn = null;
        ag.next = this.pickNext(ag.lane);
        ag.d = 0;
      }
      remaining = ag.lane.len;
    }

    // ---- punto objetivo (pure pursuit) ----
    const speed = Math.max(0, v.forwardSpeed);
    const look = 5 + speed * 0.55;
    const target = this.lookAhead(ag, v, look);
    const loc = v.toLocal(target.x, target.z);
    const alpha = Math.atan2(loc.x, Math.max(0.1, loc.z));
    const delta = Math.atan((2 * v.T.wheelbase * Math.sin(alpha)) / look);
    const limit = v.T.steerMax / (1 + Math.abs(v.forwardSpeed) / 20);
    ctl.steer = THREE.MathUtils.clamp(delta / limit, -1, 1);

    // ---- velocidad deseada ----
    let vT = (ag.conn ? (ag.conn.turn === 'straight' ? ag.lane.speed : 6.5) : ag.lane.speed) * ag.personality;
    let waitingLight = false;
    if (!ag.conn) {
      const toEnd = ag.lane.len - ag.d;
      if (ag.next && ag.next.turn !== 'straight') vT = Math.min(vT, 6.5 + Math.max(0, toEnd - 6) * 0.45);
      // semáforo
      const it = ag.lane.endIntersection;
      if (it) {
        const sig = this.graph.signal(it.id, ag.lane.axis);
        const toStop = toEnd - 5.2;
        const brakeDist = (speed * speed) / (2 * 4.5);
        if ((sig === 'red' || (sig === 'yellow' && toStop > brakeDist * 0.8)) && toStop > -0.5) {
          vT = Math.min(vT, Math.sqrt(Math.max(0, 2 * 3.2 * (toStop - 0.3))));
          waitingLight = toStop < 12;
        }
      }
    }
    // obstáculos: otros autos y el jugador a pie
    let blocked = false;
    let gapMin = Infinity;
    for (const o of this.vs.vehicles) {
      if (o === v) continue;
      const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
      if (dx * dx + dz * dz > 40 * 40) continue;
      const l = v.toLocal(o.pos.x, o.pos.z);
      if (l.z <= 0) continue;
      const lateral = Math.abs(l.x - ctl.steer * l.z * 0.25);
      if (lateral > 1.2 + o.hw) continue;
      const gap = l.z - v.hl - o.hl;
      if (gap < gapMin) {
        gapMin = gap;
        if (o === playerVehicle) blocked = true;
        else blocked = false;
      }
    }
    if (playerOnFoot) {
      const l = v.toLocal(playerPos.x, playerPos.z);
      if (l.z > 0 && Math.abs(l.x) < 1.8 && Math.abs(playerPos.y - v.pos.y) < 2) {
        const gap = l.z - v.hl - 0.4;
        if (gap < gapMin) { gapMin = gap; blocked = true; }
      }
    }
    // peatones cruzando o corriendo por la calle
    for (const p of pedsOnRoad) {
      const dx = p.pos.x - v.pos.x, dz = p.pos.z - v.pos.z;
      if (dx * dx + dz * dz > 30 * 30) continue;
      const l = v.toLocal(p.pos.x, p.pos.z);
      if (l.z > 0 && Math.abs(l.x) < 2.2) {
        const gap = l.z - v.hl - 0.4;
        if (gap < gapMin) { gapMin = gap; blocked = false; }
      }
    }
    if (gapMin < Infinity) vT = Math.min(vT, Math.max(0, (gapMin - 3) * 0.75));
    // patrullero con sirena cerca: frenar y abrirse a la derecha
    for (const o of this.vs.vehicles) {
      if (!o.siren || o === v) continue;
      const l = v.toLocal(o.pos.x, o.pos.z);
      if (l.z < 0 && l.z > -40 && Math.abs(l.x) < 6) {
        vT = Math.min(vT, 3);
        ctl.steer = THREE.MathUtils.clamp(ctl.steer - 0.25, -1, 1);
      }
    }

    // ---- acelerador / freno ----
    const err = vT - v.forwardSpeed;
    ctl.handbrake = false;
    if (ag.reverseT > 0) {
      ag.reverseT -= dt;
      ctl.hold = false; ctl.throttle = 0; ctl.brake = 0.6; ctl.steer = -ctl.steer;
      return;
    }
    if (vT < 0.4 && v.forwardSpeed < 1) {
      ctl.hold = true; ctl.throttle = 0; ctl.brake = 0;
    } else if (err > 0) {
      ctl.hold = false; ctl.brake = 0; ctl.throttle = THREE.MathUtils.clamp(err * 0.45, 0.15, 1);
    } else {
      ctl.throttle = 0;
      ctl.hold = err < -0.6;
      ctl.brake = 0;
    }

    // ---- bocina y atascos ----
    if (blocked && v.forwardSpeed < 1) {
      ag.blockedByPlayer += dt;
      ag.honk -= dt;
      if (ag.blockedByPlayer > 2.2 && ag.honk <= 0) {
        ag.honk = 2.5 + Math.random() * 2;
        bus.emit('vehicle:horn', { x: v.pos.x, z: v.pos.z, ai: true });
      }
    } else ag.blockedByPlayer = 0;
    if (v.speed < 0.3 && !waitingLight && vT > 2) {
      ag.stuck += dt;
      if (ag.stuck > 5 && ag.reverseT <= 0 && Math.random() < 0.02) ag.reverseT = 1.4;
    } else ag.stuck = Math.max(0, ag.stuck - dt * 2);
  }

  lookAhead(ag, v, dist) {
    const out = this._p;
    if (!ag.conn) {
      const d = ag.d + dist;
      if (d <= ag.lane.len || !ag.next) return this.graph.pointOnLane(ag.lane, d, out);
      return walk(ag.next.pts, 0, d - ag.lane.len, out, ag.next.to);
    }
    return walk(ag.conn.pts, ag.connIdx, dist, out, ag.conn.to);
  }
}

function dist2(p, q) {
  return (p.x - q.x) ** 2 + (p.z - q.z) ** 2;
}

// avanza "dist" metros sobre una polilínea (y sigue por el carril siguiente)
function walk(pts, i0, dist, out, nextLane) {
  let left = dist;
  for (let i = i0; i < pts.length - 1; i++) {
    const seg = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
    if (left <= seg) {
      const t = left / seg;
      return out.set(pts[i].x + (pts[i + 1].x - pts[i].x) * t, 0, pts[i].z + (pts[i + 1].z - pts[i].z) * t);
    }
    left -= seg;
  }
  return out.copy(nextLane.a).addScaledVector(nextLane.dir, Math.min(left, nextLane.len));
}
