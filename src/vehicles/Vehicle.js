import * as THREE from 'three';
import { VEHICLE_TYPES } from './VehicleTypes.js';
import { getTemplate } from './VehicleModel.js';
import { bus } from '../core/EventBus.js';

// ============================================================================
// Vehicle: física de manejo tipo "modelo de bicicleta" con neumáticos.
// - Ángulo de deriva en cada eje → fuerza lateral con saturación (agarre μ·N)
// - Transferencia de peso al acelerar/frenar (sobreviraje al soltar, etc.)
// - Motor limitado por potencia (P = F·v) y por tracción del eje motriz
// - Resistencia aerodinámica (define la velocidad máxima) y de rodadura
// - Freno de mano: bloquea y le quita agarre al eje trasero (derrapes)
// - Superficies: asfalto, vereda, pasto, arena...
// - Colisiones caja orientada (OBB) contra la ciudad y entre autos, con
//   impulsos, giro por impacto, daño y abolladuras visibles.
// Convención: rumbo h; adelante f = (sin h, cos h); izquierda s = (cos h, -sin h).
// ============================================================================

const G = 9.81;
const WHEELS = [[1, 1, true], [1, -1, true], [-1, 1, false], [-1, -1, false]];

export class Vehicle {
  constructor(typeId, color, materials) {
    this.typeId = typeId;
    this.T = VEHICLE_TYPES[typeId];
    this.tpl = getTemplate(typeId);
    this.color = color;
    const { L, W, H } = this.tpl.dims;
    this.hl = L / 2; this.hw = W / 2; this.height = H;
    this.a = this.T.wheelbase / 2; this.b = this.T.wheelbase / 2;
    this.mass = this.T.mass;
    this.inertia = (this.mass * (L * L + W * W)) / 12;
    this.cd = this.T.power / Math.pow(this.T.vmax, 3);

    // estado físico
    this.pos = new THREE.Vector3();
    this.h = 0;
    this.vx = 0; this.vz = 0;
    this.vy = 0;
    this.omega = 0;
    this.steer = 0;
    this.longAcc = 0; this.latAcc = 0;
    this.controls = { throttle: 0, brake: 0, steer: 0, handbrake: false, hold: false };
    this.reverse = false;
    this.rpm = 900; this.gear = 1;
    this.slip = 0; // derrape (para humo y sonido)
    this.wheelspin = 0;
    this.damage = 0;
    this.dead = false;
    this.sleeping = true;
    this.driver = null; // 'player' | 'ai' | null
    this.wheelAngle = 0;
    this.pitch = 0; this.roll = 0; this.pitchV = 0; this.rollV = 0;
    this.groundPitch = 0; this.groundRoll = 0;
    this.lastCrash = 0;
    this.id = Vehicle.nextId++;

    this.buildVisual(materials);
  }

  buildVisual(materials) {
    const tpl = this.tpl;
    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';
    this.body = new THREE.Group();
    this.group.add(this.body);
    // carrocería propia (color + abolladuras)
    const geo = tpl.body.clone();
    geo.attributes.position = tpl.body.attributes.position.clone();
    geo.attributes.color = tpl.body.attributes.color.clone();
    this.geo = geo;
    this.paint(this.color);
    this.bodyMesh = new THREE.Mesh(geo, materials.body);
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.headMesh = new THREE.Mesh(tpl.head, materials.headOff);
    this.tailMesh = new THREE.Mesh(tpl.tail, materials.tailOff);
    this.interiorMesh = new THREE.Mesh(tpl.interior, materials.body);
    this.interiorMesh.visible = false;
    this.body.add(this.bodyMesh, this.headMesh, this.tailMesh, this.interiorMesh);
    if (tpl.barRed) {
      this.barRed = new THREE.Mesh(tpl.barRed, materials.barRedOff);
      this.barBlue = new THREE.Mesh(tpl.barBlue, materials.barBlueOff);
      this.body.add(this.barRed, this.barBlue);
    }
    this.siren = false;
    this.sirenT = 0;
    // charco de luz de faros (de noche)
    this.beam = new THREE.Mesh(materials.beamGeo, materials.beam);
    this.beam.position.set(0, 0.06, this.hl + 7);
    this.beam.visible = false;
    this.beam.renderOrder = 3;
    this.group.add(this.beam);
    this.materials = materials;
  }

  paint(color) {
    this.color = color;
    const col = this.geo.attributes.color, mask = this.geo.attributes.paint;
    const c = new THREE.Color(color);
    for (let i = 0; i < col.count; i++) {
      const m = mask.getX(i);
      if (m > 0) col.setXYZ(i, c.r * m, c.g * m, c.b * m);
    }
    col.needsUpdate = true;
  }

  // -------------------------------------------------------------- utilidades
  get forward() { return { x: Math.sin(this.h), z: Math.cos(this.h) }; }
  get left() { return { x: Math.cos(this.h), z: -Math.sin(this.h) }; }
  get speed() { return Math.hypot(this.vx, this.vz); }
  get forwardSpeed() { return this.vx * Math.sin(this.h) + this.vz * Math.cos(this.h); }
  get kmh() { return Math.round(Math.abs(this.forwardSpeed) * 3.6); }

  place(x, y, z, h) {
    this.pos.set(x, y, z);
    this.h = h;
    this.vx = this.vz = this.vy = this.omega = 0;
    this.steer = 0;
    this.syncVisual(0);
  }

  // punto local (x lateral izq., z adelante) a mundo
  toWorld(lx, lz) {
    const s = Math.sin(this.h), c = Math.cos(this.h);
    return { x: this.pos.x + c * lx + s * lz, z: this.pos.z - s * lx + c * lz };
  }

  toLocal(x, z) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const s = Math.sin(this.h), c = Math.cos(this.h);
    return { x: dx * c - dz * s, z: dx * s + dz * c };
  }

  corners() {
    const f = this.forward, l = this.left, hl = this.hl, hw = this.hw;
    const out = [];
    for (const [a, b] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
      out.push({ x: this.pos.x + f.x * hl * a + l.x * hw * b, z: this.pos.z + f.z * hl * a + l.z * hw * b });
    }
    return out;
  }

  // -------------------------------------------------------------- física
  step(dt, world, surfaces) {
    if (this.sleeping) return;
    const T = this.T, m = this.mass;
    const ctl = this.controls;
    const sh = Math.sin(this.h), ch = Math.cos(this.h);
    const fx = sh, fz = ch, lx = ch, lz = -sh;
    const vF = this.vx * fx + this.vz * fz;
    const speed = Math.hypot(this.vx, this.vz);
    const surf = surfaces.props(this.pos.x, this.pos.z);
    const dead = this.dead || this.damage >= 100;

    // ---- intención: acelerar / frenar / marcha atrás ----
    let drive = 0, brake = 0;
    if (!dead) {
      if (ctl.throttle > 0) {
        if (vF < -0.6) brake = ctl.throttle;
        else { drive = ctl.throttle; this.reverse = false; }
      }
      if (ctl.brake > 0) {
        if (vF > 0.6 && !this.reverse) brake = Math.max(brake, ctl.brake);
        else { this.reverse = true; drive = -ctl.brake * 0.55; }
      }
    } else brake = 0.15;
    // "hold": la IA frena sin pasar a marcha atrás
    if (ctl.hold) { drive = 0; brake = 1; this.reverse = false; }

    // ---- dirección (más suave a alta velocidad) ----
    const limit = T.steerMax / (1 + Math.abs(vF) / 20);
    const target = ctl.steer * limit;
    const rate = (Math.abs(target) < Math.abs(this.steer) ? 3.2 : 2.2) * dt;
    this.steer += THREE.MathUtils.clamp(target - this.steer, -rate, rate);

    // ---- cargas por eje (transferencia de peso) ----
    const N = m * G;
    const wb = this.a + this.b;
    let Nf = N * (this.b / wb) - (m * this.longAcc * 0.5) / wb;
    Nf = THREE.MathUtils.clamp(Nf, N * 0.2, N * 0.8);
    const Nr = N - Nf;
    const mu = T.grip * surf.grip * (dead ? 0.8 : 1) * (this.driver === 'player' ? Vehicle.wetGrip : 1);
    let muR = mu, muF = mu;
    if (ctl.handbrake) muR *= 0.42;

    // ---- fuerzas de tracción ----
    let Fdrive = 0;
    if (drive > 0) Fdrive = drive * Math.min(T.maxForce, T.power / Math.max(Math.abs(vF), 3));
    else if (drive < 0) Fdrive = vF > -8 ? drive * T.maxForce * 0.6 : 0;
    let FdF = 0, FdR = 0;
    if (T.drive === 'fwd') FdF = Fdrive; else if (T.drive === 'rwd') FdR = Fdrive; else { FdF = Fdrive * 0.4; FdR = Fdrive * 0.6; }
    // límite de tracción: si se excede, patina (y pierde agarre lateral)
    this.wheelspin = 0;
    const capF = muF * Nf * 0.95, capR = muR * Nr * 0.95;
    if (Math.abs(FdF) > capF) { this.wheelspin = Math.max(this.wheelspin, Math.abs(FdF) / capF - 1); FdF = Math.sign(FdF) * capF; muF *= 0.8; }
    if (Math.abs(FdR) > capR) { this.wheelspin = Math.max(this.wheelspin, Math.abs(FdR) / capR - 1); FdR = Math.sign(FdR) * capR; muR *= 0.75; }

    // ---- velocidad en cada eje ----
    const cs = Math.cos(this.steer), ss = Math.sin(this.steer);
    const wfx = fx * cs + lx * ss, wfz = fz * cs + lz * ss; // adelante rueda delantera
    const wsx = lx * cs - fx * ss, wsz = lz * cs - fz * ss; // lateral rueda delantera
    const vfx = this.vx + this.omega * this.a * lx, vfz = this.vz + this.omega * this.a * lz;
    const vrx = this.vx - this.omega * this.b * lx, vrz = this.vz - this.omega * this.b * lz;
    const fLong = vfx * wfx + vfz * wfz, fLat = vfx * wsx + vfz * wsz;
    const rLong = vrx * fx + vrz * fz, rLat = vrx * lx + vrz * lz;

    // ---- fuerzas laterales (deriva) con saturación y anti-oscilación ----
    const slipF = Math.atan2(fLat, Math.max(Math.abs(fLong), 0.6));
    const slipR = Math.atan2(rLat, Math.max(Math.abs(rLong), 0.6));
    const peak = 0.11;
    let FyF = THREE.MathUtils.clamp((-muF * Nf * slipF) / peak, -muF * Nf, muF * Nf);
    let FyR = THREE.MathUtils.clamp((-muR * Nr * slipR) / peak, -muR * Nr, muR * Nr);
    const capLatF = (m * 0.5 * Math.abs(fLat)) / dt, capLatR = (m * 0.5 * Math.abs(rLat)) / dt;
    FyF = THREE.MathUtils.clamp(FyF, -capLatF, capLatF);
    FyR = THREE.MathUtils.clamp(FyR, -capLatR, capLatR);

    // ---- frenos ----
    let FbF = 0, FbR = 0;
    if (brake > 0) {
      FbF = -Math.sign(fLong) * Math.min(T.brake * 0.62 * brake, muF * Nf, (m * 0.5 * Math.abs(fLong)) / dt);
      FbR = -Math.sign(rLong) * Math.min(T.brake * 0.38 * brake, muR * Nr, (m * 0.5 * Math.abs(rLong)) / dt);
    }
    if (ctl.handbrake) FbR += -Math.sign(rLong) * Math.min(T.brake * 0.5, muR * Nr, (m * 0.5 * Math.abs(rLong)) / dt);

    // ---- suma de fuerzas ----
    const FlF = FdF + FbF, FlR = FdR + FbR;
    let Fx = wfx * FlF + wsx * FyF + fx * FlR + lx * FyR;
    let Fz = wfz * FlF + wsz * FyF + fz * FlR + lz * FyR;
    // aerodinámica y rodadura
    Fx -= this.cd * speed * this.vx;
    Fz -= this.cd * speed * this.vz;
    if (speed > 0.05) {
      const roll = surf.roll * N * (dead ? 4 : 1);
      Fx -= (this.vx / speed) * roll;
      Fz -= (this.vz / speed) * roll;
    }
    const torque = this.a * (FyF * cs + FlF * ss) - this.b * FyR;

    this.vx += (Fx / m) * dt;
    this.vz += (Fz / m) * dt;
    this.omega += (torque / this.inertia) * dt;
    this.longAcc = (Fx * fx + Fz * fz) / m;
    this.latAcc = (Fx * lx + Fz * lz) / m;
    // amortiguación de giro y parada completa a muy baja velocidad
    this.omega *= 1 - Math.min(1, dt * (speed < 2 ? 3 : 0.4));
    if (speed < 0.25 && Math.abs(drive) < 0.01) {
      this.vx *= 0.85; this.vz *= 0.85; this.omega *= 0.85;
      if (speed < 0.05 && !this.driver) this.sleeping = Math.abs(this.omega) < 0.01;
    }

    this.h += this.omega * dt;
    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;

    // derrape para efectos
    this.slip = Math.max(Math.abs(rLat) - 2.2, 0) * 0.25 + (ctl.handbrake && speed > 4 ? 0.6 : 0) + this.wheelspin * 0.8;
    this.slip = Math.min(1.5, this.slip);

    // ---- motor (RPM y caja automática para el sonido) ----
    const ratios = [3.2, 2.1, 1.5, 1.15, 0.92, 0.75];
    const wheelRpm = (Math.abs(vF) / this.T.wheelR) * 9.55;
    let r = wheelRpm * ratios[this.gear - 1] * 3.6;
    if (r > 6300 && this.gear < ratios.length) this.gear++;
    else if (r < 2600 && this.gear > 1) this.gear--;
    r = wheelRpm * ratios[this.gear - 1] * 3.6;
    const idle = 850 + (Math.abs(drive) > 0 && Math.abs(vF) < 3 ? 2400 * Math.abs(drive) : 0);
    const targetRpm = Math.max(idle, Math.min(7000, r + this.wheelspin * 2500));
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 8);
    if (dead) this.rpm = 0;

    this.collideStatic(world.collision);
    this.followGround(dt, world.collision);
  }

  followGround(dt, col) {
    const f = this.forward, l = this.left;
    const ht = this.tpl.track / 2;
    const probe = (fa, la) => col.groundHeight(this.pos.x + f.x * fa + l.x * la, this.pos.z + f.z * fa + l.z * la, this.pos.y + 0.55, 0);
    const hFL = probe(this.a, ht), hFR = probe(this.a, -ht), hRL = probe(-this.b, ht), hRR = probe(-this.b, -ht);
    const avg = (hFL + hFR + hRL + hRR) / 4;
    if (this.pos.y > avg + 0.08) {
      this.vy -= G * dt;
      this.pos.y = Math.max(avg, this.pos.y + this.vy * dt);
      if (this.pos.y === avg) {
        if (this.vy < -6) this.addDamage((-this.vy - 6) * 2.5);
        this.vy = 0;
      }
    } else {
      this.pos.y += (avg - this.pos.y) * Math.min(1, dt * 20);
      this.vy = 0;
    }
    this.groundPitch = -Math.atan2((hFL + hFR) / 2 - (hRL + hRR) / 2, this.a + this.b);
    this.groundRoll = Math.atan2((hFL + hRL) / 2 - (hFR + hRR) / 2, ht * 2);
  }

  // OBB del auto contra cajas estáticas (edificios, postes, barreras)
  collideStatic(col) {
    const r = this.hl + 0.5;
    const list = col.query(this.pos.x - r, this.pos.z - r, this.pos.x + r, this.pos.z + r, this._q || (this._q = []));
    const f = this.forward, l = this.left;
    for (const b of list) {
      if (b.maxY <= this.pos.y + 0.45 || b.minY >= this.pos.y + this.height) continue;
      const bcx = (b.minX + b.maxX) / 2, bcz = (b.minZ + b.maxZ) / 2;
      const bx = (b.maxX - b.minX) / 2, bz = (b.maxZ - b.minZ) / 2;
      const dx = this.pos.x - bcx, dz = this.pos.z - bcz;
      let best = Infinity, nx = 0, nz = 0;
      const axes = [[1, 0], [0, 1], [f.x, f.z], [l.x, l.z]];
      let sep = false;
      for (const [ax, az] of axes) {
        const rc = this.hl * Math.abs(f.x * ax + f.z * az) + this.hw * Math.abs(l.x * ax + l.z * az);
        const rb = bx * Math.abs(ax) + bz * Math.abs(az);
        const d = dx * ax + dz * az;
        const o = rc + rb - Math.abs(d);
        if (o <= 0) { sep = true; break; }
        if (o < best) { best = o; const s = d < 0 ? -1 : 1; nx = ax * s; nz = az * s; }
      }
      if (sep) continue;
      this.resolveContact(nx, nz, best, Infinity, null, b.type);
    }
  }

  // Empuja fuera, aplica impulso, giro y daño. other = otro Vehicle (o null si es estático).
  resolveContact(nx, nz, depth, otherMass, other, type) {
    const share = other ? otherMass / (this.mass + otherMass) : 1;
    this.pos.x += nx * depth * share;
    this.pos.z += nz * depth * share;
    if (other) {
      other.pos.x -= nx * depth * (1 - share);
      other.pos.z -= nz * depth * (1 - share);
    }
    // punto de contacto: esquina del auto más metida en la dirección del obstáculo
    let cp = null, minD = Infinity;
    for (const c of this.corners()) {
      const d = c.x * nx + c.z * nz;
      if (d < minD) { minD = d; cp = c; }
    }
    const rx = cp.x - this.pos.x, rz = cp.z - this.pos.z;
    const vcx = this.vx + this.omega * rz, vcz = this.vz - this.omega * rx;
    let ovx = 0, ovz = 0;
    if (other) {
      const orx = cp.x - other.pos.x, orz = cp.z - other.pos.z;
      ovx = other.vx + other.omega * orz; ovz = other.vz - other.omega * orx;
    }
    const vn = (vcx - ovx) * nx + (vcz - ovz) * nz;
    if (vn >= 0) return 0;
    const k = rz * nx - rx * nz;
    let invMass = 1 / this.mass + (k * k) / this.inertia;
    let ok = 0;
    if (other) {
      const orx = cp.x - other.pos.x, orz = cp.z - other.pos.z;
      ok = orz * nx - orx * nz;
      invMass += 1 / other.mass + (ok * ok) / other.inertia;
    }
    const e = 0.18;
    const j = (-(1 + e) * vn) / invMass;
    this.vx += (j * nx) / this.mass;
    this.vz += (j * nz) / this.mass;
    this.omega += (j * k) / this.inertia;
    // fricción tangencial (raspones contra paredes)
    const tx = -nz, tz = nx;
    const vt = (vcx - ovx) * tx + (vcz - ovz) * tz;
    const kt = rz * tx - rx * tz;
    const jt = THREE.MathUtils.clamp(-vt / (1 / this.mass + (kt * kt) / this.inertia), -0.35 * j, 0.35 * j);
    this.vx += (jt * tx) / this.mass;
    this.vz += (jt * tz) / this.mass;
    this.omega += (jt * kt) / this.inertia;
    if (other) {
      other.vx -= (j * nx) / other.mass;
      other.vz -= (j * nz) / other.mass;
      other.omega -= (j * ok) / other.inertia;
      other.sleeping = false;
    }
    const impact = -vn;
    if (impact > 2.5) {
      const dmg = (impact - 2.5) * (type === 'prop' ? 1.2 : 2.2) * (other ? 0.8 : 1);
      this.addDamage(dmg);
      const local = this.toLocal(cp.x, cp.z);
      const nl = this.toLocalDir(nx, nz);
      this.dent(local.x, local.z, nl.x, nl.z, Math.min(0.22, impact * 0.012));
      if (other) {
        other.addDamage(dmg * 0.8);
        const ol = other.toLocal(cp.x, cp.z), on = other.toLocalDir(-nx, -nz);
        other.dent(ol.x, ol.z, on.x, on.z, Math.min(0.2, impact * 0.01));
      }
      const now = performance.now();
      if (now - this.lastCrash > 120) {
        this.lastCrash = now;
        bus.emit('vehicle:crash', { vehicle: this, other, x: cp.x, y: this.pos.y + 0.6, z: cp.z, impact });
      }
    }
    return impact;
  }

  toLocalDir(x, z) {
    const s = Math.sin(this.h), c = Math.cos(this.h);
    return { x: x * c - z * s, z: x * s + z * c };
  }

  addDamage(v) {
    if (this.dead) return;
    this.damage = Math.min(100, this.damage + v);
    if (this.damage >= 100) {
      this.dead = true;
      bus.emit('vehicle:destroyed', this);
    }
  }

  // Abolladura: hunde los vértices cercanos al punto de impacto (coordenadas locales).
  dent(lx, lz, nx, nz, amount) {
    const p = this.geo.attributes.position, col = this.geo.attributes.color, mask = this.geo.attributes.paint;
    const R = 0.75;
    for (let i = 0; i < p.count; i++) {
      // en el modelo, la izquierda es +X local y el frente +Z
      const dx = p.getX(i) - lx, dz = p.getZ(i) - lz;
      const d = Math.hypot(dx, dz);
      if (d > R) continue;
      const w = (1 - d / R) * amount;
      p.setX(i, p.getX(i) + nx * w);
      p.setZ(i, p.getZ(i) + nz * w);
      p.setY(i, p.getY(i) - w * 0.25);
      if (mask.getX(i) > 0) {
        const s = 1 - Math.min(0.5, w * 2.5);
        col.setXYZ(i, col.getX(i) * s, col.getY(i) * s, col.getZ(i) * s);
      }
    }
    p.needsUpdate = true;
    col.needsUpdate = true;
    this.geo.computeBoundingSphere();
  }

  repair() {
    const tpl = this.tpl.body;
    this.geo.attributes.position.copy(tpl.attributes.position);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.copy(tpl.attributes.normal);
    this.geo.attributes.normal.needsUpdate = true;
    this.paint(this.color);
    this.damage = 0;
    this.dead = false;
  }

  // -------------------------------------------------------------- visual
  syncVisual(dt, night = 0) {
    // suspensión: inclinación por aceleración + forma del piso (resorte amortiguado)
    if (dt > 0) {
      // frenar (aceleración negativa) hunde la trompa: rotación X positiva
      const pT = this.groundPitch - THREE.MathUtils.clamp(this.longAcc * 0.009, -0.06, 0.06);
      const rT = this.groundRoll + THREE.MathUtils.clamp(this.latAcc * 0.007, -0.07, 0.07);
      const k = 90, c = 13;
      this.pitchV += (k * (pT - this.pitch) - c * this.pitchV) * dt;
      this.rollV += (k * (rT - this.roll) - c * this.rollV) * dt;
      this.pitch += this.pitchV * dt;
      this.roll += this.rollV * dt;
      this.wheelAngle += (this.forwardSpeed / this.T.wheelR) * dt;
    }
    this.group.position.copy(this.pos);
    this.group.rotation.set(0, this.h, 0);
    this.body.rotation.set(this.pitch, 0, this.roll);
    // luces
    const M = this.materials;
    const braking = this.controls.brake > 0 && this.forwardSpeed > 0.5 && !this.reverse;
    const lightsOn = night > 0.35 && this.driver && !this.dead;
    this.headMesh.material = lightsOn ? M.headOn : M.headOff;
    this.tailMesh.material = braking || (this.reverse && this.controls.brake > 0) ? M.brake : lightsOn ? M.tailOn : M.tailOff;
    this.beam.visible = !!lightsOn && M.beamEnabled;
    if (this.barRed) {
      this.sirenT += dt;
      const ph = Math.floor(this.sirenT * 6) % 4;
      const on = this.siren && !this.dead;
      this.barRed.material = on && (ph === 0 || ph === 2) ? M.barRedOn : M.barRedOff;
      this.barBlue.material = on && (ph === 1 || ph === 3) ? M.barBlueOn : M.barBlueOff;
    }
  }

  // Escribe las 4 ruedas en el InstancedMesh compartido a partir de "index".
  writeWheels(mesh, index, dummy, tmp) {
    const r = this.T.wheelR, ht = this.tpl.track / 2;
    this.group.updateMatrixWorld();
    const wheels = WHEELS;
    for (let i = 0; i < 4; i++) {
      const [zs, xs, front] = wheels[i];
      dummy.position.set(xs * ht, r, zs > 0 ? this.a : -this.b);
      dummy.rotation.set(this.wheelAngle, front ? this.steer : 0, 0, 'YXZ');
      dummy.scale.set(r * 0.95, r, r);
      dummy.updateMatrix();
      tmp.multiplyMatrices(this.group.matrixWorld, dummy.matrix);
      mesh.setMatrixAt(index + i, tmp);
    }
  }
}

Vehicle.nextId = 1;

// agarre extra por clima (1 = seco). Lo actualiza el juego según la lluvia.
Vehicle.wetGrip = 1;
