import * as THREE from 'three';
import { CharacterModel } from './CharacterModel.js';
import { bus } from '../core/EventBus.js';

// ============================================================================
// Player Controller (a pie): aceleración gradual, giro suave hacia la dirección
// de movimiento, salto con gravedad, subida automática de cordones/escalones,
// colisiones contra la ciudad y stamina para el sprint.
// ============================================================================

const WALK = 2.0, RUN = 5.0, SPRINT = 7.2;
const ACCEL = 16, DECEL = 20, AIR_CONTROL = 4;
const GRAVITY = 24, JUMP_V = 6.6;
const RADIUS = 0.34, HEIGHT = 1.8, STEP = 0.42;
const TURN_RATE = 11;

export class Player {
  constructor(world, input) {
    this.world = world;
    this.input = input;
    this.model = new CharacterModel();
    this.root = this.model.root;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0; // dirección a la que mira el cuerpo
    this.grounded = true;
    this.visualY = 0;
    this.stamina = 1;
    this.runHeld = 0;
    this.sprinting = false;
    this.health = 100;
    this.airTime = 0;
    this.distance = 0;
    this.enabled = true;
    this._n = { x: 0, z: 0 };
    this._wish = new THREE.Vector3();
    this.camYaw = 0;
    this.anim = { turn: 0, accel: 0, lookYaw: 0, prevYaw: 0, prevSpeed: 0 };
  }

  // Cambiar de protagonista: otro modelo, mismo controlador.
  setModel(model) {
    const parent = this.root.parent;
    const visible = this.root.visible;
    if (parent) parent.remove(this.root);
    this.model = model;
    this.root = model.root;
    this.root.visible = visible;
    if (parent) parent.add(this.root);
    this.syncModel();
  }

  spawn(x, y, z, yaw) {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.visualY = y;
    const g = this.world.collision.groundHeight(x, z, y + 2, RADIUS * 0.6);
    this.position.y = Math.max(y, g);
    this.visualY = this.position.y;
    this.grounded = true;
    this.syncModel();
  }

  get speed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  // cameraYaw: orientación horizontal de la cámara (para mover relativo a la vista)
  fixedUpdate(dt, cameraYaw) {
    this.camYaw = cameraYaw;
    const input = this.input;
    const col = this.world.collision;
    // ---- intención de movimiento ----
    const f = input.axis('back', 'forward');
    const r = input.axis('left', 'right');
    const wish = this._wish.set(0, 0, 0);
    if (f || r) {
      const fx = -Math.sin(cameraYaw), fz = -Math.cos(cameraYaw);
      const rx = Math.cos(cameraYaw), rz = -Math.sin(cameraYaw);
      wish.set(fx * f + rx * r, 0, fz * f + rz * r).normalize();
    }
    const moving = wish.lengthSq() > 0;
    const runKey = input.isDown('sprint');
    this.runHeld = runKey && moving ? this.runHeld + dt : 0;
    // mantener Shift > 1.2 s = sprint mientras haya stamina
    if (this.runHeld > 1.2 && this.stamina > 0.05) this.sprinting = true;
    if (!runKey || !moving || this.stamina <= 0) this.sprinting = false;
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - dt * 0.12);
    else this.stamina = Math.min(1, this.stamina + dt * (moving ? 0.1 : 0.2));
    const target = !moving ? 0 : this.sprinting ? SPRINT : runKey ? RUN : WALK;

    // ---- aceleración horizontal ----
    const vx = this.velocity.x, vz = this.velocity.z;
    const tx = wish.x * target, tz = wish.z * target;
    const rate = this.grounded ? (moving ? ACCEL : DECEL) : AIR_CONTROL;
    const dx = tx - vx, dz = tz - vz;
    const dl = Math.hypot(dx, dz);
    const maxStep = rate * dt;
    if (dl <= maxStep) { this.velocity.x = tx; this.velocity.z = tz; }
    else { this.velocity.x += (dx / dl) * maxStep; this.velocity.z += (dz / dl) * maxStep; }
    // en el aire no se frena del todo
    if (!this.grounded && !moving) { this.velocity.x = vx * 0.995; this.velocity.z = vz * 0.995; }

    // ---- giro suave del cuerpo hacia la dirección de avance ----
    const sp = this.speed;
    if (sp > 0.15 && moving) {
      const targetYaw = Math.atan2(wish.x, wish.z);
      let d = targetYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const turn = TURN_RATE * (this.grounded ? 1 : 0.4) * dt;
      this.yaw += THREE.MathUtils.clamp(d, -turn, turn) * Math.min(1, 0.35 + Math.abs(d));
    }

    // ---- salto y gravedad ----
    if (this.grounded && input.wasPressed('jump')) {
      this.velocity.y = JUMP_V;
      this.grounded = false;
      bus.emit('player:jump');
    }
    this.velocity.y -= GRAVITY * dt;

    // ---- integración + colisiones ----
    const p = this.position;
    const prevX = p.x, prevZ = p.z;
    p.x += this.velocity.x * dt;
    p.z += this.velocity.z * dt;
    p.y += this.velocity.y * dt;
    if (col.resolveCylinder(p, RADIUS, HEIGHT, STEP, this._n)) {
      // quitar la componente de velocidad contra la pared (deslizar)
      const vn = this.velocity.x * this._n.x + this.velocity.z * this._n.z;
      if (vn < 0) { this.velocity.x -= vn * this._n.x; this.velocity.z -= vn * this._n.z; }
    }
    // techo
    const ground = col.groundHeight(p.x, p.z, p.y + STEP, RADIUS * 0.55);
    if (p.y <= ground + 0.001 && this.velocity.y <= 0) {
      const fall = -this.velocity.y;
      if (!this.grounded) {
        this.model.land(fall);
        bus.emit('player:land', fall);
        if (fall > 15) this.damage((fall - 15) * 6);
      }
      p.y = ground;
      this.velocity.y = 0;
      this.grounded = true;
      this.airTime = 0;
    } else if (this.grounded && p.y - ground < STEP && this.velocity.y <= 0) {
      // bajar escalones / cordones sin "despegar"
      p.y = ground;
      this.velocity.y = 0;
    } else {
      this.grounded = false;
      this.airTime += dt;
    }
    this.distance += Math.hypot(p.x - prevX, p.z - prevZ);
  }

  damage(amount) {
    this.health = Math.max(0, this.health - amount);
    bus.emit('player:damage', amount);
  }

  // Interpolación visual y animación (cada frame de render)
  update(dt) {
    // suaviza los saltos de altura al subir un cordón
    const k = 1 - Math.exp(-dt * 18);
    this.visualY += (this.position.y - this.visualY) * (this.grounded ? k : 1);
    this.syncModel();
    // datos para la animación: velocidad de giro, aceleración y hacia dónde mira la cámara
    const A = this.anim;
    if (dt > 0) {
      const sp = this.speed;
      const turn = Math.atan2(Math.sin(this.yaw - A.prevYaw), Math.cos(this.yaw - A.prevYaw)) / dt;
      A.turn += (turn - A.turn) * Math.min(1, dt * 10);
      A.accel += ((sp - A.prevSpeed) / dt - A.accel) * Math.min(1, dt * 8);
      A.prevYaw = this.yaw;
      A.prevSpeed = sp;
    }
    const rel = this.camYaw + Math.PI - this.yaw;
    A.lookYaw = Math.atan2(Math.sin(rel), Math.cos(rel));
    const step = this.model.update(dt, this.speed, this.grounded, this.velocity.y, this.sprinting, A);
    if (step) bus.emit('player:footstep', { speed: this.speed, x: this.position.x, z: this.position.z });
  }

  syncModel() {
    this.root.position.set(this.position.x, this.visualY, this.position.z);
    this.root.rotation.y = this.yaw;
  }

  get headPosition() {
    return new THREE.Vector3(this.position.x, this.visualY + 1.6, this.position.z);
  }
}
