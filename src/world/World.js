import * as THREE from 'three';
import { buildCityLayout, districtAt, DISTRICTS } from './CityLayout.js';
import { TextureFactory } from './TextureFactory.js';
import { MaterialLibrary } from './Materials.js';
import { CityBuilder } from './CityBuilder.js';
import { Sky } from './Sky.js';
import { Weather } from './Weather.js';
import { Island, ISLAND_REGIONS } from './Island.js';
import { CollisionWorld } from '../physics/CollisionWorld.js';

// ============================================================================
// World System: escena, ciudad, cielo, hora del día y colisiones.
// ============================================================================

export class World {
  constructor(renderer, settings) {
    this.renderer = renderer;
    this.settings = settings;
    this.scene = new THREE.Scene();
    this.collision = new CollisionWorld();
    this.timeOfDay = 9;
    this.timeScale = 1 / 60; // 1 segundo real = 1 minuto de juego (día de 24 min)
    this.clock = 0;
    this.envTimer = 0;
    this.envHour = -10;
    this.pmrem = null;
  }

  // Generador por etapas para la pantalla de carga.
  *loadSteps() {
    const preset = this.settings.preset;
    yield 'Diseñando San Vega';
    this.layout = buildCityLayout();
    this.island = new Island(this.layout);
    for (const step of this.island.generate()) yield step;
    this.layout.island = this.island;
    yield 'Pintando texturas';
    const aniso = Math.min(preset.textureSize >= 512 ? 4 : 1, this.renderer.capabilities.getMaxAnisotropy());
    this.textures = new TextureFactory(preset.textureSize, aniso);
    this.materials = new MaterialLibrary(this.textures, preset.lighting);
    this.city = new CityBuilder(this.layout, this.materials, this.collision);
    this.city.island = this.island;
    this.city.quality = this.settings.get('quality');
    for (const step of this.city.buildSteps()) yield step;
    this.scene.add(this.city.root);
    yield 'Encendiendo el cielo';
    this.sky = new Sky(this.scene);
    this.weather = new Weather(this.scene, this.settings.get('quality'));
    this.weather.setLamps(this.city.lightRefl || []);
    this.applyQuality();
  }

  applyQuality() {
    const s = this.settings;
    const preset = s.preset;
    this.materials.setLighting(preset.lighting, this.scene);
    const shadows = s.get('shadows');
    this.renderer.shadowMap.enabled = shadows;
    this.sky.configureShadows(shadows, preset.shadowMapSize, preset.shadowMapSize >= 2048 ? 75 : 55);
    this.scene.traverse((o) => {
      if (o.material) o.material.needsUpdate = true;
    });
    this.useEnv = preset.lighting === 'standard';
    if (!this.useEnv) this.scene.environment = null;
    this.envHour = -10;
    this.weather?.setQuality(s.get('quality'));
  }

  get drawDistance() {
    return this.settings.get('drawDistance');
  }

  get night() {
    return this.sky?.night ?? 0;
  }

  districtAt(x, z) {
    const d = districtAt(this.layout, x, z);
    if (d) return { id: d, ...DISTRICTS[d] };
    const E = this.layout.roadExtent;
    if (x >= E.min && x <= E.max + 130 && z >= E.min && z <= E.max) return null;
    const r = this.island?.regionAt(x, z);
    return r ? { id: r, island: true, ...ISLAND_REGIONS[r] } : null;
  }

  update(dt, camera, focus, groundY = 0) {
    this.clock += dt;
    this.timeOfDay = (this.timeOfDay + dt * this.timeScale) % 24;
    const w = this.weather;
    w.update(dt, camera, groundY, this.sky.night);
    this.sky.update(this.timeOfDay, camera, focus, this.drawDistance, { cloud: w.cloud, rain: w.rain, flash: w.flash, dt: dt || 0.016 });
    this.materials.updateNight(this.sky.night);
    this.materials.setWet(w.wet);
    this.city.setNight(this.sky.night, w.wet);
    this.city.update(dt, this.clock);
    this.city.islandBuilder?.update(dt, this.clock, this.sky.night, camera);
    // mapa de entorno (reflejos) regenerado cada media hora de juego o si cambia el clima
    if (this.useEnv && (Math.abs(this.timeOfDay - this.envHour) > 0.5 || Math.abs(w.cloud - this.envCloud) > 0.08)) this.regenerateEnv();
  }

  updateVisibility(camPos) {
    const preset = this.settings.preset;
    const draw = this.drawDistance;
    this.city.updateVisibility(camPos, draw, Math.min(draw, preset.detailDistance));
  }

  regenerateEnv() {
    this.envHour = this.timeOfDay;
    this.envCloud = this.weather.cloud;
    if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(this.renderer);
    if (!this.envScene) {
      this.envScene = new THREE.Scene();
      this.envDome = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), this.sky.dome.material);
      this.envScene.add(this.envDome);
      const ground = new THREE.Mesh(new THREE.CircleGeometry(9, 16), new THREE.MeshBasicMaterial({ color: 0x55524c }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -1;
      this.envScene.add(ground);
      this.envGround = ground;
    }
    this.envGround.material.color.copy(this.sky.uniforms.groundColor.value).multiplyScalar(1.4);
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 50);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.55;
    old?.dispose();
  }
}
