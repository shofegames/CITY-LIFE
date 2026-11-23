import * as THREE from 'three';
import { ScriptedDriver } from '../missions/ScriptedDriver.js';
import { bus } from '../core/EventBus.js';

// ============================================================================
// Police AI: nivel de búsqueda (estrellas), patrulleros que persiguen por las
// calles usando el GPS, embestidas de cerca, bloqueos en nivel 3+, helicóptero
// en nivel 4+. La policía SOLO conoce tu posición si te ve (línea de visión);
// si la perdés, busca alrededor de la última posición conocida. Si escapás
// el tiempo suficiente, las estrellas desaparecen.
// ============================================================================

const UNITS_BY_LEVEL = [0, 1, 2, 4, 5, 6];
const SIGHT_CAR = 75, SIGHT_HELI = 190;

export class PoliceSystem {
  constructor(game) {
    this.g = game;
    this.wanted = 0;
    this.units = [];
    this.roadblocks = [];
    this.lastSeen = new THREE.Vector3();
    this.seen = false;
    this.unseenTime = 0;
    this.spawnTimer = 0;
    this.roadblockTimer = 10;
    this.bustTime = 0;
    this.heli = null;
    this._frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
    this.searchOffset = new THREE.Vector3();
    bus.on('vehicle:removed', (v) => {
      this.units = this.units.filter((u) => u.v !== v);
      this.roadblocks = this.roadblocks.filter((r) => r.v !== v);
    });
  }

  get evadeTime() {
    return 9 + this.wanted * 4;
  }

  get searching() {
    return this.wanted > 0 && !this.seen;
  }

  // ---------------------------------------------------------------- delitos
  report(crime, pos) {
    const sees = this.anyUnitSees(pos) || this.wanted > 0;
    let add = 0;
    if (crime === 'carjack') add = sees || Math.random() < 0.35 ? 1 : 0;
    else if (crime === 'assault-police') add = this.wanted < 2 ? 2 - this.wanted : 1;
    else if (crime === 'hit-and-run') add = sees || Math.random() < 0.25 ? 1 : 0;
    else if (crime === 'reckless') add = sees && this.wanted === 0 ? 1 : 0;
    if (add > 0) this.setWanted(Math.min(5, this.wanted + add), pos);
  }

  setWanted(level, pos) {
    const prev = this.wanted;
    this.wanted = THREE.MathUtils.clamp(level, 0, 5);
    if (this.wanted > 0) {
      this.lastSeen.copy(pos || this.g.player.position);
      this.seen = true;
      this.unseenTime = 0;
      this.spawnTimer = Math.min(this.spawnTimer, 0.5);
      // la central conoce tu posición durante unos segundos después del delito
      if (this.wanted > prev) this.knowTime = 8 + this.wanted * 3;
    }
    if (this.wanted === 0 && prev > 0) this.standDown();
    if (this.wanted !== prev) bus.emit('police:wanted', { level: this.wanted, prev });
  }

  clear() {
    this.setWanted(0);
  }

  standDown() {
    for (const u of this.units) {
      u.v.siren = false;
      u.leaving = true;
    }
    for (const r of this.roadblocks) this.g.vehicles.remove(r.v);
    this.roadblocks = [];
    if (this.heli) this.heli.leaving = true;
    this.bustTime = 0;
  }

  // ---------------------------------------------------------------- visión
  lineOfSight(from, to, maxDist) {
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    if (d > maxDist) return false;
    const t = this.g.world.collision.raycast(from.x, from.y + 1.4, from.z, to.x, to.y + 1.2, to.z, 0);
    return t > 0.97;
  }

  anyUnitSees(pos) {
    for (const u of this.units) if (!u.leaving && this.lineOfSight(u.v.pos, pos, SIGHT_CAR)) return true;
    if (this.heli && !this.heli.leaving && this.heli.pos.distanceTo(pos) < SIGHT_HELI) return true;
    return false;
  }

  // ---------------------------------------------------------------- simulación
  fixedUpdate(dt) {
    const target = this.g.playerVehicle ? this.g.playerVehicle.pos : this.g.player.position;
    const others = this.g.vehicles.vehicles;
    for (const u of this.units) {
      if (u.leaving) {
        u.driver.maxSpeed = 12;
        u.driver.update(dt, others);
        continue;
      }
      const dist = Math.hypot(u.v.pos.x - target.x, u.v.pos.z - target.z);
      const sees = this.wanted > 0 && this.lineOfSight(u.v.pos, target, SIGHT_CAR);
      u.sees = sees;
      if (sees && dist < 38) this.directChase(u, target, dt);
      else u.driver.update(dt, others);
    }
  }

  // Persecución directa: apunta a la posición futura del jugador y embiste.
  directChase(u, target, dt) {
    const v = u.v, c = v.controls;
    const pv = this.g.playerVehicle;
    const lead = pv ? 0.7 : 0.2;
    const tx = target.x + (pv ? pv.vx * lead : 0), tz = target.z + (pv ? pv.vz * lead : 0);
    const loc = v.toLocal(tx, tz);
    const alpha = Math.atan2(loc.x, Math.max(0.5, Math.abs(loc.z)) * Math.sign(loc.z || 1));
    const limit = v.T.steerMax / (1 + Math.abs(v.forwardSpeed) / 20);
    const dist = Math.hypot(loc.x, loc.z);
    if (loc.z < -2 && dist < 14) {
      // está detrás: marcha atrás girando
      c.hold = false; c.throttle = 0; c.brake = 0.8;
      c.steer = THREE.MathUtils.clamp(-alpha / limit, -1, 1);
      return;
    }
    c.steer = THREE.MathUtils.clamp(Math.atan2(2 * v.T.wheelbase * Math.sin(alpha), Math.max(4, dist)) / limit, -1, 1);
    const targetSpeed = pv ? Math.max(8, pv.speed + 6) : Math.min(10, dist * 0.8);
    const err = targetSpeed - v.forwardSpeed;
    c.hold = false;
    c.handbrake = Math.abs(alpha) > 1.1 && v.speed > 10;
    if (!pv && dist < 4.5) { c.throttle = 0; c.hold = true; }
    else if (err > 0) { c.throttle = 1; c.brake = 0; }
    else { c.throttle = 0; c.hold = err < -3; }
  }

  update(dt) {
    const g = this.g;
    const target = g.playerVehicle ? g.playerVehicle.pos : g.player.position;

    // ---- ¿alguien ve al jugador? ----
    if (this.wanted > 0) {
      this.knowTime = Math.max(0, (this.knowTime || 0) - dt);
      const seen = this.knowTime > 0 || this.units.some((u) => u.sees) || this.anyUnitSees(target);
      if (seen) {
        this.seen = true;
        this.unseenTime = 0;
        this.lastSeen.copy(target);
      } else {
        this.unseenTime += dt;
        if (this.unseenTime > 1.5) this.seen = false;
        if (this.unseenTime > this.evadeTime) {
          this.setWanted(0);
          bus.emit('police:evaded');
        }
      }
    }

    // ---- aparición de patrulleros ----
    this.spawnTimer -= dt;
    const want = UNITS_BY_LEVEL[this.wanted];
    const active = this.units.filter((u) => !u.leaving).length;
    if (this.wanted > 0 && active < want && this.spawnTimer <= 0) {
      this.spawnTimer = 3.5 - this.wanted * 0.4;
      this.spawnUnit(target);
    }

    // ---- rutas hacia el jugador (o hacia la última posición conocida) ----
    for (const u of this.units) {
      u.routeT -= dt;
      if (u.leaving) {
        const d = u.v.pos.distanceTo(target);
        if (d > 90 || (d > 45 && !this.g.isVisible(u.v.pos))) this.g.vehicles.remove(u.v);
        continue;
      }
      if (u.routeT <= 0) {
        u.routeT = 1.3;
        let goal = this.seen ? target : this.lastSeen;
        if (!this.seen) {
          // búsqueda: recorrer puntos alrededor de la última posición
          if (u.v.pos.distanceTo(this.lastSeen) < 25 || !u.searchGoal) {
            const a = Math.random() * Math.PI * 2, r = 30 + this.wanted * 15;
            u.searchGoal = new THREE.Vector3(this.lastSeen.x + Math.cos(a) * r, 0, this.lastSeen.z + Math.sin(a) * r);
          }
          goal = u.searchGoal;
        }
        const pts = g.routes.route(u.v.pos, goal);
        u.driver.setPath(pts);
        u.driver.maxSpeed = this.seen ? 24 + this.wanted * 4 : 16;
      }
    }

    // ---- arresto ----
    this.updateBust(dt, target);

    // ---- bloqueos (nivel 3+) ----
    this.roadblockTimer -= dt;
    if (this.wanted >= 3 && this.roadblockTimer <= 0 && g.playerVehicle && g.playerVehicle.speed > 10) {
      this.roadblockTimer = 22;
      this.placeRoadblock(g.playerVehicle);
    }
    for (const r of [...this.roadblocks]) {
      r.t += dt;
      if (r.t > 45 || r.v.pos.distanceTo(target) > 170) this.g.vehicles.remove(r.v);
    }

    // ---- helicóptero (nivel 4+) ----
    if (this.wanted >= 4 && !this.heli) this.heli = new Helicopter(g.world.scene, target);
    if (this.heli) {
      this.heli.update(dt, this.seen ? target : this.lastSeen, g.world.night);
      if (this.heli.gone) {
        this.heli.dispose();
        this.heli = null;
      }
    }
    // sirena: volumen según el patrullero más cercano
    let nearest = Infinity;
    for (const u of this.units) if (u.v.siren) nearest = Math.min(nearest, u.v.pos.distanceTo(g.camera.position));
    for (const r of this.roadblocks) nearest = Math.min(nearest, r.v.pos.distanceTo(g.camera.position));
    g.audio.setSiren(nearest < 200 ? 1 - nearest / 200 : 0);
    g.audio.setRotor(this.heli && !this.heli.gone ? Math.max(0, 1 - this.heli.pos.distanceTo(g.camera.position) / 220) : 0);
  }

  updateBust(dt, target) {
    if (this.wanted === 0) { this.bustTime = 0; return; }
    const pv = this.g.playerVehicle;
    const slow = pv ? pv.speed < 1.5 : this.g.player.speed < 2.5;
    let close = false;
    for (const u of [...this.units, ...this.roadblocks]) {
      if (u.leaving) continue;
      if (u.v.pos.distanceTo(target) < (pv ? 7 : 7.5) && u.v.speed < 4) close = true;
    }
    if (close && slow) this.bustTime += dt;
    else this.bustTime = Math.max(0, this.bustTime - dt * 2);
    if (this.bustTime > (pv ? 2.5 : 1.8)) {
      this.bustTime = 0;
      bus.emit('police:busted');
    }
  }

  spawnUnit(target) {
    const g = this.g;
    this._m.multiplyMatrices(g.camera.projectionMatrix, g.camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._m);
    const p = new THREE.Vector3();
    for (let tries = 0; tries < 14; tries++) {
      const lane = g.roads.randomLane(Math.random);
      const d = 8 + Math.random() * Math.max(1, lane.len - 16);
      g.roads.pointOnLane(lane, d, p);
      const dist = Math.hypot(p.x - target.x, p.z - target.z);
      if (dist < 55 || dist > 140) continue;
      p.y = 1;
      if (dist < 120 && this._frustum.containsPoint(p)) continue;
      if (g.vehicles.vehicles.some((v) => Math.abs(v.pos.x - p.x) < 9 && Math.abs(v.pos.z - p.z) < 9)) continue;
      const v = g.vehicles.spawn('patrulla', 0xf4f4f2, p.x, p.z, lane.heading, { kind: 'police', awake: true });
      if (!v) return;
      v.driver = 'police';
      v.siren = true;
      v.vx = Math.sin(lane.heading) * 10;
      v.vz = Math.cos(lane.heading) * 10;
      const driver = new ScriptedDriver(v, g.routes.route(v.pos, target), { maxSpeed: 26, laneFn: g.routes.laneOffset });
      v.driver = 'police';
      this.units.push({ v, driver, routeT: 0, sees: false, leaving: false });
      return;
    }
  }

  placeRoadblock(pv) {
    const g = this.g;
    const dir = new THREE.Vector3(pv.vx, 0, pv.vz).normalize();
    const ahead = new THREE.Vector3(pv.pos.x + dir.x * 120, 0, pv.pos.z + dir.z * 120);
    const p = g.routes.snapToRoad(ahead.x, ahead.z);
    if (g.surfaces.at(p.x, p.z) !== 1) return;
    if (this.g.isVisible(p) && p.distanceTo(pv.pos) < 90) return;
    // orientación de la calle en ese punto
    const onX = g.world.layout.lines.x.some((l) => Math.abs(l.pos - p.x) < 1);
    const roadHeading = onX ? 0 : Math.PI / 2;
    for (const s of [-1, 1]) {
      const off = 2.4 * s;
      const x = p.x + (onX ? off : 0), z = p.z + (onX ? 0 : off);
      const v = g.vehicles.spawn('patrulla', 0xf4f4f2, x, z, roadHeading + Math.PI / 2 + (s > 0 ? 0.25 : -0.25), { kind: 'police', awake: true });
      if (!v) continue;
      v.driver = 'police';
      v.siren = true;
      v.controls.hold = true;
      this.roadblocks.push({ v, t: 0 });
    }
    bus.emit('police:roadblock');
  }

  reset() {
    this.setWanted(0);
    for (const u of [...this.units]) this.g.vehicles.remove(u.v);
    for (const r of [...this.roadblocks]) this.g.vehicles.remove(r.v);
    this.units = [];
    this.roadblocks = [];
    if (this.heli) { this.heli.dispose(); this.heli = null; }
    this.g.audio.setSiren(0);
    this.g.audio.setRotor(0);
  }

  // marcadores para el minimapa
  blips() {
    const out = [];
    for (const u of this.units) if (!u.leaving) out.push({ x: u.v.pos.x, z: u.v.pos.z, color: Math.floor(performance.now() / 250) % 2 ? '#ff3b30' : '#2a6bff', size: 4, police: true });
    for (const r of this.roadblocks) out.push({ x: r.v.pos.x, z: r.v.pos.z, color: '#2a6bff', size: 4, police: true });
    if (this.heli && !this.heli.leaving) out.push({ x: this.heli.pos.x, z: this.heli.pos.z, color: '#2a6bff', size: 6, police: true });
    return out;
  }
}

// ============================================================================
// Helicóptero policial: sigue al jugador desde el aire, con foco de noche.
// ============================================================================
class Helicopter {
  constructor(scene, target) {
    this.scene = scene;
    this.pos = new THREE.Vector3(target.x - 180, 60, target.z - 140);
    this.vel = new THREE.Vector3();
    this.leaving = false;
    this.gone = false;
    this.t = 0;
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c2a44, roughness: 0.5, metalness: 0.3 });
    const white = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.1, metalness: 0.6 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 2.6, 6, 12).rotateX(Math.PI / 2), dark);
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1.05, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), glass);
    cockpit.position.set(0, 0.15, 1.5);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.35, 2.4), white);
    stripe.position.set(0, -0.1, -0.2);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.32, 4.6, 8).rotateX(Math.PI / 2), dark);
    tail.position.set(0, 0.3, -3.6);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.8), dark);
    fin.position.set(0, 0.8, -5.7);
    this.rotor = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 10.5), dark);
      blade.rotation.y = (i * Math.PI) / 2;
      this.rotor.add(blade);
    }
    this.rotor.position.y = 1.3;
    this.tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.6, 0.18), dark);
    this.tailRotor.position.set(0.25, 0.6, -5.7);
    for (const s of [-1, 1]) {
      const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 6).rotateX(Math.PI / 2), dark);
      skid.position.set(s * 0.9, -1.35, 0.2);
      g.add(skid);
    }
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false }));
    this.beacon.position.set(0, -1.05, -0.4);
    // cono de luz del reflector (falso, sin costo de iluminación)
    const coneMat = new THREE.MeshBasicMaterial({ color: 0xfff4d6, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    this.cone = new THREE.Mesh(new THREE.ConeGeometry(9, 60, 20, 1, true).translate(0, -30, 0), coneMat);
    g.add(body, cockpit, stripe, tail, fin, this.rotor, this.tailRotor, this.beacon);
    this.group = g;
    scene.add(g, this.cone);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  update(dt, target, night) {
    this.t += dt;
    let goal;
    if (this.leaving) goal = new THREE.Vector3(this.pos.x + 200, 90, this.pos.z - 200);
    else {
      const a = this.t * 0.25;
      goal = new THREE.Vector3(target.x + Math.cos(a) * 35, 48, target.z + Math.sin(a) * 35);
    }
    const toGoal = goal.clone().sub(this.pos);
    const desired = toGoal.clone().clampLength(0, 30);
    this.vel.lerp(desired, Math.min(1, dt * 0.9));
    this.pos.addScaledVector(this.vel, dt);
    this.group.position.copy(this.pos);
    const yaw = Math.atan2(this.vel.x, this.vel.z);
    this.group.rotation.set(Math.min(0.3, this.vel.length() * 0.012), yaw, -this.vel.x * 0.004, 'YXZ');
    this.rotor.rotation.y += dt * 40;
    this.tailRotor.rotation.x += dt * 55;
    this.beacon.visible = Math.floor(this.t * 2) % 2 === 0;
    // reflector apuntando al objetivo
    const lightOn = night > 0.3 && !this.leaving;
    this.cone.material.opacity = lightOn ? 0.07 : 0;
    if (lightOn) {
      this.cone.position.copy(this.pos);
      const dir = new THREE.Vector3(target.x - this.pos.x, target.y - this.pos.y, target.z - this.pos.z);
      const len = dir.length();
      this.cone.scale.set(1, len / 60, 1);
      this.cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
    }
    if (this.leaving && this.t > 0 && toGoal.length() < 30) this.gone = true;
    if (this.leaving && this.leaveT === undefined) this.leaveT = this.t;
    if (this.leaving && this.t - this.leaveT > 15) this.gone = true;
  }

  dispose() {
    this.scene.remove(this.group, this.cone);
    this.group.traverse((o) => o.geometry?.dispose());
  }
}
