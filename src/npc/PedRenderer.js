import * as THREE from 'three';
import { charGeometry } from '../player/CharacterModel.js';

// ============================================================================
// Dibuja a todos los peatones con InstancedMesh: una draw call por tipo de
// pieza (torso, cabeza, piernas...) sin importar cuántos peatones haya.
// Cada peatón tiene un "rig" (articulaciones sin mallas) que se anima igual
// que el jugador; acá solo se copian las matrices finales.
// ============================================================================

const _m = new THREE.Matrix4();
const _c = new THREE.Color();

export class PedRenderer {
  constructor(scene, maxPeds, lighting, shadows) {
    this.scene = scene;
    this.max = maxPeds;
    const Mat = lighting === 'lambert' ? THREE.MeshLambertMaterial : THREE.MeshStandardMaterial;
    this.material = new Mat(lighting === 'lambert' ? { color: 0xffffff } : { color: 0xffffff, roughness: 0.8, metalness: 0 });
    this.meshes = new Map();
    this.counts = new Map();
    this.shadows = shadows;
  }

  meshFor(key) {
    let m = this.meshes.get(key);
    if (!m) {
      // hasta 2 piezas iguales por peatón (brazos, piernas, manos, pies)
      m = new THREE.InstancedMesh(charGeometry(key), this.material, this.max * 2);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = this.shadows;
      m.receiveShadow = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, _c.set(0xffffff));
      this.scene.add(m);
      this.meshes.set(key, m);
    }
    return m;
  }

  setShadows(v) {
    this.shadows = v;
    for (const m of this.meshes.values()) m.castShadow = v;
  }

  render(peds) {
    for (const k of this.meshes.keys()) this.counts.set(k, 0);
    for (const p of peds) {
      if (!p.visible) continue;
      const rig = p.rig;
      rig.root.updateMatrixWorld(true);
      for (const part of rig.parts) {
        const mesh = this.meshFor(part.geoKey);
        const i = this.counts.get(part.geoKey) || 0;
        if (i >= mesh.instanceMatrix.count) continue;
        _m.multiplyMatrices(part.joint.matrixWorld, part.matrix);
        mesh.setMatrixAt(i, _m);
        mesh.setColorAt(i, _c.set(part.colorKey === 'dark' ? 0x15171b : rig.look[part.colorKey]));
        this.counts.set(part.geoKey, i + 1);
      }
    }
    for (const [k, m] of this.meshes) {
      m.count = this.counts.get(k) || 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}
