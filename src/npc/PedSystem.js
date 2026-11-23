import * as THREE from 'three';
import { CharacterModel, SKIN_TONES } from '../player/CharacterModel.js';
import { PedRenderer } from './PedRenderer.js';
import { CURB, GRID } from '../world/CityLayout.js';
import { bus } from '../core/EventBus.js';

// ============================================================================
// NPC System: peatones de San Vega.
// - Caminan por las veredas (anillo de cada manzana), se detienen, cambian de
//   dirección y cruzan en las esquinas cuando el semáforo se los permite.
// - Reaccionan: huyen de autos que se suben a la vereda o vienen rápido, de
//   choques cercanos y de sirenas; pueden ser atropellados (caen y se levantan);
//   miran y responden si el jugador les habla (E).
// - LOD: los lejanos no se animan; fuera de rango no se dibujan.
// ============================================================================

const INSET = 2.4;
const LINES = [
  '¡Linda tarde en San Vega!', '¿Viste el tráfico en la Avenida Central? Una locura.', 'Dicen que en Altos de Vega hay autos carísimos.',
  'No te metas con la gente del puerto, eh.', 'La playa de Costa Azul está hermosa hoy.', '¿Qué mirás? Seguí caminando.',
  'Llego tarde al trabajo, perdón.', 'Mi primo vende autos en el Concesionario Vega. Pasá cuando quieras.', 'Ayer la policía persiguió a un loco en un auto naranja.',
  '¡Qué calor que hace!', 'En el Taller Duarte te dejan el auto como nuevo.', 'Estoy buscando departamento en Costa Azul... imposible.',
];
const DENSITY = { downtown: 1, commercial: 0.95, coastal: 0.8, suburbs: 0.5, rich: 0.4, industrial: 0.35 };

function randomLook() {
  const r = Math.random;
  const pick = (a) => a[Math.floor(r() * a.length)];
  return {
    skin: pick(SKIN_TONES),
    shirt: pick([0xc0392b, 0x2980b9, 0x27ae60, 0xf1c40f, 0x8e44ad, 0xecf0f1, 0x34495e, 0xe67e22, 0x16a085, 0xd35400, 0x7f8c8d, 0xff8fa3, 0x111111]),
    pants: pick([0x2b2f3a, 0x1f3a5f, 0x3b3b3b, 0x5a4a3a, 0x7f8c8d, 0xd5c4a1, 0x111111]),
    shoes: pick([0xf2f2f2, 0x222222, 0x6b4a2a, 0xc0392b]),
    hair: pick([0x2a1d14, 0x111111, 0x6b4a2a, 0xb08850, 0x8a8a8a, 0x5a2a1a]),
    hairStyle: r() < 0.4 ? 'long' : 'short',
    build: r() < 0.45 ? 'slim' : 'regular',
    jacket: r() < 0.25 ? pick([0x2c3e50, 0x6d4c41, 0x1b5e20, 0x880e4f, 0x37474f]) : null,
  };
}

export class PedSystem {
  constructor(game) {
    this.g = game;
    this.peds = [];
    this.spawnTimer = 0;
    this._v = new THREE.Vector3();
    const s = game.settings;
    this.renderer = new PedRenderer(game.world.scene, 48, s.preset.lighting, s.get('quality') === 'high' && s.get('shadows'));
    this.buildRings(game.world.layout);
    bus.on('vehicle:crash', (e) => {
      if (e.impact > 5) this.scare(e.x, e.z, 22);
    });
    bus.on('ped:hit', (e) => this.scare(e.x, e.z, 25));
  }

  get maxPeds() {
    return Math.round(44 * this.g.settings.preset.npcDensity);
  }

  // ---------------------------------------------------------------- veredas
  buildRings(L) {
    this.rings = new Map();
    for (const b of L.blocks) {
      const x0 = b.x0 + INSET, x1 = b.x1 - INSET, z0 = b.z0 + INSET, z1 = b.z1 - INSET;
      const w = x1 - x0, d = z1 - z0;
      this.rings.set(`${b.bx},${b.bz}`, { b, x0, x1, z0, z1, w, d, P: 2 * (w + d), corners: [0, w, w + d, 2 * w + d] });
    }
  }

  ringAt(bx, bz) {
    return this.rings.get(`${bx},${bz}`) || null;
  }

  // punto y rumbo sobre el anillo (sentido horario visto desde arriba: N → E → S → O)
  ringPoint(r, s, out) {
    s = ((s % r.P) + r.P) % r.P;
    if (s < r.w) { out.set(r.x0 + s, CURB, r.z0); return Math.PI / 2; }
    s -= r.w;
    if (s < r.d) { out.set(r.x1, CURB, r.z0 + s); return 0; }
    s -= r.d;
    if (s < r.w) { out.set(r.x1 - s, CURB, r.z1); return -Math.PI / 2; }
    s -= r.w;
    out.set(r.x0, CURB, r.z1 - s);
    return Math.PI;
  }

  // parámetro s más cercano a un punto (para volver a la vereda)
  projectRing(r, x, z) {
    const cx = THREE.MathUtils.clamp(x, r.x0, r.x1), cz = THREE.MathUtils.clamp(z, r.z0, r.z1);
    const dN = Math.abs(cz - r.z0), dS = Math.abs(cz - r.z1), dW = Math.abs(cx - r.x0), dE = Math.abs(cx - r.x1);
    const m = Math.min(dN, dS, dW, dE);
    if (m === dN) return cx - r.x0;
    if (m === dE) return r.w + (cz - r.z0);
    if (m === dS) return r.w + r.d + (r.x1 - cx);
    return 2 * r.w + r.d + (r.z1 - cz);
  }

  // Cruces posibles desde una esquina: [{to ring, s destino, eje del semáforo, intersección}]
  crossingsAt(r, cornerIdx) {
    const { bx, bz } = r.b;
    const N = GRID.blocks;
    const out = [];
    const add = (nbx, nbz, nCorner, axis, ix, iz) => {
      if (nbx < 0 || nbz < 0 || nbx >= N || nbz >= N) return;
      if (ix === 0 || ix === N || iz === 0 || iz === N) return; // no cruzar autopistas
      const nr = this.ringAt(nbx, nbz);
      if (!nr) return;
      out.push({ ring: nr, s: nr.corners[nCorner], axis, it: `${ix},${iz}` });
    };
    // esquinas: 0 = NO, 1 = NE, 2 = SE, 3 = SO
    if (cornerIdx === 0) { add(bx, bz - 1, 3, 'z', bx, bz); add(bx - 1, bz, 1, 'x', bx, bz); }
    if (cornerIdx === 1) { add(bx, bz - 1, 2, 'z', bx + 1, bz); add(bx + 1, bz, 0, 'x', bx + 1, bz); }
    if (cornerIdx === 2) { add(bx, bz + 1, 1, 'z', bx + 1, bz + 1); add(bx + 1, bz, 3, 'x', bx + 1, bz + 1); }
    if (cornerIdx === 3) { add(bx, bz + 1, 0, 'z', bx, bz + 1); add(bx - 1, bz, 2, 'x', bx, bz + 1); }
    return out;
  }

  // ---------------------------------------------------------------- aparición
  spawn(focus) {
    const g = this.g;
    for (let tries = 0; tries < 6; tries++) {
      const bx = Math.floor((focus.x - GRID.origin) / GRID.pitch) + Math.floor(Math.random() * 3) - 1;
      const bz = Math.floor((focus.z - GRID.origin) / GRID.pitch) + Math.floor(Math.random() * 3) - 1;
      const r = this.ringAt(bx, bz);
      if (!r) continue;
      if (Math.random() > (DENSITY[r.b.district] ?? 0.5)) continue;
      const s = Math.random() * r.P;
      const p = new THREE.Vector3();
      this.ringPoint(r, s, p);
      const d = Math.hypot(p.x - focus.x, p.z - focus.z);
      if (d < 22 || d > 105) continue;
      if (d < 60 && g.isVisible(p)) continue;
      const rig = new CharacterModel(randomLook(), { rigOnly: true });
      const ped = {
        rig, pos: p, heading: 0, ring: r, s, dir: Math.random() < 0.5 ? 1 : -1,
        lane: (Math.random() - 0.5) * 1.3, speed: 1.1 + Math.random() * 0.5, mode: 'walk', timer: 0,
        vel: new THREE.Vector3(), visible: true, lastCorner: -1, cross: null,
      };
      ped.heading = this.ringPoint(r, s, p) + (ped.dir < 0 ? Math.PI : 0);
      this.peds.push(ped);
      return;
    }
  }

  removePed(ped) {
    const i = this.peds.indexOf(ped);
    if (i >= 0) this.peds.splice(i, 1);
  }

  clear() {
    this.peds.length = 0;
    this.renderer.render(this.peds);
  }

  // ---------------------------------------------------------------- reacciones
  scare(x, z, radius, except) {
    for (const p of this.peds) {
      if (p === except || p.mode === 'down' || p.mode === 'getup') continue;
      const d = Math.hypot(p.pos.x - x, p.pos.z - z);
      if (d < radius) this.flee(p, x, z, 4 + Math.random() * 3);
    }
    if (Math.random() < 0.6) bus.emit('npc:scream', { x, z });
  }

  flee(p, fromX, fromZ, secs) {
    let dx = p.pos.x - fromX, dz = p.pos.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const a = (Math.random() - 0.5) * 1.2;
    const c = Math.cos(a), s = Math.sin(a);
    p.vel.set((dx * c - dz * s) * 4.6, 0, (dx * s + dz * c) * 4.6);
    p.mode = 'flee';
    p.timer = secs;
  }

  knockDown(p, v, playerCar) {
    p.mode = 'down';
    p.timer = 5 + Math.random() * 2;
    p.vel.set(v.vx * 0.55, Math.min(6, v.speed * 0.3), v.vz * 0.55);
    p.downY = 0;
    bus.emit('ped:hit', { x: p.pos.x, z: p.pos.z, byPlayer: playerCar, speed: v.speed });
    if (playerCar) this.g.police.report('hit-and-run', p.pos);
  }

  // ---------------------------------------------------------------- simulación
  update(dt, focus, camera) {
    const g = this.g;
    // aparición / desaparición
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.peds.length < this.maxPeds) {
      this.spawnTimer = 0.15;
      this.spawn(focus);
    }
    for (const p of [...this.peds]) {
      const d = Math.hypot(p.pos.x - focus.x, p.pos.z - focus.z);
      if (d > 135 || (d > 85 && !g.isVisible(p.pos) && p.mode !== 'down')) this.removePed(p);
    }

    const pv = g.playerVehicle;
    const player = g.player.position;
    const onFoot = !pv;
    const col = g.world.collision;
    for (const p of this.peds) {
      const camD = camera.position.distanceTo(p.pos);
      p.visible = camD < 115;
      const near = camD < 60;
      this.react(p, pv, dt);
      let moveSpeed = 0;
      switch (p.mode) {
        case 'walk': moveSpeed = this.walk(p, dt); break;
        case 'idle':
          p.timer -= dt;
          if (p.timer <= 0) { p.mode = 'walk'; if (Math.random() < 0.35) p.dir *= -1; }
          break;
        case 'wait': {
          p.timer -= dt;
          const sig = g.roads.signal(p.cross.it, p.cross.axis);
          if (sig === 'red' || p.timer <= 0) {
            p.mode = 'cross';
            p.cross.to = new THREE.Vector3();
            this.ringPoint(p.cross.ring, p.cross.s, p.cross.to);
          }
          break;
        }
        case 'cross': moveSpeed = this.moveTo(p, p.cross.to, 1.6, dt, () => {
          p.ring = p.cross.ring;
          p.s = p.cross.s;
          p.dir = Math.random() < 0.5 ? 1 : -1;
          p.lastCorner = p.ring.corners.indexOf(p.s);
          p.mode = 'walk';
          p.cross = null;
        }); break;
        case 'talk':
          p.timer -= dt;
          p.heading = Math.atan2(player.x - p.pos.x, player.z - p.pos.z);
          if (p.timer <= 0) p.mode = 'walk';
          break;
        case 'flee': {
          p.timer -= dt;
          p.pos.x += p.vel.x * dt;
          p.pos.z += p.vel.z * dt;
          const n = { x: 0, z: 0 };
          if (col.resolveCylinder(p.pos, 0.3, 1.7, 0.42, n)) {
            // rebotar contra paredes
            const vn = p.vel.x * n.x + p.vel.z * n.z;
            p.vel.x -= 1.8 * vn * n.x; p.vel.z -= 1.8 * vn * n.z;
          }
          p.heading = Math.atan2(p.vel.x, p.vel.z);
          moveSpeed = 4.6;
          if (p.timer <= 0) this.startReturn(p);
          break;
        }
        case 'return': moveSpeed = this.moveTo(p, p.target, 1.5, dt, () => { p.mode = 'walk'; }); break;
        case 'down': {
          p.timer -= dt;
          p.vel.y -= 18 * dt;
          p.pos.x += p.vel.x * dt; p.pos.z += p.vel.z * dt; p.downY = Math.max(0, (p.downY || 0) + p.vel.y * dt);
          p.vel.x *= 1 - Math.min(1, dt * 2.5); p.vel.z *= 1 - Math.min(1, dt * 2.5);
          col.resolveCylinder(p.pos, 0.3, 0.5, 0.42);
          if (p.timer <= 0) { p.mode = 'getup'; p.timer = 0.8; }
          break;
        }
        case 'getup':
          p.timer -= dt;
          if (p.timer <= 0) this.flee(p, p.pos.x + Math.random() - 0.5, p.pos.z + Math.random() - 0.5, 4);
          break;
      }
      // empujón con el jugador a pie
      if (onFoot && p.mode !== 'down') {
        const dx = p.pos.x - player.x, dz = p.pos.z - player.z;
        const dd = Math.hypot(dx, dz);
        if (dd < 0.62 && dd > 1e-3) { p.pos.x += (dx / dd) * (0.62 - dd); p.pos.z += (dz / dd) * (0.62 - dd); }
      }
      // altura del piso (vereda, calle, plaza)
      p.pos.y = p.mode === 'walk' ? CURB : col.groundHeight(p.pos.x, p.pos.z, p.pos.y + 0.45, 0.15);
      // pose
      const root = p.rig.root;
      root.position.set(p.pos.x, p.pos.y + (p.mode === 'down' || p.mode === 'getup' ? 0.12 + (p.downY || 0) : 0), p.pos.z);
      root.rotation.set(0, p.heading, 0);
      if (p.mode === 'down') root.rotation.x = -Math.PI / 2;
      else if (p.mode === 'getup') root.rotation.x = -Math.PI / 2 * Math.max(0, p.timer / 0.8);
      if (near) p.rig.update(dt, moveSpeed, true, 0, moveSpeed > 4);
    }
    this.renderer.render(this.peds);
  }

  walk(p, dt) {
    const r = p.ring;
    const prev = p.s;
    p.s += p.dir * p.speed * dt;
    // ¿pasó por una esquina?
    for (let i = 0; i < 4; i++) {
      const c = r.corners[i];
      const crossed = p.dir > 0 ? (prev < c && p.s >= c) || (c === 0 && p.s >= r.P) : prev > c && p.s <= c;
      if (!crossed || i === p.lastCorner) continue;
      p.lastCorner = i;
      if (Math.random() < 0.35) {
        const opts = this.crossingsAt(r, i);
        if (opts.length) {
          const o = opts[Math.floor(Math.random() * opts.length)];
          p.s = c;
          p.mode = 'wait';
          p.timer = 22;
          p.cross = o;
          return 0;
        }
      }
    }
    if (Math.random() < dt * 0.025) { p.mode = 'idle'; p.timer = 1.5 + Math.random() * 4; }
    p.s = ((p.s % r.P) + r.P) % r.P;
    const base = this.ringPoint(r, p.s, p.pos);
    // carril lateral propio (no todos caminan por la misma línea)
    const nx = Math.cos(base), nz = -Math.sin(base);
    p.pos.x += nx * p.lane; p.pos.z += nz * p.lane;
    p.heading = base + (p.dir < 0 ? Math.PI : 0);
    return p.speed;
  }

  moveTo(p, target, speed, dt, onArrive) {
    const dx = target.x - p.pos.x, dz = target.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.3) { onArrive(); return 0; }
    const step = Math.min(d, speed * dt);
    p.pos.x += (dx / d) * step;
    p.pos.z += (dz / d) * step;
    p.heading = Math.atan2(dx, dz);
    return speed;
  }

  startReturn(p) {
    // volver a la vereda de la manzana más cercana
    const bx = Math.floor((p.pos.x - GRID.origin) / GRID.pitch), bz = Math.floor((p.pos.z - GRID.origin) / GRID.pitch);
    const r = this.ringAt(THREE.MathUtils.clamp(bx, 0, GRID.blocks - 1), THREE.MathUtils.clamp(bz, 0, GRID.blocks - 1));
    if (!r) return this.removePed(p);
    p.ring = r;
    p.s = this.projectRing(r, p.pos.x, p.pos.z);
    p.target = new THREE.Vector3();
    this.ringPoint(r, p.s, p.target);
    p.mode = 'return';
    p.lastCorner = -1;
  }

  // Peligros: autos que se acercan rápido o suben a la vereda, sirenas, atropellos.
  react(p, pv, dt) {
    if (p.mode === 'down' || p.mode === 'getup') return;
    for (const v of this.g.vehicles.vehicles) {
      const dx = p.pos.x - v.pos.x, dz = p.pos.z - v.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 400) continue;
      const sp = v.speed;
      // atropello
      if (sp > 3 && d2 < (v.hl + 1) * (v.hl + 1) && Math.abs(p.pos.y - v.pos.y) < 1.5) {
        const l = v.toLocal(p.pos.x, p.pos.z);
        if (Math.abs(l.x) < v.hw + 0.3 && Math.abs(l.z) < v.hl + 0.3) {
          this.knockDown(p, v, v === pv);
          return;
        }
      }
      if (p.mode === 'flee') continue;
      // auto rápido que viene directo hacia el peatón, o el jugador manejando por la vereda
      const onSidewalk = v.pos.y > 0.08 && sp > 2;
      let inPath = false;
      if (sp > 7 && d2 < 400) {
        const l = v.toLocal(p.pos.x, p.pos.z);
        inPath = v.forwardSpeed > 0 && l.z > 0 && l.z < 4 + sp * 0.8 && Math.abs(l.x) < v.hw + 1.2;
      }
      if (inPath || (onSidewalk && d2 < 160 && v.driver === 'player')) {
        this.flee(p, v.pos.x, v.pos.z, 3 + Math.random() * 2);
        if (Math.random() < 0.15) bus.emit('npc:scream', { x: p.pos.x, z: p.pos.z });
        return;
      }
      if (v.siren && this.g.police.wanted > 0 && d2 < 300 && Math.random() < dt * 0.8) {
        this.flee(p, v.pos.x, v.pos.z, 3);
        return;
      }
    }
  }

  // Hablar con el peatón más cercano (E)
  tryTalk(pos) {
    let best = null, bd = 2.4;
    for (const p of this.peds) {
      if (p.mode !== 'walk' && p.mode !== 'idle' && p.mode !== 'wait') continue;
      const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) return null;
    best.mode = 'talk';
    best.timer = 3.5;
    return LINES[Math.floor(Math.random() * LINES.length)];
  }

  nearestTalkable(pos) {
    for (const p of this.peds) {
      if ((p.mode === 'walk' || p.mode === 'idle' || p.mode === 'wait') && Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) < 2.4) return p;
    }
    return null;
  }

  // peatones en la calle (para que el tráfico frene)
  onRoad() {
    return this.peds.filter((p) => p.mode === 'cross' || p.mode === 'flee' || p.mode === 'return' || p.mode === 'down' || p.mode === 'getup');
  }
}

