import * as THREE from 'three';
import { Vehicle } from './Vehicle.js';
import { VEHICLE_TYPES } from './VehicleTypes.js';
import { getWheelGeometry } from './VehicleModel.js';
import { CharacterModel } from '../player/CharacterModel.js';
import { createRng, hashSeed } from '../world/rng.js';
import { makeLightPoolTexture } from '../world/Props.js';
import { CURB } from '../world/CityLayout.js';
import { bus } from '../core/EventBus.js';

// ============================================================================
// Vehicle System: todos los autos del mundo (del jugador, estacionados y del
// tráfico). Física a paso fijo, colisiones auto-auto y auto-peatón, ruedas
// instanciadas (1 draw call), autos estacionados que aparecen cerca del
// jugador, entrar/salir y robo de autos.
// ============================================================================

const MAX_VEHICLES = 64;
const PARK_RADIUS = 150, PARK_DESPAWN = 210, MAX_PARKED = 22;

export class VehicleSystem {
  constructor(world, settings, surfaces, particles) {
    this.world = world;
    this.settings = settings;
    this.surfaces = surfaces;
    this.particles = particles;
    this.scene = world.scene;
    this.vehicles = [];
    this.fleeing = [];
    this.parkTimer = 0;
    this.buildMaterials();
    this.wheelMesh = new THREE.InstancedMesh(getWheelGeometry(), this.wheelMat, MAX_VEHICLES * 4);
    this.wheelMesh.count = 0;
    this.wheelMesh.castShadow = true;
    this.wheelMesh.frustumCulled = false;
    this.wheelMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.wheelMesh);
    this.dummy = new THREE.Object3D();
    this.tmp = new THREE.Matrix4();
    this.buildParkingSlots(world.layout);
    // faro del auto del jugador (luz real solo en calidad media/alta)
    if (settings.get('quality') !== 'low') {
      this.headlight = new THREE.SpotLight(0xfff1d6, 0, 60, 0.55, 0.5, 1.2);
      this.headlight.castShadow = false;
      this.scene.add(this.headlight, this.headlight.target);
    }
  }

  buildMaterials() {
    const lambert = this.settings.preset.lighting === 'lambert';
    const Body = lambert ? THREE.MeshLambertMaterial : THREE.MeshStandardMaterial;
    const params = lambert ? { vertexColors: true } : { vertexColors: true, roughness: 0.32, metalness: 0.35, envMapIntensity: 1.1 };
    this.wheelMat = new Body(lambert ? { vertexColors: true } : { vertexColors: true, roughness: 0.75, metalness: 0.2 });
    const beamTex = makeLightPoolTexture();
    const beamGeo = new THREE.PlaneGeometry(7, 12);
    beamGeo.rotateX(-Math.PI / 2);
    this.mat = {
      body: new Body(params),
      headOff: new THREE.MeshBasicMaterial({ color: 0x9aa0a6 }),
      headOn: new THREE.MeshBasicMaterial({ color: 0xfff6dc }),
      tailOff: new THREE.MeshBasicMaterial({ color: 0x4a0a0a }),
      tailOn: new THREE.MeshBasicMaterial({ color: 0xb01515 }),
      brake: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
      barRedOff: new THREE.MeshBasicMaterial({ color: 0x5a1010 }),
      barRedOn: new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false }),
      barBlueOff: new THREE.MeshBasicMaterial({ color: 0x10205a }),
      barBlueOn: new THREE.MeshBasicMaterial({ color: 0x2a6bff, toneMapped: false }),
      beam: new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff0d0 }),
      beamGeo,
      beamEnabled: this.settings.get('quality') !== 'low',
    };
  }

  // -------------------------------------------------------------- creación
  spawn(typeId, color, x, z, h, opts = {}) {
    if (this.vehicles.length >= MAX_VEHICLES) return null;
    const T = VEHICLE_TYPES[typeId];
    const v = new Vehicle(typeId, color ?? T.palette[0], this.mat);
    const y = this.world.collision.groundHeight(x, z, (opts.y ?? 0) + 0.6, 0.5);
    v.place(x, y, z, h);
    v.kind = opts.kind || 'free';
    v.slot = opts.slot || null;
    v.sleeping = !opts.awake;
    this.scene.add(v.group);
    this.vehicles.push(v);
    return v;
  }

  remove(v) {
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
    this.scene.remove(v.group);
    v.geo.dispose();
    if (v.slot) v.slot.active = null;
    bus.emit('vehicle:removed', v);
  }

  // -------------------------------------------------------------- estacionados
  buildParkingSlots(L) {
    const rng = createRng(2024);
    this.slots = [];
    for (const r of L.roads) {
      if (r.type !== 'street') continue;
      const off = r.spec.laneWidth + r.spec.parking / 2;
      for (const side of [-1, 1]) {
        for (let s = r.from + 9; s < r.to - 9; s += 6.4) {
          if (!rng.chance(0.2)) continue;
          const t = side * off;
          const x = r.axis === 'x' ? r.pos + t : s;
          const z = r.axis === 'x' ? s : r.pos + t;
          // sentido de la mano de ese lado
          let h;
          if (r.axis === 'x') h = side > 0 ? Math.PI : 0;
          else h = side > 0 ? Math.PI / 2 : -Math.PI / 2;
          this.slots.push(this.makeSlot(x, z, h, rng));
        }
      }
    }
    for (const c of L.props.cars) this.slots.push(this.makeSlot(c.x, c.z, c.rot, rng));
    // auto inicial del jugador, en Plaza Vega junto al punto de aparición
    const sp = L.spawn;
    this.slots.push({ x: sp.x + 3.6, z: sp.z - 3.5, h: Math.PI, type: 'furia', color: 0xc0392b, active: null, gone: false, starter: true });
  }

  makeSlot(x, z, h, rng) {
    const types = ['vento', 'pico', 'atlas', 'ranchero', 'vento', 'pico', 'clasico', 'toro', 'furia'];
    const type = rng.pick(types);
    return { x, z, h, type, color: rng.pick(VEHICLE_TYPES[type].palette), active: null, gone: false };
  }

  streamParked(px, pz) {
    let parked = this.vehicles.filter((v) => v.kind === 'parked').length;
    // quitar lejanos (los que nadie movió vuelven a su lugar la próxima vez)
    for (const v of [...this.vehicles]) {
      const d = Math.hypot(v.pos.x - px, v.pos.z - pz);
      if (v.kind === 'parked' && d > PARK_DESPAWN) {
        this.remove(v);
        parked--;
      } else if (v.kind === 'free' && !v.driver && d > 260 && !v.owned) {
        this.remove(v);
      }
    }
    if (parked >= MAX_PARKED) return;
    const near = this.slots.filter((s) => !s.active && !s.gone && Math.abs(s.x - px) < PARK_RADIUS && Math.abs(s.z - pz) < PARK_RADIUS);
    near.sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz));
    for (const s of near) {
      if (parked >= MAX_PARKED) break;
      if (Math.hypot(s.x - px, s.z - pz) > PARK_RADIUS) continue;
      if (this.vehicles.some((v) => Math.abs(v.pos.x - s.x) < 5 && Math.abs(v.pos.z - s.z) < 5)) continue;
      const v = this.spawn(s.type, s.color, s.x, s.z, s.h, { kind: 'parked', slot: s });
      if (!v) break;
      s.active = v;
      parked++;
    }
  }

  // Un auto estacionado que el jugador movió deja de pertenecer a su lugar.
  releaseFromSlot(v) {
    if (v.slot) {
      v.slot.gone = true;
      v.slot.active = null;
      v.slot = null;
    }
    v.kind = 'free';
  }

  // -------------------------------------------------------------- simulación
  fixedUpdate(dt) {
    for (const v of this.vehicles) {
      v.step(dt, this.world, this.surfaces);
      if (v.kind === 'parked' && v.slot && (Math.abs(v.pos.x - v.slot.x) > 2.5 || Math.abs(v.pos.z - v.slot.z) > 2.5)) this.releaseFromSlot(v);
    }
    // colisiones entre autos (SAT de cajas orientadas)
    const n = this.vehicles.length;
    for (let i = 0; i < n; i++) {
      const A = this.vehicles[i];
      for (let j = i + 1; j < n; j++) {
        const B = this.vehicles[j];
        if (A.sleeping && B.sleeping) continue;
        const dx = A.pos.x - B.pos.x, dz = A.pos.z - B.pos.z;
        const rr = A.hl + B.hl;
        if (dx * dx + dz * dz > rr * rr) continue;
        const hit = obbOverlap(A, B);
        if (hit) {
          A.sleeping = false;
          B.sleeping = false;
          A.resolveContact(hit.nx, hit.nz, hit.depth, B.mass, B, 'vehicle');
        }
      }
    }
  }

  // Colisión del peatón (jugador) contra los autos. Devuelve el auto que lo atropelló (si hubo).
  resolvePedestrian(pos, radius, vel) {
    let hitBy = null;
    for (const v of this.vehicles) {
      if (pos.y > v.pos.y + v.height || pos.y + 1.7 < v.pos.y) continue;
      const dx = pos.x - v.pos.x, dz = pos.z - v.pos.z;
      if (dx * dx + dz * dz > (v.hl + 1.5) * (v.hl + 1.5)) continue;
      const loc = v.toLocal(pos.x, pos.z);
      const cx = THREE.MathUtils.clamp(loc.x, -v.hw, v.hw), cz = THREE.MathUtils.clamp(loc.z, -v.hl, v.hl);
      let ex = loc.x - cx, ez = loc.z - cz;
      let d = Math.hypot(ex, ez);
      if (d >= radius) continue;
      if (d < 1e-4) {
        // dentro de la caja: salir por el lado más cercano
        const px = v.hw - Math.abs(loc.x), pz = v.hl - Math.abs(loc.z);
        if (px < pz) { ex = Math.sign(loc.x) || 1; ez = 0; } else { ex = 0; ez = Math.sign(loc.z) || 1; }
        d = 0;
      } else { ex /= d; ez /= d; }
      const push = radius - d;
      const l = v.left, f = v.forward;
      const wx = l.x * ex + f.x * ez, wz = l.z * ex + f.z * ez;
      pos.x += wx * push;
      pos.z += wz * push;
      // velocidad del auto en dirección al peatón
      const approach = v.vx * -wx + v.vz * -wz;
      if (approach > 4 && v.speed > 4) {
        hitBy = { vehicle: v, speed: approach, nx: wx, nz: wz };
        vel.x = wx * approach * 0.9 + v.vx * 0.3;
        vel.z = wz * approach * 0.9 + v.vz * 0.3;
        vel.y = Math.min(7, approach * 0.35);
      }
    }
    return hitBy;
  }

  nearestEnterable(pos, maxDist = 4) {
    let best = null, bd = maxDist;
    for (const v of this.vehicles) {
      if (v.driver === 'player') continue;
      const loc = v.toLocal(pos.x, pos.z);
      const dx = Math.max(0, Math.abs(loc.x) - v.hw), dz = Math.max(0, Math.abs(loc.z) - v.hl);
      const d = Math.hypot(dx, dz);
      if (d < bd && v.speed < 6) { bd = d; best = v; }
    }
    return best;
  }

  // El conductor de la IA sale corriendo cuando le robás el auto.
  ejectDriver(v) {
    const look = {
      skin: [0xf1c7a5, 0xe0ac87, 0xc68b62, 0x9c6644, 0x6f4a32][Math.floor(Math.random() * 5)],
      shirt: Math.floor(Math.random() * 0xffffff), pants: [0x2b2f3a, 0x3b3b3b, 0x1f3a5f, 0x5a4a3a][Math.floor(Math.random() * 4)],
      hair: [0x2a1d14, 0x111111, 0x6b4a2a, 0xb08850][Math.floor(Math.random() * 4)],
    };
    const m = new CharacterModel(look);
    const l = v.left;
    const pos = new THREE.Vector3(v.pos.x + l.x * (v.hw + 0.5), v.pos.y, v.pos.z + l.z * (v.hw + 0.5));
    const dir = Math.atan2(l.x, l.z) + (Math.random() - 0.5) * 0.8;
    m.root.position.copy(pos);
    m.root.rotation.y = dir;
    this.scene.add(m.root);
    this.fleeing.push({ m, pos, dir, t: 0 });
    bus.emit('npc:scream', { x: pos.x, z: pos.z });
  }

  updateFleeing(dt) {
    for (const f of [...this.fleeing]) {
      f.t += dt;
      const sp = 5.5;
      f.pos.x += Math.sin(f.dir) * sp * dt;
      f.pos.z += Math.cos(f.dir) * sp * dt;
      const n = { x: 0, z: 0 };
      if (this.world.collision.resolveCylinder(f.pos, 0.34, 1.8, 0.42, n)) f.dir += Math.PI * 0.5 * (Math.random() < 0.5 ? 1 : -1);
      f.pos.y = this.world.collision.groundHeight(f.pos.x, f.pos.z, f.pos.y + 0.45, 0.2);
      f.m.root.position.copy(f.pos);
      f.m.root.rotation.y = f.dir;
      f.m.update(dt, sp, true, 0, true);
      if (f.t > 7) {
        this.scene.remove(f.m.root);
        f.m.dispose();
        this.fleeing.splice(this.fleeing.indexOf(f), 1);
      }
    }
  }

  // -------------------------------------------------------------- visual
  update(dt, night, player, camera) {
    this.parkTimer -= dt;
    if (this.parkTimer <= 0) {
      this.parkTimer = 0.7;
      this.streamParked(player.x, player.z);
    }
    let w = 0;
    for (const v of this.vehicles) {
      v.syncVisual(dt, night);
      const visible = camera.position.distanceToSquared(v.pos) < 360 * 360;
      v.group.visible = visible;
      if (visible) {
        v.writeWheels(this.wheelMesh, w, this.dummy, this.tmp);
        w += 4;
      }
      // efectos: humo de neumáticos, polvo y motor dañado
      if (visible && this.particles) this.effects(v, dt);
    }
    this.wheelMesh.count = w;
    this.wheelMesh.instanceMatrix.needsUpdate = true;
    this.updateFleeing(dt);
  }

  effects(v, dt) {
    const P = this.particles;
    const sp = v.speed;
    const surf = this.surfaces.at(v.pos.x, v.pos.z);
    const offroad = surf === 0 || surf === 3 || surf === 4;
    if (v.slip > 0.45 && sp > 2 && Math.random() < v.slip * 0.9) {
      const f = v.forward, l = v.left;
      for (const s of [-1, 1]) {
        const x = v.pos.x - f.x * v.b + l.x * s * v.hw * 0.8, z = v.pos.z - f.z * v.b + l.z * s * v.hw * 0.8;
        P.emit(offroad ? 'dust' : 'smoke', x, v.pos.y + 0.3, z, -v.vx * 0.1, 0.4, -v.vz * 0.1, 1, 0.5);
      }
    } else if (offroad && sp > 6 && Math.random() < 0.5) {
      const f = v.forward;
      P.emit('dust', v.pos.x - f.x * v.hl, v.pos.y + 0.3, v.pos.z - f.z * v.hl, 0, 0.5, 0, 1, 0.8);
    }
    // agua que levantan las ruedas con el piso mojado
    if (this.wet > 0.3 && sp > 9 && !offroad && Math.random() < this.wet * (v.driver === 'player' ? 0.9 : 0.25)) {
      const f = v.forward, l = v.left;
      for (const s of [-1, 1]) {
        const x = v.pos.x - f.x * v.b + l.x * s * v.hw, z = v.pos.z - f.z * v.b + l.z * s * v.hw;
        P.emit('spray', x, v.pos.y + 0.25, z, v.vx * 0.35, 0.8, v.vz * 0.35, 1, 0.6);
      }
    }
    if (v.damage > 55 && Math.random() < (v.damage - 50) / 80) {
      const f = v.forward;
      P.emit('engine', v.pos.x + f.x * (v.hl - 0.8), v.pos.y + v.height * 0.75, v.pos.z + f.z * (v.hl - 0.8), v.vx * 0.3, 1.2, v.vz * 0.3, 1, 0.3);
    }
  }

  updateHeadlight(v, night) {
    if (!this.headlight) return;
    if (!v || night < 0.35 || v.dead) {
      this.headlight.intensity = 0;
      return;
    }
    const f = v.forward;
    this.headlight.intensity = 40 * night;
    this.headlight.position.set(v.pos.x + f.x * (v.hl + 0.2), v.pos.y + 0.8, v.pos.z + f.z * (v.hl + 0.2));
    this.headlight.target.position.set(v.pos.x + f.x * (v.hl + 18), v.pos.y - 0.5, v.pos.z + f.z * (v.hl + 18));
    this.headlight.target.updateMatrixWorld();
  }
}

// SAT entre dos cajas orientadas. Normal de B hacia A.
function obbOverlap(A, B) {
  const fa = A.forward, la = A.left, fb = B.forward, lb = B.left;
  const dx = A.pos.x - B.pos.x, dz = A.pos.z - B.pos.z;
  let best = Infinity, nx = 0, nz = 0;
  for (const [ax, az] of [[fa.x, fa.z], [la.x, la.z], [fb.x, fb.z], [lb.x, lb.z]]) {
    const ra = A.hl * Math.abs(fa.x * ax + fa.z * az) + A.hw * Math.abs(la.x * ax + la.z * az);
    const rb = B.hl * Math.abs(fb.x * ax + fb.z * az) + B.hw * Math.abs(lb.x * ax + lb.z * az);
    const d = dx * ax + dz * az;
    const o = ra + rb - Math.abs(d);
    if (o <= 0) return null;
    if (o < best) { best = o; const s = d < 0 ? -1 : 1; nx = ax * s; nz = az * s; }
  }
  return { nx, nz, depth: best };
}

export { CURB };
