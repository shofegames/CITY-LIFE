import * as THREE from 'three';
import { CURB } from '../world/CityLayout.js';

// Luces de los semáforos (rojo/amarillo/verde) sincronizadas con la IA del tráfico.
// Un único InstancedMesh para toda la ciudad.
const COLORS = { red: new THREE.Color(3, 0.12, 0.08), yellow: new THREE.Color(3, 1.9, 0.1), green: new THREE.Color(0.15, 3, 0.6) };

export class TrafficLights {
  constructor(scene, layout, graph) {
    this.graph = graph;
    this.lights = layout.props.trafficLights.map((t) => {
      const c = Math.cos(t.rot), s = Math.sin(t.rot);
      // brazo hacia +X local: cabeza en (4.8, 4.75, 0)
      const axis = Math.abs(Math.sin(t.rot)) > 0.5 ? 'z' : 'x';
      return { x: t.x + 4.8 * c, y: CURB + 4.75, z: t.z - 4.8 * s, it: t.intersection, axis };
    });
    const geo = new THREE.SphereGeometry(0.2, 8, 6);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), this.lights.length);
    const m = new THREE.Matrix4();
    this.lights.forEach((l, i) => {
      m.makeTranslation(l.x, l.y, l.z);
      this.mesh.setMatrixAt(i, m);
      this.mesh.setColorAt(i, COLORS.green);
    });
    this.mesh.computeBoundingSphere();
    scene.add(this.mesh);
    this.timer = 0;
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.2;
    this.lights.forEach((l, i) => this.mesh.setColorAt(i, COLORS[this.graph.signal(l.it, l.axis)]));
    this.mesh.instanceColor.needsUpdate = true;
  }
}
