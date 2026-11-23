import * as THREE from 'three';
import { CharacterModel } from '../player/CharacterModel.js';
import { ScriptedDriver } from './ScriptedDriver.js';
import { bus } from '../core/EventBus.js';

// ============================================================================
// Mission System modular.
// Cada misión es un objeto con pasos. Un paso puede tener:
//   text        objetivo que se muestra en pantalla
//   dialog      [[personaje, frase], ...] (el paso espera a que termine)
//   enter(ctx)  al empezar el paso
//   update(ctx, dt) → true (siguiente paso) | 'texto' (falla con ese motivo)
// La misión también puede definir check(ctx) (condiciones de fracaso globales)
// y cleanup(ctx). Todo lo que se crea con ctx.* se limpia solo al terminar.
// Agregar una misión nueva = agregar un objeto en story.js.
// ============================================================================

export class MissionSystem {
  constructor(game, story) {
    this.g = game;
    this.story = story;
    this.defs = story.missions;
    this.active = null;
    this.starts = new Map(); // id -> { marker, npc }
    this.retry = null;
    this.subQueue = [];
    this.subTimer = 0;
    this.prompt = null;
    bus.on('police:busted', () => this.active && this.fail('Te arrestó la policía'));
    bus.on('player:wasted', () => this.active && this.fail('Quedaste herido'));
  }

  completed(id) {
    return this.g.gameState?.completedMissions.includes(id);
  }

  available(def) {
    if (this.completed(def.id)) return false;
    if (def.requires && !def.requires.every((r) => this.completed(r))) return false;
    if (def.character && def.character !== this.g.protagonist.current) return false;
    return true;
  }

  // ---------------------------------------------------------------- inicio
  update(dt) {
    this.updateSubtitles(dt);
    if (this.active) return this.updateActive(dt);
    this.prompt = null;
    // marcadores de inicio de misiones disponibles
    // un solo marcador por personaje (la primera misión disponible de cada uno)
    const givers = new Set();
    for (const def of this.defs) {
      const has = this.starts.has(def.id);
      const ok = this.available(def) && !givers.has(def.giver);
      if (ok) givers.add(def.giver);
      if (ok && !has) this.createStart(def);
      else if (!ok && has) this.removeStart(def.id);
      if (this.starts.has(def.id)) this.starts.get(def.id).shown = true;
    }
    const p = this.g.playerVehicle ? null : this.g.player.position;
    for (const [id, s] of this.starts) {
      if (!s.shown) continue;
      s.npc?.model.update(dt, 0, true, 0, false);
      if (s.npc) {
        // el personaje mira al jugador cuando está cerca
        const pp = this.g.player.position;
        if (Math.hypot(pp.x - s.npc.x, pp.z - s.npc.z) < 12) s.npc.model.root.rotation.y = Math.atan2(pp.x - s.npc.x, pp.z - s.npc.z);
      }
      if (p && this.g.markers.inside(s.marker, p) && this.g.police.wanted === 0) {
        const def = this.defs.find((d) => d.id === id);
        this.prompt = `<kbd>${this.g.keyLabel('interact')}</kbd> ${def.giverVerb || 'Hablar con'} ${this.story.characters[def.giver].name} · <b>${def.title}</b>`;
        if (this.g.input.wasPressed('interact')) return this.start(def);
      }
    }
    if (p && this.g.markers.markers.size && this.g.police.wanted > 0) {
      for (const s of this.starts.values()) if (this.g.markers.inside(s.marker, p)) this.prompt = 'Perdé a la policía antes de empezar una misión';
    }
    // reintento
    if (this.retry) {
      this.retry.t -= dt;
      if (this.retry.t <= 0) this.retry = null;
      else if (this.g.input.wasPressed('interact') && this.g.police.wanted === 0) {
        const def = this.retry.def;
        this.retry = null;
        this.g.ui.hideBigMessage();
        const s = def.start;
        this.g.teleportPlayer(s.x + 2, s.z + 2, 0);
        this.start(def);
      } else this.prompt = `<kbd>${this.g.keyLabel('interact')}</kbd> Reintentar misión (${Math.ceil(this.retry.t)})`;
    }
  }

  createStart(def) {
    const giver = this.story.characters[def.giver];
    const s = def.start;
    const marker = this.g.markers.add(s.x, s.y ?? 0.15, s.z, { color: giver.color, radius: 1.4, height: 5, label: giver.initial });
    let npc = null;
    if (giver.look) {
      const model = new CharacterModel(giver.look);
      const nx = s.x + (s.npcDx ?? 1.6), nz = s.z + (s.npcDz ?? 0);
      model.root.position.set(nx, s.y ?? 0.15, nz);
      model.root.rotation.y = s.npcYaw ?? -Math.PI / 2;
      this.g.world.scene.add(model.root);
      npc = { model, x: nx, z: nz };
      this.g.world.collision.addBox(nx - 0.3, 0, nz - 0.3, nx + 0.3, 1.8, nz + 0.3, 'prop');
    }
    this.starts.set(def.id, { marker, npc, def });
  }

  removeStart(id) {
    const s = this.starts.get(id);
    if (!s) return;
    this.g.markers.remove(s.marker);
    if (s.npc) {
      this.g.world.scene.remove(s.npc.model.root);
      s.npc.model.dispose();
    }
    this.starts.delete(id);
  }

  clearStarts() {
    for (const id of [...this.starts.keys()]) this.removeStart(id);
  }

  // ---------------------------------------------------------------- ejecución
  start(def) {
    this.clearStarts();
    this.retry = null;
    const ctx = this.makeContext(def);
    this.active = { def, ctx, step: -1, stepT: 0 };
    this.g.ui.missionBanner(def.title, this.story.characters[def.giver].name);
    this.g.audio.jingle('start');
    this.next();
  }

  next() {
    const a = this.active;
    const prev = a.def.steps[a.step];
    prev?.exit?.(a.ctx);
    a.step++;
    a.stepT = 0;
    if (a.step >= a.def.steps.length) return this.pass();
    const step = a.def.steps[a.step];
    a.dialogDone = !step.dialog;
    if (step.dialog) {
      this.subQueue = step.dialog.map(([who, line]) => ({ who, line, t: Math.min(6, 2.2 + line.length * 0.045) }));
      this.subTimer = 0;
      this.showNextSub();
    }
    a.ctx.objective(typeof step.text === 'function' ? step.text(a.ctx) : step.text || '');
    step.enter?.(a.ctx);
  }

  updateActive(dt) {
    const a = this.active;
    const ctx = a.ctx;
    a.stepT += dt;
    ctx.stepTime = a.stepT;
    // temporizador global
    if (ctx.timeLeft != null) {
      ctx.timeLeft -= dt;
      this.g.ui.setTimer(ctx.timeLeft);
      if (ctx.timeLeft <= 0) return this.fail('Se acabó el tiempo');
    }
    const fail = a.def.check?.(ctx);
    if (typeof fail === 'string') return this.fail(fail);
    const step = a.def.steps[a.step];
    if (step.dialog && !a.dialogDone) {
      if (this.subQueue.length === 0 && this.subTimer <= 0) a.dialogDone = true;
      if (!step.update) return;
    }
    const res = step.update ? step.update(ctx, dt) : a.dialogDone;
    if (!this.active) return; // la misión pudo terminar dentro del paso
    if (typeof res === 'string') return this.fail(res);
    if (res === true && a.dialogDone) this.next();
    // GPS dinámico
    if (ctx.gpsTarget) {
      const t = ctx.gpsTarget.pos || ctx.gpsTarget;
      this.g.setGps(t);
    }
  }

  fixedUpdate(dt) {
    if (!this.active) return;
    const others = this.g.vehicles.vehicles;
    for (const d of this.active.ctx.tracked.drivers) if (!d.v.dead && d.v.driver !== 'player') d.update(dt, others);
  }

  pass() {
    const a = this.active;
    const reward = typeof a.def.reward === 'function' ? a.def.reward(a.ctx) : a.def.reward;
    a.def.cleanup?.(a.ctx);
    this.cleanup(a.ctx);
    this.active = null;
    const st = this.g.gameState;
    st.completedMissions.push(a.def.id);
    this.g.addMoney(reward);
    this.g.ui.bigMessage('MISIÓN SUPERADA', `${a.def.title} · +$${reward.toLocaleString('es-AR')}`, 'pass');
    this.g.audio.jingle('pass');
    this.g.ui.objective(null);
    this.g.ui.setTimer(null);
    this.g.ui.missionInfo(null);
    this.g.setGps(null);
    this.g.saveGame(false);
    bus.emit('mission:passed', a.def.id);
    if (a.def.after) this.g.ui.toast(a.def.after, 5);
  }

  fail(reason) {
    const a = this.active;
    if (!a) return;
    a.def.cleanup?.(a.ctx);
    this.cleanup(a.ctx);
    this.active = null;
    this.g.ui.bigMessage('MISIÓN FALLIDA', reason, 'fail');
    this.g.audio.jingle('fail');
    this.g.ui.objective(null);
    this.g.ui.setTimer(null);
    this.g.ui.missionInfo(null);
    this.g.setGps(null);
    this.subQueue = [];
    this.g.ui.subtitle(null);
    this.retry = { def: a.def, t: 12 };
    bus.emit('mission:failed', a.def.id);
  }

  abort() {
    if (!this.active) return;
    const a = this.active;
    a.def.cleanup?.(a.ctx);
    this.cleanup(a.ctx);
    this.active = null;
    this.g.ui.objective(null);
    this.g.ui.setTimer(null);
    this.g.ui.missionInfo(null);
    this.g.setGps(null);
    this.subQueue = [];
    this.g.ui.subtitle(null);
  }

  cleanup(ctx) {
    const T = ctx.tracked;
    for (const m of T.markers) this.g.markers.remove(m);
    for (const v of T.vehicles) {
      if (v === this.g.playerVehicle) { v.kind = 'free'; continue; }
      if (this.g.vehicles.vehicles.includes(v)) this.g.vehicles.remove(v);
    }
    for (const n of T.npcs) {
      this.g.world.scene.remove(n.root);
      n.dispose();
    }
    T.markers = []; T.vehicles = []; T.drivers = []; T.npcs = [];
  }

  // ---------------------------------------------------------------- subtítulos
  say(who, line, secs) {
    this.subQueue.push({ who, line, t: secs ?? Math.min(6, 2.2 + line.length * 0.045) });
    if (this.subTimer <= 0) this.showNextSub();
  }

  showNextSub() {
    const s = this.subQueue.shift();
    if (!s) {
      this.g.ui.subtitle(null);
      this.subTimer = 0;
      return;
    }
    const who = s.who === 'yo' ? this.g.protagonist.current : s.who;
    const c = this.story.characters[who];
    this.g.ui.subtitle(c ? c.name : who, s.line, c ? c.color : '#ffffff');
    this.subTimer = s.t;
  }

  updateSubtitles(dt) {
    if (this.subTimer > 0) {
      this.subTimer -= dt;
      if (this.subTimer <= 0) this.showNextSub();
    }
  }

  // ---------------------------------------------------------------- contexto
  makeContext(def) {
    const g = this.g;
    const self = this;
    const ctx = {
      g, def, vars: {}, timeLeft: null, gpsTarget: null, stepTime: 0,
      tracked: { markers: [], vehicles: [], drivers: [], npcs: [] },
      get pos() { return g.playerVehicle ? g.playerVehicle.pos : g.player.position; },
      get vehicle() { return g.playerVehicle; },
      get wanted() { return g.police.wanted; },
      setWanted: (n) => g.police.setWanted(n, g.player.position),
      marker(x, z, opts = {}) {
        const y = opts.y ?? g.world.collision.groundHeight(x, z, 2, 0);
        const m = g.markers.add(x, y, z, opts);
        ctx.tracked.markers.push(m);
        return m;
      },
      removeMarker(m) {
        g.markers.remove(m);
        ctx.tracked.markers = ctx.tracked.markers.filter((q) => q !== m);
      },
      inside(m, extra = 0) { return g.markers.inside(m, ctx.pos, extra); },
      car(type, color, x, z, h, opts = {}) {
        // despejar el lugar (autos estacionados o del tráfico)
        for (const o of [...g.vehicles.vehicles]) {
          if (o === g.playerVehicle || o.kind === 'mission' || o.kind === 'police') continue;
          if (Math.hypot(o.pos.x - x, o.pos.z - z) < 7) g.vehicles.remove(o);
        }
        const v = g.vehicles.spawn(type, color, x, z, h, { kind: 'mission', awake: !!opts.awake });
        if (v) ctx.tracked.vehicles.push(v);
        return v;
      },
      drive(v, points, opts = {}) {
        const d = new ScriptedDriver(v, points, { laneFn: opts.offset == null ? g.routes.laneOffset : null, ...opts });
        ctx.tracked.drivers.push(d);
        return d;
      },
      route: (a, b) => g.routes.route(a, b),
      npc(x, z, yaw, look) {
        const m = new CharacterModel(look);
        m.root.position.set(x, g.world.collision.groundHeight(x, z, 2, 0), z);
        m.root.rotation.y = yaw;
        g.world.scene.add(m.root);
        ctx.tracked.npcs.push(m);
        return m;
      },
      gps(t) { ctx.gpsTarget = t; if (!t) g.setGps(null); },
      say: (who, line, secs) => self.say(who, line, secs),
      timer(sec) { ctx.timeLeft = sec; if (sec == null) g.ui.setTimer(null); },
      objective: (text) => g.ui.objective(text),
      info: (text) => g.ui.missionInfo(text),
      flash: (text, sub, secs) => g.ui.bigMessage(text, sub || '', 'info', secs || 1.5),
      inVehicle: (v) => (v ? g.playerVehicle === v : !!g.playerVehicle),
      near: (p, r) => Math.hypot(ctx.pos.x - p.x, ctx.pos.z - p.z) < r,
      jingle: (k) => g.audio.jingle(k),
    };
    return ctx;
  }

  // marcadores para minimapa
  blips() {
    const out = [];
    if (!this.active) {
      for (const s of this.starts.values()) {
        const giver = this.story.characters[s.def.giver];
        out.push({ x: s.marker.x, z: s.marker.z, color: giver.color, size: 6, label: giver.initial, edge: true });
      }
    } else {
      for (const m of this.active.ctx.tracked.markers) out.push({ x: m.x, z: m.z, color: m.color, size: 5, label: m.label, edge: true });
      for (const v of this.active.ctx.tracked.vehicles) if (v.blip) out.push({ x: v.pos.x, z: v.pos.z, color: v.blip, size: 5, edge: true });
    }
    return out;
  }
}
