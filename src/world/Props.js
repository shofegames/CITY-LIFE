import * as THREE from 'three';
import { MeshBuilder } from './MeshBuilder.js';
import { createRng } from './rng.js';

// ============================================================================
// Geometrías de mobiliario urbano. Se construyen una vez y se dibujan con
// InstancedMesh (una draw call por tipo y por zona, sin importar la cantidad).
// Origen de cada prop: base en el piso, frente hacia +Z.
// ============================================================================

export function buildPropGeometries(materials) {
  const out = {};
  const mb = new MeshBuilder(materials);
  const mtx = new THREE.Matrix4();

  // ---- farol ----
  mb.cylinder('metal', 0, 0, 0, 7.2, 0.09, 8, 0x3a3f45);
  mb.cylinder('metal', 0, 0, 0, 0.6, 0.16, 8, 0x30353a);
  mb.box(-0.06, 7.0, 0, 0.06, 7.12, 1.7, { side: 'metal', color: 0x3a3f45 });
  mb.box(-0.22, 6.82, 1.45, 0.22, 7.06, 2.15, { side: 'metal', color: 0x2b2f33 });
  mb.box(-0.18, 6.78, 1.5, 0.18, 6.82, 2.1, { side: 'lampGlow', top: null, faces: 'nsew', bottom: 'lampGlow' });
  out.lamp = mb.toGeometries();

  // ---- farol doble (estacionamientos) ----
  mb.cylinder('metal', 0, 0, 0, 7.2, 0.1, 8, 0x3a3f45);
  for (const s of [-1, 1]) {
    mb.box(-0.06, 7.0, Math.min(0, s * 1.7), 0.06, 7.12, Math.max(0, s * 1.7), { side: 'metal', color: 0x3a3f45 });
    const z0 = s * 1.45, z1 = s * 2.15;
    mb.box(-0.22, 6.82, Math.min(z0, z1), 0.22, 7.06, Math.max(z0, z1), { side: 'metal', color: 0x2b2f33 });
    mb.box(-0.18, 6.78, Math.min(z0, z1) + 0.05, 0.18, 6.82, Math.max(z0, z1) - 0.05, { side: 'lampGlow', top: null, faces: 'nsew', bottom: 'lampGlow' });
  }
  out.lampDouble = mb.toGeometries();

  // ---- árbol frondoso ----
  const rng = createRng(99);
  mb.cylinder('bark', 0, 0, 0, 3.8, 0.2, 7, 0xffffff, false);
  mb.cylinder('bark', 0, 0, 3.4, 4.8, 0.13, 6, 0xffffff, false);
  const blob = new THREE.IcosahedronGeometry(1, 1);
  const greens = [0x3f7d2b, 0x4c8a33, 0x356b25, 0x5a9440, 0x2f5f22];
  const blobs = [[0, 5.9, 0, 2.0], [0.9, 5.3, 0.5, 1.45], [-0.8, 5.4, -0.4, 1.5], [0.2, 6.8, -0.3, 1.35], [-0.4, 5.2, 0.9, 1.25]];
  for (const [x, y, z, s] of blobs) {
    mtx.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(s, s * 0.85, s));
    mb.addGeometry('foliage', blob, mtx, () => greens[Math.floor(rng.next() * greens.length)]);
  }
  out.tree = mb.toGeometries();

  // ---- palmera ----
  const segs = 7;
  let px = 0;
  for (let i = 0; i < segs; i++) {
    const y0 = i * 1.1, y1 = (i + 1) * 1.1;
    const nx = px + 0.1 + i * 0.03;
    mb.cylinder('bark', (px + nx) / 2, 0, y0, y1 + 0.05, 0.2 - i * 0.012, 7, i % 2 ? 0xc8a77c : 0xb08e64, false);
    px = nx;
  }
  const top = new THREE.Vector3(px, segs * 1.1, 0);
  const frond = new THREE.BoxGeometry(0.5, 0.05, 3.4);
  frond.translate(0, 0, 1.7);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rng.range(-0.15, 0.15);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(0.35, 0.7), a, 0, 'YXZ'));
    mtx.compose(top, q, new THREE.Vector3(1, 1, 1));
    mb.addGeometry('foliage', frond, mtx, () => rng.pick([0x3d7a2a, 0x4e8f35, 0x5d9a3c]));
  }
  mtx.compose(top, new THREE.Quaternion(), new THREE.Vector3(0.45, 0.4, 0.45));
  mb.addGeometry('foliage', blob, mtx, () => 0x5b4a2a);
  out.palm = mb.toGeometries();

  // ---- semáforo (poste en esquina, brazo sobre la calle hacia +X local) ----
  mb.cylinder('metal', 0, 0, 0, 5.6, 0.11, 8, 0x2d3236);
  mb.box(0, 5.35, -0.07, 5.2, 5.5, 0.07, { side: 'metal', color: 0x2d3236 });
  mb.box(4.6, 4.2, -0.25, 5.0, 5.35, 0.18, { side: 'signal', color: 0xffffff });
  mb.box(-0.2, 2.2, 0.1, 0.2, 3.1, 0.4, { side: 'signal', color: 0xffffff }); // peatonal
  out.trafficLight = mb.toGeometries();

  // ---- banco ----
  mb.box(-0.9, 0.42, -0.25, 0.9, 0.48, 0.25, { side: 'wood', color: 0xffffff });
  mb.box(-0.9, 0.5, -0.3, 0.9, 0.95, -0.24, { side: 'wood', color: 0xffffff });
  for (const x of [-0.75, 0.75]) mb.box(x - 0.04, 0, -0.28, x + 0.04, 0.48, 0.22, { side: 'metal', color: 0x2a2a2a });
  out.bench = mb.toGeometries();

  // ---- hidrante ----
  mb.cylinder('paint', 0, 0, 0, 0.7, 0.14, 8, 0xc0392b);
  mb.cylinder('paint', 0, 0, 0.7, 0.85, 0.09, 8, 0xc0392b);
  mb.box(-0.22, 0.42, -0.05, 0.22, 0.52, 0.05, { side: 'paint', color: 0xa93226 });
  out.hydrant = mb.toGeometries();

  // ---- cesto de basura ----
  mb.cylinder('metal', 0, 0, 0, 0.95, 0.28, 10, 0x2f4f3a);
  mb.cylinder('metal', 0, 0, 0.95, 1.02, 0.31, 10, 0x22382a);
  out.bin = mb.toGeometries();

  // ---- contenedor marítimo (2.5 x 2.6 x 6) ----
  mb.box(-1.25, 0, -3, 1.25, 2.6, 3, { side: 'container', top: 'container', color: 0xffffff });
  out.container = mb.toGeometries();

  return out;
}

// Textura radial para charcos de luz de los faroles (de noche).
export function makeLightPoolTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,220,160,1)');
  g.addColorStop(0.4, 'rgba(255,200,130,0.45)');
  g.addColorStop(1, 'rgba(255,190,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
