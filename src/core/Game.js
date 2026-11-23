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
import { SurfaceMap } from '../world/SurfaceMap.js';
import { Particles } from '../effects/Particles.js';
import { VehicleSystem } from '../vehicles/VehicleSystem.js';
import { RoadGraph } from '../traffic/RoadGraph.js';
import { TrafficSystem } from '../traffic/TrafficSystem.js';
import { TrafficLights } from '../traffic/TrafficLights.js';
import { RouteFinder, MarkerSystem } from '../navigation/Navigation.js';
import { PoliceSystem } from '../police/PoliceSystem.js';
import { MissionSystem } from '../missions/MissionSystem.js';
import { buildStory } from '../missions/story.js';
import { ProtagonistSystem, PROTAGONISTS, LARA_START } from '../player/Protagonists.js';
import { PedSystem } from '../npc/PedSystem.js';
import { Radio, STATIONS } from '../audio/Radio.js';
import { Economy } from '../economy/Economy.js';
import { Vehicle } from '../vehicles/Vehicle.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// Lugares de reaparición
const POLICE_STATION = { x: -92, z: 140, yaw: Math.PI / 2, name: 'Comisaría Central' };
const HOSPITAL = { x: 208, z: -62, yaw: -Math.PI / 2, name: 'Hospital San Vega' };

// ============================================================================
// Game: arranque, máquina de estados (carga → menú → juego ↔ pausa/mapa),
// bucle principal con física a paso fijo, límite de FPS y resolución dinámica.
// ============================================================================

const FIXED = 1 / 60;
export const VERSION = '0.7.0';

const WEATHER_ICONS = { clear: '☀', cloudy: '☁', rain: '☂', storm: '⚡' };

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
    this.ui.setLoading(0.93, 'Preparando vehículos y tráfico...');
    await nextFrame();
    const layout = this.world.layout;
    this.surfaces = new SurfaceMap(layout);
    this.particles = new Particles(this.world.scene, this.settings.get('quality') === 'low' ? 300 : 700);
    this.particles.enabled = this.settings.preset.effects;
    this.vehicles = new VehicleSystem(this.world, this.settings, this.surfaces, this.particles);
    this.roads = new RoadGraph(layout);
    this.traffic = new TrafficSystem(this.roads, this.vehicles, this.settings);
    this.trafficLights = new TrafficLights(this.world.scene, layout, this.roads);
    this.playerVehicle = null;
    this.routes = new RouteFinder(layout);
    this.markers = new MarkerSystem(this.world.scene);
    this.police = new PoliceSystem(this);
    this.protagonist = new ProtagonistSystem();
    this.story = buildStory();
    this.missions = new MissionSystem(this, this.story);
    this.gps = { target: null, timer: 0, last: null };
    this.peds = new PedSystem(this);
    this.radio = new Radio(this.audio);
    this.radioIndex = Math.floor(Math.random() * STATIONS.length);
    this.economy = new Economy(this);
    this.world.weather.onThunder = (power) => {
      this.audio.thunder(power);
      if (power > 0.75) this.cameraSystem.shake = Math.max(this.cameraSystem.shake, 0.12);
    };
    layout.landmarks.push(
      { name: POLICE_STATION.name, x: POLICE_STATION.x, z: POLICE_STATION.z, type: 'police' },
      { name: HOSPITAL.name, x: HOSPITAL.x, z: HOSPITAL.z, type: 'hospital' },
      { name: 'Taller Duarte', x: -108, z: 66, type: 'shop' },
    );
    this.ui.setLoading(0.97, 'Preparando al personaje...');
    await nextFrame();

    this.camera = new THREE.PerspectiveCamera(65, 1, 0.3, 1000);
    this.cameraSystem = new CameraSystem(this.camera, this.world.collision);
    this.player = new Player(this.world, this.input);
    this.player.setModel(this.protagonist.model('nico'));
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
    bus.on('vehicle:crash', (e) => {
      const d = this.camera.position.distanceTo(new THREE.Vector3(e.x, e.y, e.z));
      if (d < 70) this.audio.crash(e.impact * (1 - d / 70));
      this.particles.emit('spark', e.x, e.y, e.z, 0, 2, 0, Math.min(25, 4 + e.impact * 1.2), 3.5);
      if (e.impact > 6) this.particles.emit('debris', e.x, e.y, e.z, 0, 2, 0, Math.min(10, e.impact * 0.5), 3);
      if (this.playerVehicle && (e.vehicle === this.playerVehicle || e.other === this.playerVehicle)) {
        this.cameraSystem.shake = Math.min(1.5, e.impact * 0.08);
      }
    });
    bus.on('vehicle:horn', (e) => {
      const p = this.player.position;
      this.audio.distantHorn(Math.hypot(e.x - p.x, e.z - p.z));
    });
    bus.on('police:busted', () => this.busted());
    bus.on('police:wanted', ({ level, prev }) => {
      if (level > prev) this.audio.jingle('star');
    });
    bus.on('police:evaded', () => this.ui.toast('Perdiste a la policía'));
    bus.on('vehicle:crash', (e) => {
      // embestir a la policía es delito; los choques graves también si te ven
      const pv = this.playerVehicle;
      if (!pv || (e.vehicle !== pv && e.other !== pv)) return;
      const other = e.vehicle === pv ? e.other : e.vehicle;
      if (other && other.kind === 'police' && e.impact > 3) this.police.report('assault-police', pv.pos);
      else if (other && other.kind === 'traffic' && e.impact > 9) this.police.report('reckless', pv.pos);
    });
    bus.on('vehicle:destroyed', (v) => {
      if (v === this.playerVehicle) this.ui.toast('El auto quedó destruido. Bajate con ' + this.keyLabel('vehicle') + '.', 3.5);
    });
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
    if (this.particles && (!key || key === 'quality')) this.particles.enabled = s.preset.effects;
    if (!key || key === 'quality' || key === 'bloom') this.setupBloom();
  }

  // Brillo (bloom): render a una textura HDR + halo alrededor de las luces fuertes.
  setupBloom() {
    if (!this.settings.get('bloom')) {
      this.composer = null;
      return;
    }
    try {
      if (!this.composerObj) {
        const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
          type: THREE.HalfFloatType,
          samples: this.settings.get('quality') === 'high' ? 4 : 0,
        });
        const c = new EffectComposer(this.renderer, rt);
        c.addPass(new RenderPass(this.world.scene, this.camera));
        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.45, 1);
        // el halo se calcula a menor resolución (es borroso igual): mucho más barato
        const bloomSize = this.bloomPass.setSize.bind(this.bloomPass);
        this.bloomPass.setSize = (w, h) => {
          const f = this.settings.get('quality') === 'high' ? 1 : 0.5;
          bloomSize(Math.max(64, Math.round(w * f)), Math.max(64, Math.round(h * f)));
        };
        c.addPass(this.bloomPass);
        c.addPass(new OutputPass());
        this.composerObj = c;
      }
      this.composer = this.composerObj;
      this.resizeComposer();
    } catch (err) {
      console.warn('Bloom no disponible', err);
      this.composer = null;
    }
  }

  resizeComposer() {
    if (!this.composer) return;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  keyLabel(action) {
    const code = this.settings.get('bindings')[action][0];
    return code.startsWith('Key') ? code.slice(3) : code;
  }

  onResize() {
    if (!this.renderer) return;
    const preset = this.settings.preset;
    const ratio = Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap) * this.settings.get('resolutionScale') * this.dynScale;
    this.renderer.setPixelRatio(Math.max(0.35, ratio));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.resizeComposer();
    if (this.camera) {
      this.camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
      this.camera.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------------ estados
  goToMenu() {
    if (this.playerVehicle) this.leaveVehicleImmediately();
    this.audio.stopEngine();
    this.ui.setPrompt(null);
    this.state = 'menu';
    this.input.setGameActive(false);
    this.input.releaseLock();
    this.cameraSystem.mode = 'menu';
    this.player.root.visible = false;
    this.ui.showHUD(false);
    this.ui.setMenuState(this.saves.hasSave());
    this.ui.showScreen('menu');
    this.world.timeOfDay = 18.3;
    this.world.weather.set('clear', true);
    if (this.audio.started) this.audio.startMusic();
    this.audio.setRain(0, false);
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
    if (this.playerVehicle) this.leaveVehicleImmediately();
    this.missions.abort();
    this.missions.clearStarts();
    this.missions.retry = null;
    this.police.reset();
    // partidas viejas: completar datos de los protagonistas
    st.current = st.current || 'nico';
    st.characters = st.characters || {};
    st.characters.nico = st.characters.nico || { ...st.player, health: st.health ?? 100 };
    st.characters.lara = st.characters.lara || { ...LARA_START };
    st.properties = st.properties || [];
    st.garages = st.garages || {};
    this.protagonist.current = st.current;
    for (const id of ['nico', 'lara']) this.protagonist.setLook(id, st.characters[id].look || {});
    this.player.setModel(this.protagonist.model(st.current));
    this.peds.clear();
    this.economy.refreshMarkers();
    this.economy.prevHour = null;
    this.ui.setCharacter(PROTAGONISTS[st.current]);
    const p = st.characters[st.current];
    this.player.spawn(p.x, p.y, p.z, p.yaw);
    this.player.health = p.health ?? 100;
    this.player.root.visible = true;
    this.world.timeOfDay = st.timeOfDay;
    this.world.weather.load(st.weather);
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
    this.audio.stopEngine();
    this.radio.stop();
    this.audio.setRain(0, false);
  }

  resume() {
    this.state = 'playing';
    this.ui.showScreen('game');
    this.input.setGameActive(true);
    this.input.context = this.playerVehicle ? 'vehicle' : 'foot';
    this.input.requestLock();
    this.canvas.focus();
    if (this.playerVehicle) {
      this.audio.startEngine();
      if (this.radioIndex >= 0 && this.radio.index < 0 && this.playerVehicle.kind !== 'police') this.radio.play(this.radioIndex);
    }
  }

  cycleRadio() {
    // emisoras en orden y después "apagada"
    this.radioIndex = this.radioIndex + 1 >= STATIONS.length ? -1 : this.radioIndex + 1;
    this.radio.stop();
    if (this.radioIndex >= 0) {
      this.radio.play(this.radioIndex);
      const s = STATIONS[this.radioIndex];
      this.ui.toast(`Radio: ${s.name} · ${s.genre}`);
    } else this.ui.toast('Radio apagada');
  }

  // ------------------------------------------------------------------ protagonistas
  async switchCharacter() {
    if (this.switching) return;
    if (this.missions.active) return this.ui.toast('No podés cambiar de personaje durante una misión');
    if (this.police.wanted > 0) return this.ui.toast('Perdé a la policía antes de cambiar de personaje');
    this.switching = true;
    const st = this.gameState;
    this.collectState();
    this.ui.fade(true);
    await new Promise((r) => setTimeout(r, 480));
    if (this.playerVehicle) this.leaveVehicleImmediately();
    const next = this.protagonist.other();
    this.protagonist.current = next;
    st.current = next;
    this.player.setModel(this.protagonist.model(next));
    this.player.root.visible = true;
    const p = st.characters[next];
    this.player.spawn(p.x, p.y, p.z, p.yaw);
    this.player.health = p.health ?? 100;
    this.cameraSystem.snapTo(this.player.position, p.yaw + Math.PI);
    this.ui.setCharacter(PROTAGONISTS[next]);
    this.ui.lastDistrict = null;
    this.missions.clearStarts();
    this.ui.fade(false);
    this.ui.bigMessage(PROTAGONISTS[next].name.toUpperCase(), PROTAGONISTS[next].bio, 'pass', 3);
    this.switching = false;
  }

  // Cambiar ropa / apariencia de un protagonista
  setLook(id, look) {
    const model = this.protagonist.setLook(id, look);
    this.gameState.characters[id] = { ...(this.gameState.characters[id] || {}), look: { ...look } };
    if (id === this.protagonist.current) {
      this.player.setModel(model);
      this.player.root.visible = !this.playerVehicle;
    }
  }

  // ------------------------------------------------------------------ tiendas
  openShop(opts) {
    if (this.state !== 'playing') return;
    this.shop = opts;
    this.state = 'shop';
    this.input.setGameActive(false);
    this.input.releaseLock();
    this.ui.setPrompt(null);
    this.audio.stopEngine();
    const cam = this.camera;
    if (opts.camera === 'car' && this.playerVehicle) {
      const v = this.playerVehicle, f = v.forward, l = v.left;
      cam.position.set(v.pos.x + f.x * 5 + l.x * 4, v.pos.y + 2.4, v.pos.z + f.z * 5 + l.z * 4);
      cam.lookAt(v.pos.x - l.x * 1.5, v.pos.y + 0.6, v.pos.z - l.z * 1.5);
    } else {
      const p = this.player.position, y = this.player.yaw;
      const fx = Math.sin(y), fz = Math.cos(y);
      cam.position.set(p.x + fx * 2.6 - fz * 0.9, p.y + 1.45, p.z + fz * 2.6 + fx * 0.9);
      cam.lookAt(p.x - fz * 0.75, p.y + 1.05, p.z + fx * 0.75);
    }
    cam.fov = 50;
    cam.updateProjectionMatrix();
    this.renderShop();
    this.ui.showScreen('shop');
  }

  renderShop() {
    const s = this.shop;
    if (!s) return;
    document.getElementById('shop-kind').textContent = s.kind;
    document.getElementById('shop-title').textContent = s.title;
    document.getElementById('shop-sub').textContent = s.sub || '';
    const body = document.getElementById('shop-body');
    body.innerHTML = s.render();
    document.getElementById('shop-money').textContent = `$${this.gameState.money.toLocaleString('es-AR')}`;
    body.onclick = async (e) => {
      const el = e.target.closest('button');
      if (!el) return;
      const changed = await s.onClick(el);
      if (changed && this.shop === s) this.renderShop();
    };
  }

  closeShop() {
    if (this.state !== 'shop') return;
    this.shop = null;
    this.resume();
  }

  teleportPlayer(x, z, yaw) {
    if (this.playerVehicle) this.leaveVehicleImmediately();
    const y = this.world.collision.groundHeight(x, z, 3, 0.3);
    this.player.spawn(x, y, z, yaw);
    this.cameraSystem.snapTo(this.player.position, yaw + Math.PI);
  }

  addMoney(n) {
    if (!this.gameState || !n) return;
    this.gameState.money = Math.max(0, this.gameState.money + n);
    this.ui.moneyDelta(n);
    if (n > 0) this.audio.jingle('money');
  }

  setGps(target) {
    if (!target) {
      this.gps.target = null;
      this.map.route = null;
      return;
    }
    this.gps.target = target;
  }

  updateGps(dt) {
    const t = this.gps.target;
    if (!t) return;
    this.gps.timer -= dt;
    const from = this.playerVehicle ? this.playerVehicle.pos : this.player.position;
    const moved = !this.gps.last || this.gps.last.distanceTo(t) > 8;
    if (this.gps.timer <= 0 || moved) {
      this.gps.timer = 1;
      this.gps.last = new THREE.Vector3(t.x, 0, t.z);
      this.map.route = Math.hypot(t.x - from.x, t.z - from.z) < 25 ? [new THREE.Vector3(from.x, 0, from.z), new THREE.Vector3(t.x, 0, t.z)] : this.routes.route(from, t);
    } else if (this.map.route) this.map.route[0] = new THREE.Vector3(from.x, 0, from.z);
  }

  isVisible(p) {
    if (!this._frustum) { this._frustum = new THREE.Frustum(); this._pm = new THREE.Matrix4(); }
    this._pm.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._pm);
    return this._frustum.containsPoint(new THREE.Vector3(p.x, (p.y || 0) + 1, p.z)) && this.camera.position.distanceTo(p) < 160;
  }

  async busted() {
    if (this.state !== 'playing' || this.switching) return;
    this.switching = true;
    this.ui.bigMessage('ARRESTADO', 'La policía te atrapó', 'fail', 3.5);
    this.audio.jingle('fail');
    await new Promise((r) => setTimeout(r, 1400));
    this.ui.fade(true);
    await new Promise((r) => setTimeout(r, 500));
    const fine = Math.min(this.gameState.money, Math.max(100, Math.round(this.gameState.money * 0.1)));
    this.police.reset();
    this.teleportPlayer(POLICE_STATION.x, POLICE_STATION.z, POLICE_STATION.yaw);
    this.addMoney(-fine);
    this.ui.fade(false);
    this.ui.toast(`Saliste de la ${POLICE_STATION.name}. Multa: $${fine}`, 4);
    this.switching = false;
  }

  // ------------------------------------------------------------------ vehículos
  enterVehicle(v) {
    if (v.kind === 'police' && v.driver === 'police') return this.ui.toast('No podés robar un patrullero con un policía adentro');
    if (v.driver === 'ai') {
      this.traffic.release(v);
      this.vehicles.ejectDriver(v);
      this.ui.toast(`Robaste un ${v.T.name}`);
      this.police.report('carjack', v.pos);
    } else if (v.kind === 'parked') this.vehicles.releaseFromSlot(v);
    v.driver = 'player';
    if (v.kind !== 'mission') v.kind = 'free';
    v.sleeping = false;
    // si un conductor guionado lo manejaba, el control pasa al jugador
    if (this.missions.active) this.missions.active.ctx.tracked.drivers = this.missions.active.ctx.tracked.drivers.filter((d) => d.v !== v);
    v.controls.hold = false;
    this.playerVehicle = v;
    this.player.root.visible = false;
    this.input.context = 'vehicle';
    this.cameraSystem.enterVehicle(v);
    this.audio.startEngine();
    if (this.radioIndex >= 0) {
      this.radio.play(this.radioIndex);
      const s = STATIONS[this.radioIndex];
      this.ui.toast(`Radio: ${s.name} · ${s.genre} (${this.keyLabel('radio')} para cambiar)`);
    }
    this.ui.setPrompt(null);
    this.ui.showVehicleHUD(true, v);
    this.ui.tutorialProgress('car', 1);
  }

  exitVehicle() {
    const v = this.playerVehicle;
    if (v.speed > 5) {
      this.ui.toast('Frená para bajarte del auto');
      return;
    }
    const col = this.world.collision;
    const l = v.left, f = v.forward;
    const spots = [
      [l.x * (v.hw + 0.8), l.z * (v.hw + 0.8)], [-l.x * (v.hw + 0.8), -l.z * (v.hw + 0.8)],
      [-f.x * (v.hl + 1), -f.z * (v.hl + 1)], [f.x * (v.hl + 1), f.z * (v.hl + 1)],
    ];
    let spot = null;
    for (const [dx, dz] of spots) {
      const p = new THREE.Vector3(v.pos.x + dx, v.pos.y + 0.2, v.pos.z + dz);
      const q = p.clone();
      col.resolveCylinder(q, 0.34, 1.8, 0.42);
      if (q.distanceTo(p) < 0.05 && !this.vehicles.vehicles.some((o) => o !== v && o.toLocal && Math.abs(o.toLocal(p.x, p.z).x) < o.hw + 0.3 && Math.abs(o.toLocal(p.x, p.z).z) < o.hl + 0.3)) {
        spot = p;
        break;
      }
    }
    if (!spot) {
      this.ui.toast('No hay lugar para bajarse acá');
      return;
    }
    this.leaveVehicleImmediately(spot);
  }

  leaveVehicleImmediately(spot) {
    const v = this.playerVehicle;
    if (!v) return;
    v.driver = null;
    v.controls.throttle = 0; v.controls.brake = 0; v.controls.steer = 0; v.controls.handbrake = false;
    v.bodyMesh.visible = true;
    v.interiorMesh.visible = false;
    this.playerVehicle = null;
    const p = spot || new THREE.Vector3(v.pos.x, v.pos.y, v.pos.z);
    this.player.spawn(p.x, p.y, p.z, v.h);
    this.player.root.visible = true;
    this.input.context = 'foot';
    this.cameraSystem.exitVehicle(this.player.yaw);
    this.cameraSystem.snapTo(this.player.position, this.player.yaw + Math.PI);
    this.audio.stopEngine();
    this.radio.stop();
    this.ui.showVehicleHUD(false);
    this.vehicles.updateHeadlight(null, 0);
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
    if (this.state === 'shop') return this.closeShop();
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
    st.current = this.protagonist.current;
    st.characters = st.characters || {};
    st.characters[st.current] = { ...(st.characters[st.current] || {}), ...st.player, health: p.health };
    st.timeOfDay = this.world.timeOfDay;
    st.weather = this.world.weather.save();
    st.stats.distanceWalked = (st.stats.distanceWalked || 0);
    return st;
  }

  saveGame(manual) {
    if (!this.gameState) return;
    // los autos propios que están en la calle se guardan como si estuvieran en su garaje
    const data = { ...this.collectState(), garages: this.economy.garagesForSave() };
    const ok = this.saves.save(data);
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
    else if (this.state === 'shop' && !this.playerVehicle) this.player.update(dt);
    else if (this.state === 'menu') {
      this.cameraSystem.updateMenu(dt);
      this.world.timeOfDay = 18.3 + Math.sin(now * 0.00003) * 0.6;
    }
    if (this.state !== 'loading') {
      const focus = this.state === 'menu' ? this.camera.position : this.player.position;
      const groundY = this.state === 'menu' ? 0 : this.playerVehicle ? this.playerVehicle.pos.y - 0.3 : this.player.position.y;
      this.world.update(this.state === 'playing' ? dt : 0, this.camera, focus, groundY);
      this.world.weather.setViewport(this.renderer.domElement.height, this.camera.fov);
      this.visTimer -= dt;
      if (this.visTimer <= 0) {
        this.visTimer = 0.25;
        this.world.updateVisibility(this.camera.position);
      }
      if (this.composer) {
        // de noche brilla el neón y los faroles; de día solo el sol y reflejos fuertes
        const n = this.world.night;
        this.bloomPass.strength = 0.2 + n * 0.32;
        this.bloomPass.threshold = 1.5 - n * 0.65;
        this.composer.render(dt);
      } else {
        this.renderer.autoClear = true;
        this.renderer.render(this.world.scene, this.camera);
      }
    }
    this.input.endFrame();
  }

  updatePlaying(dt) {
    const input = this.input;
    const pv = this.playerVehicle;
    const { dx, dy } = input.consumeMouse();
    if (dx || dy) {
      this.cameraSystem.applyLook(dx, dy);
      this.ui.tutorialProgress('look', Math.abs(dx) + Math.abs(dy));
    }
    if (input.wasPressed('map')) return this.openMap();
    if (input.wasPressed('switchChar')) this.switchCharacter();
    if (pv && input.wasPressed('radio')) this.cycleRadio();
    if (input.wasPressed('camera')) {
      if (pv) this.cameraSystem.cycleVehicleView();
      else this.cameraSystem.cyclePreset();
    }
    // entrar / salir del vehículo
    let nearCar = null;
    if (!pv) {
      nearCar = this.vehicles.nearestEnterable(this.player.position);
      if (input.wasPressed('vehicle') && nearCar) this.enterVehicle(nearCar);
    } else if (input.wasPressed('vehicle')) this.exitVehicle();
    const car = this.playerVehicle;

    // controles del auto
    if (car) {
      const c = car.controls;
      c.throttle = input.isDown('forward') ? 1 : 0;
      c.brake = input.isDown('back') ? 1 : 0;
      c.steer = (input.isDown('left') ? 1 : 0) - (input.isDown('right') ? 1 : 0);
      c.handbrake = input.isDown('handbrake');
    }

    // física a paso fijo
    const before = this.player.distance;
    const carBefore = car ? car.pos.clone() : null;
    this.acc += dt;
    let steps = 0;
    const pedsOnRoad = this.peds.onRoad();
    while (this.acc >= FIXED && steps < 6) {
      if (!car) {
        this.player.fixedUpdate(FIXED, this.cameraSystem.yaw);
        const hit = this.vehicles.resolvePedestrian(this.player.position, 0.34, this.player.velocity);
        if (hit) {
          this.player.grounded = false;
          this.player.damage(Math.min(60, hit.speed * 4));
          if (hit.vehicle.driver === 'ai') bus.emit('vehicle:horn', { x: hit.vehicle.pos.x, z: hit.vehicle.pos.z });
        }
      }
      this.police.fixedUpdate(FIXED);
      this.missions.fixedUpdate(FIXED);
      this.vehicles.fixedUpdate(FIXED);
      this.traffic.fixedUpdate(FIXED, this.player.position, car, !car, pedsOnRoad);
      this.acc -= FIXED;
      steps++;
    }
    if (steps === 6) this.acc = 0;
    if (car) {
      // el jugador viaja con el auto
      this.player.position.copy(car.pos);
      this.player.yaw = car.h;
      this.ui.tutorialProgress('drive', car.pos.distanceTo(carBefore));
    } else {
      const moved = this.player.distance - before;
      if (moved > 0) {
        this.ui.tutorialProgress(input.isDown('sprint') ? 'run' : 'move', moved);
        this.gameState.stats.distanceWalked = (this.gameState.stats.distanceWalked || 0) + moved;
      }
    }
    this.ui.tutorialProgress('free', dt);
    if (!car) this.player.update(dt);

    const focus = car ? car.pos : this.player.position;
    this.traffic.manage(dt, focus, this.camera);
    const weather = this.world.weather;
    Vehicle.wetGrip = 1 - weather.wet * 0.2;
    this.vehicles.wet = weather.wet;
    this.vehicles.update(dt, this.world.night, focus, this.camera);
    this.trafficLights.update(dt);
    this.particles.update(dt, this.renderer.domElement.height, this.camera.fov);
    this.police.update(dt);
    this.missions.update(dt);
    if (!this.missions.prompt) this.economy.update(dt);
    else this.economy.prompt = null;
    if (this.state !== 'playing') return; // se abrió una tienda o un diálogo
    this.peds.update(dt, focus, this.camera);
    this.audio.listener = this.camera.position;
    this.markers.update(dt);
    this.updateGps(dt);
    this.map.markers = [...this.economy.blips(), ...this.missions.blips(), ...this.police.blips()];
    this.map.search = this.police.searching ? { x: this.police.lastSeen.x, z: this.police.lastSeen.z, r: 30 + this.police.wanted * 15 } : null;

    if (car) {
      this.cameraSystem.updateVehicle(dt, car);
      this.vehicles.updateHeadlight(car, this.world.night);
      this.audio.setEngine(car.rpm, car.controls.throttle, car.slip, input.isDown('horn'), !car.dead);
      this.ui.setPrompt(null);
    } else {
      this.cameraSystem.update(dt, this.player.root.position, { sprint: this.player.sprinting, run: input.isDown('sprint') && this.player.speed > 3 });
      if (this.missions.prompt) this.ui.setPrompt(this.missions.prompt);
      else if (this.economy.prompt) this.ui.setPrompt(this.economy.prompt);
      else if (nearCar) {
        const verb = nearCar.driver === 'ai' ? 'Robar' : 'Subir al';
        this.ui.setPrompt(`<kbd>${this.keyLabel('vehicle')}</kbd> ${verb} ${nearCar.T.name} <span class="muted">· ${nearCar.T.category}</span>`);
      } else if (this.peds.nearestTalkable(this.player.position)) {
        this.ui.setPrompt(`<kbd>${this.keyLabel('interact')}</kbd> Hablar`);
        if (input.wasPressed('interact')) {
          const line = this.peds.tryTalk(this.player.position);
          if (line) this.missions.say('Vecino de San Vega', line, 3.5);
        }
      } else this.ui.setPrompt(null);
    }
    if (car && this.missions.prompt && this.missions.retry) this.ui.setPrompt(this.missions.prompt);
    else if (car && this.economy.prompt) this.ui.setPrompt(this.economy.prompt);
    this.gameState.playTime += dt;

    if (this.player.health <= 0) this.respawn();

    // HUD (10 Hz), minimapa (20 Hz), barrio (2 Hz)
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.ui.updateHUD({
        money: this.gameState.money, time: this.world.timeOfDay, health: this.player.health,
        stamina: this.player.stamina, wanted: this.police.wanted, searching: this.police.searching, fps: this.fps, renderScale: this.settings.get('resolutionScale') * this.dynScale,
        weatherIcon: weather.type === 'clear' && this.world.night > 0.5 ? '☾' : WEATHER_ICONS[weather.type], weatherLabel: weather.label,
      });
      if (car) this.ui.updateVehicleHUD(car);
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
      this.audio.setAmbience(busy * (1 - this.world.night * 0.5) * (1 - weather.rain * 0.5), (d?.id === 'coastal' ? 1 : 0.3) + weather.rain * 0.5);
      this.audio.setRain(weather.rain, !!car);
    }
    this.autosaveTimer += dt;
    if (this.autosaveTimer > 60) {
      this.autosaveTimer = 0;
      this.saveGame(false);
    }
  }

  respawn() {
    bus.emit('player:wasted');
    this.police.reset();
    if (this.playerVehicle) this.leaveVehicleImmediately();
    const cost = Math.min(this.gameState.money, 150);
    this.teleportPlayer(HOSPITAL.x, HOSPITAL.z, HOSPITAL.yaw);
    this.player.health = 100;
    this.addMoney(-cost);
    this.ui.bigMessage('HERIDO', `Te atendieron en el ${HOSPITAL.name}. Gastos médicos: $${cost}`, 'fail', 3.5);
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
