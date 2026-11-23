import * as THREE from 'three';

// ============================================================================
// Conductor guionado: sigue una polilínea (ruta del GPS, circuito de carrera,
// recorrido de un blindado...) con pure pursuit y frena antes de las curvas.
// Lo usan la policía y las misiones.
// ============================================================================

export class ScriptedDriver {
  constructor(vehicle, points, opts = {}) {
    this.v = vehicle;
    this.maxSpeed = opts.maxSpeed ?? 18;
    this.offset = opts.offset ?? 0; // desplazamiento lateral a la derecha (carril)
    this.loop = !!opts.loop;
    this.avoid = opts.avoid ?? true;
    this.cornerFactor = opts.cornerFactor ?? 1;
    this.laneFn = opts.laneFn || null; // carril según el tipo de calle de cada tramo
    this.setPath(points);
    this.done = false;
    this.stuck = 0;
    this.reverseT = 0;
    this.paused = false;
    vehicle.driver = vehicle.driver || 'script';
    vehicle.sleeping = false;
    this._t = new THREE.Vector3();
  }

  setPath(points) {
    // desplaza la ruta a la derecha del sentido de marcha (mano derecha)
    const pts = points.map((p) => p.clone());
    if (this.laneFn && points.length > 1) {
      // cada punto se mueve a la derecha de los tramos que lo tocan (esquinas = cruce de carriles)
      const segs = [];
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        let dx = b.x - a.x, dz = b.z - a.z;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        segs.push({ rx: -dz, rz: dx, off: this.laneFn(a, b) });
      }
      for (let i = 0; i < pts.length; i++) {
        const s1 = segs[Math.max(0, i - 1)], s2 = segs[Math.min(segs.length - 1, i)];
        if (s1 === s2 || Math.abs(s1.rx * s2.rx + s1.rz * s2.rz) > 0.95) {
          pts[i].x += s2.rx * s2.off; pts[i].z += s2.rz * s2.off;
        } else {
          pts[i].x += s1.rx * s1.off + s2.rx * s2.off;
          pts[i].z += s1.rz * s1.off + s2.rz * s2.off;
        }
      }
    } else if (this.offset) {
      for (let i = 0; i < pts.length; i++) {
        const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
        let dx = b.x - a.x, dz = b.z - a.z;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        // derecha de (dx,dz) = (-dz, dx)
        pts[i].x += -dz * this.offset;
        pts[i].z += dx * this.offset;
      }
    }
    this.pts = pts;
    this.idx = 0;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    this.total = this.cum[this.cum.length - 1];
    this.done = false;
  }

  // progreso (metros recorridos sobre la ruta)
  get progress() {
    const i = Math.min(this.idx, this.pts.length - 2);
    const a = this.pts[i], b = this.pts[i + 1];
    const seg = a.distanceTo(b) || 1;
    const t = THREE.MathUtils.clamp(((this.v.pos.x - a.x) * (b.x - a.x) + (this.v.pos.z - a.z) * (b.z - a.z)) / (seg * seg), 0, 1);
    return this.cum[i] + t * seg;
  }

  // rumbo del tramo de la ruta en una distancia dada
  dirAt(dist) {
    if (this.loop) dist = ((dist % this.total) + this.total) % this.total;
    dist = THREE.MathUtils.clamp(dist, 0, this.total - 0.01);
    let i = 0;
    while (i < this.cum.length - 2 && this.cum[i + 1] < dist) i++;
    const a = this.pts[i], b = this.pts[i + 1];
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  pointAt(dist, out) {
    if (dist >= this.total) {
      if (this.loop) dist %= this.total;
      else return out.copy(this.pts[this.pts.length - 1]);
    }
    let i = 0;
    while (i < this.cum.length - 2 && this.cum[i + 1] < dist) i++;
    const seg = this.cum[i + 1] - this.cum[i] || 1;
    return out.copy(this.pts[i]).lerp(this.pts[i + 1], (dist - this.cum[i]) / seg);
  }

  update(dt, others = []) {
    const v = this.v, c = v.controls;
    if (v.dead || this.paused) {
      c.throttle = 0; c.hold = true; c.steer = 0;
      return;
    }
    // avanzar índice de segmento
    while (this.idx < this.pts.length - 2) {
      const b = this.pts[this.idx + 1];
      const a = this.pts[this.idx];
      const along = (v.pos.x - a.x) * (b.x - a.x) + (v.pos.z - a.z) * (b.z - a.z);
      if (along >= (b.x - a.x) ** 2 + (b.z - a.z) ** 2) this.idx++;
      else break;
    }
    const prog = this.progress;
    if (!this.loop && this.total - prog < 3) {
      this.done = true;
      c.throttle = 0; c.hold = true; c.steer = 0;
      return;
    }
    if (this.loop && this.total - prog < 4) this.idx = 0;
    const speed = Math.max(0, v.forwardSpeed);
    const look = 5 + speed * 0.5;
    const target = this.pointAt(prog + look, this._t);
    const loc = v.toLocal(target.x, target.z);
    const alpha = Math.atan2(loc.x, Math.max(0.1, loc.z));
    const delta = Math.atan((2 * v.T.wheelbase * Math.sin(alpha)) / look);
    const limit = v.T.steerMax / (1 + Math.abs(v.forwardSpeed) / 20);
    c.steer = THREE.MathUtils.clamp(delta / limit, -1, 1);

    // velocidad: anticipar curvas. Para cada curva adelante se calcula la
    // velocidad máxima para tomarla y se frena a tiempo (v² = vc² + 2·a·d).
    let vT = this.maxSpeed;
    const horizon = Math.min(90, 15 + speed * speed / 6);
    const here = this.dirAt(prog);
    for (let s = 4; s <= horizon; s += 4) {
      const d = this.dirAt(prog + s);
      const ang = Math.abs(Math.atan2(Math.sin(d - here), Math.cos(d - here)));
      if (ang < 0.3) continue;
      const vc = Math.max(6.5, 24 - ang * 11 * this.cornerFactor);
      vT = Math.min(vT, Math.sqrt(vc * vc + 2 * 4.5 * Math.max(0, s - 6)));
    }
    if (Math.abs(alpha) > 0.6) vT = Math.min(vT, 8);
    if (!this.loop) vT = Math.min(vT, 4 + (this.total - prog) * 0.6);
    // obstáculos adelante
    if (this.avoid) {
      for (const o of others) {
        if (o === v) continue;
        const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
        if (dx * dx + dz * dz > 900) continue;
        const l = v.toLocal(o.pos.x, o.pos.z);
        if (l.z > 0 && Math.abs(l.x) < 1.1 + o.hw) vT = Math.min(vT, Math.max(0, (l.z - v.hl - o.hl - 2.5) * 0.9 + Math.max(0, o.forwardSpeed)));
      }
    }
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      c.hold = false; c.throttle = 0; c.brake = 0.7; c.steer = -c.steer;
      return;
    }
    const err = vT - v.forwardSpeed;
    if (vT < 0.4 && v.forwardSpeed < 1) { c.hold = true; c.throttle = 0; c.brake = 0; }
    else if (err > 0) { c.hold = false; c.brake = 0; c.throttle = THREE.MathUtils.clamp(err * 0.4, 0.2, 1); }
    else { c.throttle = 0; c.brake = 0; c.hold = err < -1.5; }
    // atascado contra algo: marcha atrás un momento
    if (v.speed < 0.6 && vT > 3) {
      this.stuck += dt;
      if (this.stuck > 1.6) { this.reverseT = 1.1; this.stuck = 0; }
    } else this.stuck = 0;
  }
}
