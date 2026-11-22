import * as THREE from 'three';
import { bus } from '../core/EventBus.js';

// ============================================================================
// Camera System: tercera persona orbital con seguimiento suave, colisión contra
// edificios (no atraviesa paredes), zoom con rueda/C y modo "menú" cinemático.
// ============================================================================

const PIVOT_H = 1.55;
const SHOULDER = 0.28;
const PRESETS = [3.6, 5.0, 2.4]; // distancias que alterna la tecla C a pie

export class CameraSystem {
  constructor(camera, collision) {
    this.camera = camera;
    this.collision = collision;
    this.yaw = 0;
    this.pitch = -0.18;
    this.distance = PRESETS[0];
    this.presetIndex = 0;
    this.currentDist = this.distance;
    this.pivot = new THREE.Vector3();
    this.mode = 'menu';
    this.menuT = 0;
    this.baseFov = 65;
    this.fovKick = 0;
    this.shake = 0;
    this._tmp = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    bus.on('input:wheel', (d) => {
      if (this.mode !== 'follow') return;
      this.distance = THREE.MathUtils.clamp(this.distance + d * 0.5, 1.8, 7);
    });
  }

  cyclePreset() {
    this.presetIndex = (this.presetIndex + 1) % PRESETS.length;
    this.distance = PRESETS[this.presetIndex];
  }

  snapTo(target, yaw) {
    this.yaw = yaw;
    this.pitch = -0.18;
    this.pivot.set(target.x, target.y + PIVOT_H, target.z);
    this.currentDist = this.distance;
  }

  // mouse en píxeles ya escalado por sensibilidad
  applyLook(dx, dy) {
    this.yaw -= dx * 0.0026;
    this.pitch -= dy * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.25, 0.95);
  }

  update(dt, target, opts = {}) {
    const cam = this.camera;
    if (this.mode === 'menu') return this.updateMenu(dt);

    // pivote siguiendo al jugador con un leve retraso
    const k = 1 - Math.exp(-dt * 14);
    this._tmp.set(target.x, target.y + PIVOT_H, target.z);
    this.pivot.lerp(this._tmp, k);
    // si se aleja demasiado (teletransporte), saltar
    if (this.pivot.distanceToSquared(this._tmp) > 25) this.pivot.copy(this._tmp);

    // dirección desde el pivote hacia la cámara
    const cp = Math.cos(this.pitch);
    const dir = this._dir.set(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    // hombro: desplazamiento lateral para ver mejor hacia adelante
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const origin = this._tmp.set(this.pivot.x + rx * SHOULDER, this.pivot.y, this.pivot.z + rz * SHOULDER);

    // colisión: rayo desde el pivote hasta la posición deseada
    const want = this.distance;
    const ex = origin.x + dir.x * want, ey = origin.y + dir.y * want, ez = origin.z + dir.z * want;
    const t = this.collision.raycast(origin.x, origin.y, origin.z, ex, ey, ez, 0.25);
    const allowed = Math.max(0.35, want * t - 0.1);
    // acercarse de inmediato; alejarse suave
    if (allowed < this.currentDist) this.currentDist = allowed;
    else this.currentDist += (allowed - this.currentDist) * (1 - Math.exp(-dt * 4));

    cam.position.set(origin.x + dir.x * this.currentDist, origin.y + dir.y * this.currentDist, origin.z + dir.z * this.currentDist);
    // no bajar del piso
    const floor = this.collision.groundHeight(cam.position.x, cam.position.z, cam.position.y, 0) + 0.25;
    if (cam.position.y < floor) cam.position.y = floor;

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 3);
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.15;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.15;
    }
    cam.lookAt(origin.x - dir.x * 2, origin.y - dir.y * 2 + 0.05, origin.z - dir.z * 2);

    // leve aumento del FOV al correr
    const fovTarget = this.baseFov + (opts.sprint ? 7 : opts.run ? 3 : 0);
    this.fovKick += (fovTarget - this.fovKick - this.baseFov) * (1 - Math.exp(-dt * 4));
    const fov = this.baseFov + this.fovKick;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  // Cámara cinemática que recorre la ciudad detrás del menú principal.
  updateMenu(dt) {
    this.menuT += dt * 0.025;
    const t = this.menuT;
    const r = 260 + Math.sin(t * 0.7) * 60;
    const cam = this.camera;
    cam.position.set(Math.cos(t) * r + 40, 85 + Math.sin(t * 1.3) * 25, Math.sin(t) * r);
    cam.lookAt(Math.cos(t + 0.6) * 60, 30, Math.sin(t + 0.6) * 60);
    if (cam.fov !== 55) {
      cam.fov = 55;
      cam.updateProjectionMatrix();
    }
  }

  get forwardYaw() {
    return this.yaw;
  }
}
