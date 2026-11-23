import * as THREE from 'three';
import { bus } from './EventBus.js';
import { Settings } from './Settings.js';
import { Input } from './Input.js';
import { SaveSystem, newGameState } from './SaveSystem.js';
import { World } from '../world/World.js';
import { Player } from '../player/Player.js';
import { CameraSystem } from '../camera/CameraSystem.js';
import { AudioSystem } from '../audio/AudioSystem.js';
import { UI } from '../ui/UI.js';
import { MapSystem } from '../ui/MapSystem.js';

// ============================================================================
// Game: arranque, máquina de estados (carga → menú → juego ↔ pausa/mapa),
// bucle principal con física a paso fijo, límite de FPS y resolución dinámica.
// ============================================================================

const FIXED = 1 / 60;
export const VERSION = '0.1.0';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.version = VERSION;
    this.state = 'loading';
    this.settings = new Settings();
    this.input = new Input(canvas, this.settings);
    this.saves = new SaveSystem();
    this.audio = new AudioSystem(this.settings);
    this.ui = new UI(this);
    this.acc = 0;
    this.last = 0;
    this.lastRender = 0;
    this.dynScale = 1;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.fps = 0;
    this.slowTime = 0;
    this.fastTime = 0;
    this.hudTimer = 0;
    this.mapTimer = 0;
    this.visTimer = 0;
    this.districtTimer = 0;
    this.autosaveTimer = 0;
    this.lastPauseAt = 0;
    this.gameState = null;
  }

  // ------------------------------------------------------------------ arranque
  async boot() {
    try {
      this.createRenderer();
    } catch (err) {
      console.error(err);
      this.ui.showError('Tu navegador o tu placa de video no soportan WebGL, que es necesario para mostrar el mundo 3D.');
      return;
    }
    this.world = new World(this.renderer, this.settings);
    let i = 0;
    const total = 11;
    for (const label of this.world.loadSteps()) {
      this.ui.setLoading(Math.min(0.95, i++ / total), label + '...');
      await nextFrame();
    }
    this.ui.setLoading(0.97, 'Preparando al personaje...');
    await nextFrame();

    this.camera = new THREE.PerspectiveCamera(65, 1, 0.3, 1000);
    this.cameraSystem = new CameraSystem(this.camera, this.world.collision);
    this.player = new Player(this.world, this.input);
    this.world.scene.add(this.player.root);
    this.player.root.visible = false;
    this.map = new MapSystem(this.world.layout);
    document.getElementById('map-legend').innerHTML = this.map.legendHTML();
    this.minimap = document.getElementById('minimap');

    this.bindEvents();
    this.applySettings();
    this.onResize();
    // precalentar shaders para evitar tirones al empezar
    this.world.timeOfDay = 18.3;
    this.cameraSystem.updateMenu(0);
    this.world.update(0, this.camera, this.camera.position);
    this.world.updateVisibility(this.camera.position);
    this.renderer.compile(this.world.scene, this.camera);
    this.ui.setLoading(1, 'Listo');
    await nextFrame();
    this.goToMenu();
    requestAnimationFrame((t) => this.frame(t));
  }

  createRenderer() {
    const preset = this.settings.preset;
    const ok = (() => {
      try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
      } catch {
        return false;
      }
    })();
    if (!ok) throw new Error('WebGL no disponible');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.settings.get('quality') === 'high',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = preset.shadowMapSize >= 2048 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.ui.showError('Se perdió el contexto gráfico (la placa de video se reinició). Recargá la página para seguir; tu partida guardada se conserva.');
    });
  }

  bindEvents() {
    window.addEventListener('resize', () => this.onResize());
    bus.on('settings:changed', ({ key }) => this.applySettings(key));
    bus.on('input:escape', () => this.onEscape());
    bus.on('input:lockchange', (locked) => {
      if (this.state === 'playing') {
        this.ui.showClickToPlay(!locked && !this.input.dragging);
        if (!locked && !this.input.dragging) this.pause();
      }
    });
    bus.on('input:lockerror', () => {
      if (this.state === 'playing') this.ui.showClickToPlay(true);
    });
    bus.on('player:jump', () => this.ui.tutorialProgress('jump', 1));
    bus.on('save:written', ({ ok }) => {
      if (!ok) this.ui.toast('No se pudo guardar (almacenamiento del navegador lleno o bloqueado)');
    });
    // primer gesto del usuario: habilitar audio y música del menú
    const unlock = () => {
      this.audio.unlock();
      if (this.state === 'menu') this.audio.startMusic();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    // guardar al cerrar u ocultar la pestaña
    const autosave = () => {
      if (this.gameState && (this.state === 'playing' || this.state === 'paused' || this.state === 'map')) this.saveGame(false);
    };
    window.addEventListener('beforeunload', autosave);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        autosave();
        if (this.state === 'playing') this.pause();
      }
    });
  }

  applySettings(key) {
    const s = this.settings;
    if (!this.world?.sky) return;
    if (!key || key === 'quality' || key === 'shadows') this.world.applyQuality();
    if (!key || key === 'quality' || key === 'drawDistance') {
      this.camera.far = s.get('drawDistance') + 60;
      this.camera.updateProjectionMatrix();
    }
    if (!key || key === 'quality' || key === 'resolutionScale' || key === 'dynamicResolution') {
      this.dynScale = 1;
      this.onResize();
    }
  }

  onResize() {
    if (!this.renderer) return;
    const preset = this.settings.preset;
    const ratio = Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap) * this.settings.get('resolutionScale') * this.dynScale;
    this.renderer.setPixelRatio(Math.max(0.35, ratio));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    if (this.camera) {
      this.camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
      this.camera.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------------ estados
  goToMenu() {
    this.state = 'menu';
    this.input.setGameActive(false);
    this.input.releaseLock();
    this.cameraSystem.mode = 'menu';
    this.player.root.visible = false;
    this.ui.showHUD(false);
    this.ui.setMenuState(this.saves.hasSave());
    this.ui.showScreen('menu');
    this.world.timeOfDay = 18.3;
    if (this.audio.started) this.audio.startMusic();
  }

  continueGame() {
    const st = this.saves.load();
    if (!st) {
      this.ui.toast('No hay ninguna partida guardada');
      return;
    }
    this.startPlaying(st);
  }

  async requestNewGame() {
    if (this.saves.hasSave()) {
      const ok = await this.ui.confirm('Nueva partida', 'Ya tenés una partida guardada. Si empezás de nuevo se va a reemplazar. ¿Continuar?', 'Empezar de nuevo');
      if (!ok) return;
    }
    const st = newGameState(this.world.layout.spawn);
    this.startPlaying(st);
    this.saveGame(false);
  }

  startPlaying(st) {
    this.gameState = st;
    this.audio.unlock();
    this.audio.stopMusic();
    const p = st.player;
    this.player.spawn(p.x, p.y, p.z, p.yaw);
    this.player.health = st.health;
    this.player.root.visible = true;
    this.world.timeOfDay = st.timeOfDay;
    this.cameraSystem.mode = 'follow';
    this.cameraSystem.snapTo(this.player.position, p.yaw + Math.PI);
    this.ui.lastDistrict = null;
    this.ui.showHUD(true);
    this.resume();
    if (!this.settings.get('tutorialDone')) this.ui.startTutorial();
    this.autosaveTimer = 0;
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.lastPauseAt = performance.now();
    this.input.setGameActive(false);
    this.input.releaseLock();
    this.ui.showClickToPlay(false);
    this.ui.showScreen('pause');
  }

  resume() {
    this.state = 'playing';
    this.ui.showScreen('game');
    this.input.setGameActive(true);
    this.input.context = 'foot';
    this.input.requestLock();
    this.canvas.focus();
  }

  openMap() {
    if (this.state !== 'playing') return;
    this.state = 'map';
    this.input.setGameActive(false);
    this.input.releaseLock();
    this.ui.showScreen('map');
    this.ui.tutorialProgress('map', 1);
  }

  closeMap() {
    if (this.state === 'map') this.resume();
  }

  drawFullMap() {
    const p = this.player;
    this.map.drawFullMap(document.getElementById('map-canvas'), p.position.x, p.position.z, p.yaw);
  }

  onEscape() {
    if (this.ui.dialogOpen) return this.ui.closeDialog(false);
    if (this.state === 'playing') return this.pause();
    if (this.state === 'map') return this.closeMap();
    if (this.state === 'paused') {
      // ignorar el mismo Esc que liberó el mouse
      if (performance.now() - this.lastPauseAt < 350) return;
      if (this.ui.current !== 'pause') return this.ui.back();
      return this.resume();
    }
    if (this.state === 'menu' && this.ui.current !== 'menu') this.ui.back();
  }

  async quitToMenu() {
    this.saveGame(false);
    this.goToMenu();
  }

  // ------------------------------------------------------------------ guardado
  collectState() {
    const st = this.gameState;
    const p = this.player;
    st.player = { x: p.position.x, y: p.position.y, z: p.position.z, yaw: p.yaw };
    st.health = p.health;
    st.timeOfDay = this.world.timeOfDay;
    st.stats.distanceWalked = (st.stats.distanceWalked || 0);
    return st;
  }

  saveGame(manual) {
    if (!this.gameState) return;
    const ok = this.saves.save(this.collectState());
    if (manual) this.ui.toast(ok ? 'Partida guardada' : 'No se pudo guardar');
  }

  async loadGame() {
    const st = this.saves.load();
    if (!st) return this.ui.toast('No hay ninguna partida guardada');
    const ok = await this.ui.confirm('Cargar partida', 'Vas a volver al último guardado. Lo que hiciste después se pierde. ¿Continuar?', 'Cargar');
    if (ok) this.startPlaying(st);
  }

  wipeSave() {
    this.saves.wipe();
    this.ui.toast('Partida borrada');
    this.gameState = null;
    this.goToMenu();
  }

  // ------------------------------------------------------------------ bucle
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    if (now <= this.lastRender) return; // marcas de tiempo fuera de orden
    const limit = this.settings.get('fpsLimit');
    if (limit && now - this.lastRender < 1000 / limit - 1.5) return;
    const dt = Math.min(0.1, (now - (this.lastRender || now)) / 1000);
    this.lastRender = now;
    this.measure(dt);

    if (this.state === 'playing') this.updatePlaying(dt);
    else if (this.state === 'menu') {
      this.cameraSystem.updateMenu(dt);
      this.world.timeOfDay = 18.3 + Math.sin(now * 0.00003) * 0.6;
    }
    if (this.state !== 'loading') {
      const focus = this.state === 'menu' ? this.camera.position : this.player.position;
      this.world.update(this.state === 'playing' ? dt : 0, this.camera, focus);
      this.visTimer -= dt;
      if (this.visTimer <= 0) {
        this.visTimer = 0.25;
        this.world.updateVisibility(this.camera.position);
      }
      this.renderer.render(this.world.scene, this.camera);
    }
    this.input.endFrame();
  }

  updatePlaying(dt) {
    const input = this.input;
    const { dx, dy } = input.consumeMouse();
    if (dx || dy) {
      this.cameraSystem.applyLook(dx, dy);
      this.ui.tutorialProgress('look', Math.abs(dx) + Math.abs(dy));
    }
    if (input.wasPressed('map')) return this.openMap();
    if (input.wasPressed('camera')) this.cameraSystem.cyclePreset();

    // física a paso fijo
    const before = this.player.distance;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= FIXED && steps < 6) {
      this.player.fixedUpdate(FIXED, this.cameraSystem.yaw);
      this.acc -= FIXED;
      steps++;
    }
    if (steps === 6) this.acc = 0;
    const moved = this.player.distance - before;
    if (moved > 0) {
      this.ui.tutorialProgress(input.isDown('sprint') ? 'run' : 'move', moved);
      this.gameState.stats.distanceWalked = (this.gameState.stats.distanceWalked || 0) + moved;
    }
    this.ui.tutorialProgress('free', dt);
    this.player.update(dt);
    this.cameraSystem.update(dt, this.player.root.position, { sprint: this.player.sprinting, run: input.isDown('sprint') && this.player.speed > 3 });
    this.gameState.playTime += dt;

    if (this.player.health <= 0) this.respawn();

    // HUD (10 Hz), minimapa (20 Hz), barrio (2 Hz)
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.ui.updateHUD({
        money: this.gameState.money, time: this.world.timeOfDay, health: this.player.health,
        stamina: this.player.stamina, wanted: 0, fps: this.fps, renderScale: this.settings.get('resolutionScale') * this.dynScale,
      });
    }
    this.mapTimer -= dt;
    if (this.mapTimer <= 0) {
      this.mapTimer = 0.05;
      this.map.drawMinimap(this.minimap, this.player.position.x, this.player.position.z, this.cameraSystem.yaw, this.player.yaw);
    }
    this.districtTimer -= dt;
    if (this.districtTimer <= 0) {
      this.districtTimer = 0.5;
      const d = this.world.districtAt(this.player.position.x, this.player.position.z);
      this.ui.showDistrict(d);
      const busy = d ? { downtown: 1, commercial: 0.8, industrial: 0.6, coastal: 0.4, suburbs: 0.3, rich: 0.2 }[d.id] : 0.1;
      this.audio.setAmbience(busy * (1 - this.world.night * 0.5), d?.id === 'coastal' ? 1 : 0.3);
    }
    this.autosaveTimer += dt;
    if (this.autosaveTimer > 60) {
      this.autosaveTimer = 0;
      this.saveGame(false);
    }
  }

  respawn() {
    const s = this.world.layout.spawn;
    this.ui.toast('Te lastimaste. Despertás en la Avenida Central.', 3.5);
    this.player.spawn(s.x, s.y, s.z, s.yaw);
    this.player.health = 100;
    this.cameraSystem.snapTo(this.player.position, s.yaw + Math.PI);
  }

  // FPS medidos + resolución dinámica
  measure(dt) {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime < 1) return;
    this.fps = Math.round(this.fpsFrames / this.fpsTime);
    this.fpsFrames = 0;
    this.fpsTime = 0;
    if (!this.settings.get('dynamicResolution') || this.state !== 'playing') return;
    const target = this.settings.get('fpsLimit') || 60;
    if (this.fps < target * 0.82) {
      this.slowTime++;
      this.fastTime = 0;
      if (this.slowTime >= 2 && this.dynScale > 0.55) {
        this.dynScale = Math.max(0.55, this.dynScale - 0.1);
        this.slowTime = 0;
        this.onResize();
      }
    } else if (this.fps >= target * 0.97) {
      this.fastTime++;
      this.slowTime = 0;
      if (this.fastTime >= 4 && this.dynScale < 1) {
        this.dynScale = Math.min(1, this.dynScale + 0.05);
        this.fastTime = 0;
        this.onResize();
      }
    }
  }
}

// Cede el control para que la pantalla de carga se actualice. El setTimeout
// evita que la carga se congele si la pestaña está en segundo plano.
function nextFrame() {
  return new Promise((r) => {
    let done = false;
    const go = () => {
      if (!done) {
        done = true;
        r();
      }
    };
    requestAnimationFrame(go);
    setTimeout(go, 60);
  });
}
