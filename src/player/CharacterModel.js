import * as THREE from 'three';

// ============================================================================
// Personaje humanoide procedural con esqueleto jerárquico y animación
// procedimental (idle, caminar, correr, sprint, saltar, caer, aterrizar).
// La cadencia de pasos se sincroniza con la distancia recorrida: sin pies
// que patinan. Mira hacia +Z en espacio local.
//
// El cuerpo se describe como "piezas" (geometría compartida + color + pose
// local sobre una articulación). Con { rigOnly: true } no se crean mallas:
// el PedRenderer dibuja cientos de peatones con InstancedMesh.
// ============================================================================

export const SKIN_TONES = [0xf1c7a5, 0xe0ac87, 0xc68b62, 0x9c6644, 0x6f4a32];

// Geometrías compartidas por todos los personajes
const GEO = new Map();
export function charGeometry(key) {
  if (GEO.has(key)) return GEO.get(key);
  let g;
  const [kind, a, b] = key.split(':');
  switch (kind) {
    case 'pelvis': g = new THREE.CapsuleGeometry(0.15, 0.12, 4, 10); break;
    case 'torso': g = new THREE.CapsuleGeometry(0.17, 0.32, 4, 12); break;
    case 'jacket': g = new THREE.CapsuleGeometry(0.18, 0.3, 4, 12); break;
    case 'neck': g = new THREE.CylinderGeometry(0.055, 0.065, 0.12, 8); break;
    case 'head': g = new THREE.SphereGeometry(0.115, 16, 12); break;
    case 'hair': g = new THREE.SphereGeometry(0.122, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55); break;
    case 'hairBack': g = new THREE.CapsuleGeometry(0.1, 0.16, 4, 8); break;
    case 'ponytail': g = new THREE.CapsuleGeometry(0.04, 0.2, 4, 6); break;
    case 'eye': g = new THREE.SphereGeometry(0.014, 6, 6); break;
    case 'nose': g = new THREE.ConeGeometry(0.016, 0.045, 6); break;
    case 'hand': g = new THREE.SphereGeometry(0.05, 8, 6); break;
    case 'foot': g = new THREE.BoxGeometry(0.1, 0.075, 0.25); break;
    case 'limb': {
      const r = parseFloat(a), len = parseFloat(b);
      g = new THREE.CapsuleGeometry(r, Math.max(0.01, len - r * 2), 4, 10);
      g.translate(0, -len / 2, 0);
      break;
    }
    default: throw new Error('geometría de personaje desconocida: ' + key);
  }
  GEO.set(key, g);
  return g;
}

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

export class CharacterModel {
  constructor(look = {}, opts = {}) {
    this.look = {
      skin: look.skin ?? SKIN_TONES[1],
      shirt: look.shirt ?? 0x2f6fb3,
      pants: look.pants ?? 0x2b2f3a,
      shoes: look.shoes ?? 0xf2f2f2,
      hair: look.hair ?? 0x2a1d14,
      hairStyle: look.hairStyle ?? 'short',
      build: look.build ?? 'regular',
      jacket: look.jacket ?? null,
    };
    this.rigOnly = !!opts.rigOnly;
    this.detail = opts.detail ?? !this.rigOnly;
    this.root = new THREE.Group();
    this.root.name = 'Character';
    this.parts = [];
    this.materials = {};
    this.phase = 0;
    this.blend = { move: 0, run: 0, air: 0, land: 0 };
    this.lean = 0;
    this.time = Math.random() * 10;
    this.build();
  }

  joint(parent, x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }

  // Agrega una pieza del cuerpo sobre una articulación.
  part(joint, geoKey, colorKey, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
    _p.set(pos[0], pos[1], pos[2]);
    _q.setFromEuler(_e.set(rot[0], rot[1], rot[2]));
    _s.set(scale[0], scale[1], scale[2]);
    const matrix = new THREE.Matrix4().compose(_p, _q, _s);
    this.parts.push({ joint, geoKey, colorKey, matrix });
    if (this.rigOnly) return null;
    const mesh = new THREE.Mesh(charGeometry(geoKey), this.material(colorKey));
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(matrix);
    mesh.castShadow = geoKey !== 'eye' && geoKey !== 'nose';
    joint.add(mesh);
    return mesh;
  }

  material(colorKey) {
    if (!this.materials[colorKey]) {
      const color = colorKey === 'dark' ? 0x15171b : this.look[colorKey];
      const rough = { skin: 0.65, shirt: 0.85, pants: 0.9, shoes: 0.6, hair: 0.9, jacket: 0.7, dark: 0.5 }[colorKey] ?? 0.8;
      this.materials[colorKey] = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
    }
    return this.materials[colorKey];
  }

  build() {
    const L = this.look;
    const slim = L.build === 'slim';
    const tw = slim ? 0.98 : 1.12, td = slim ? 0.64 : 0.68;

    this.hips = this.joint(this.root, 0, 0.98, 0);
    this.part(this.hips, 'pelvis', 'pants', [0, 0, 0], [0, 0, Math.PI / 2], [1, 1, 0.75]);
    this.spine = this.joint(this.hips, 0, 0.06, 0);
    this.part(this.spine, 'torso', 'shirt', [0, 0.26, 0], [0, 0, 0], [tw, 1, td]);
    if (L.jacket) this.part(this.spine, 'jacket', 'jacket', [0, 0.25, 0], [0, 0, 0], [tw * 1.06, 1.02, td * 1.1]);
    this.chest = this.joint(this.spine, 0, 0.42, 0);
    this.part(this.chest, 'neck', 'skin', [0, 0.06, 0]);
    this.head = this.joint(this.chest, 0, 0.12, 0);
    this.part(this.head, 'head', 'skin', [0, 0.11, 0], [0, 0, 0], [0.92, 1.08, 1]);
    this.part(this.head, 'hair', 'hair', [0, 0.13, -0.01], [-0.25, 0, 0], [0.95, 1.05, 1.05]);
    if (L.hairStyle === 'long') {
      this.part(this.head, 'hairBack', 'hair', [0, 0.06, -0.07], [0, 0, 0], [1.15, 1, 0.6]);
      this.part(this.head, 'ponytail', 'hair', [0, -0.02, -0.14], [0.35, 0, 0]);
    }
    if (this.detail) {
      for (const s of [-1, 1]) this.part(this.head, 'eye', 'dark', [s * 0.04, 0.125, 0.1]);
      this.part(this.head, 'nose', 'skin', [0, 0.095, 0.115], [Math.PI / 2, 0, 0]);
    }

    this.arms = [];
    const armR = slim ? 0.05 : 0.058;
    for (const s of [-1, 1]) {
      const shoulder = this.joint(this.chest, s * (slim ? 0.19 : 0.215), -0.02, 0);
      this.part(shoulder, `limb:${armR}:0.3`, L.jacket ? 'jacket' : 'shirt');
      const elbow = this.joint(shoulder, 0, -0.29, 0);
      this.part(elbow, 'limb:0.048:0.27', 'skin');
      this.part(elbow, 'hand', 'skin', [0, -0.3, 0], [0, 0, 0], [0.8, 1.15, 0.6]);
      this.arms.push({ s, shoulder, elbow });
    }

    this.legs = [];
    for (const s of [-1, 1]) {
      const hip = this.joint(this.hips, s * 0.095, -0.02, 0);
      this.part(hip, 'limb:0.078:0.46', 'pants');
      const knee = this.joint(hip, 0, -0.45, 0);
      this.part(knee, 'limb:0.064:0.45', 'pants');
      const ankle = this.joint(knee, 0, -0.45, 0);
      this.part(ankle, 'foot', 'shoes', [0, -0.03, 0.05]);
      this.legs.push({ s, hip, knee, ankle });
    }
  }

  // speed: velocidad horizontal real (m/s). grounded: en el piso. vy: velocidad vertical.
  // Devuelve true en el frame en que un pie toca el suelo (para sonidos de pasos).
  update(dt, speed, grounded, vy, sprinting) {
    this.time += dt;
    const k = 1 - Math.exp(-dt * 10);
    const moveTarget = grounded ? Math.min(1, speed / 1.4) : 0;
    const runTarget = grounded ? THREE.MathUtils.clamp((speed - 2.4) / 2.6, 0, 1) : 0;
    this.blend.move += (moveTarget - this.blend.move) * k;
    this.blend.run += (runTarget - this.blend.run) * k;
    this.blend.air += ((grounded ? 0 : 1) - this.blend.air) * (1 - Math.exp(-dt * 12));
    this.blend.land = Math.max(0, this.blend.land - dt * 4);

    // avance de fase proporcional a la distancia (zancada más larga al correr)
    const stride = THREE.MathUtils.lerp(1.45, 2.6, this.blend.run) + (sprinting ? 0.35 : 0);
    const prev = this.phase;
    if (grounded) this.phase += (speed * dt * Math.PI * 2) / stride;
    let footstep = false;
    if (grounded && speed > 0.3 && Math.floor(prev / Math.PI) !== Math.floor(this.phase / Math.PI)) footstep = true;

    const m = this.blend.move, r = this.blend.run, a = this.blend.air;
    const ph = this.phase;
    const sin = Math.sin(ph), cos = Math.cos(ph);

    // amplitudes
    const legAmp = (0.42 + 0.42 * r) * m;
    const kneeAmp = (0.55 + 0.75 * r) * m;
    const armAmp = (0.35 + 0.65 * r) * m;
    const breathe = Math.sin(this.time * 2.1) * 0.012 * (1 - m);

    // pelvis: rebote dos veces por ciclo
    const bob = (Math.abs(cos) - 1) * (0.035 + 0.05 * r) * m;
    this.hips.position.y = 0.98 + bob - this.blend.land * 0.12 + a * 0.02;
    this.hips.rotation.y = sin * 0.12 * m;
    this.spine.rotation.y = -sin * 0.18 * m;
    const leanTarget = 0.04 * m + 0.16 * r + (sprinting ? 0.08 : 0);
    this.lean += (leanTarget - this.lean) * k;
    this.spine.rotation.x = this.lean + breathe + this.blend.land * 0.2;
    this.chest.rotation.x = breathe * 0.5;
    this.head.rotation.x = -this.lean * 0.6;

    for (const leg of this.legs) {
      const p = leg.s > 0 ? ph : ph + Math.PI;
      const ls = Math.sin(p), lc = Math.cos(p);
      // piso: muslo hacia adelante = rotación negativa en X
      let hipRot = -ls * legAmp;
      let kneeRot = (0.08 + Math.max(0, lc) * 1.0) * kneeAmp;
      let ankleRot = -Math.max(0, -lc) * 0.25 * m;
      // en el aire: piernas recogidas, una adelante
      const airHip = leg.s > 0 ? -0.55 : 0.15;
      const airKnee = leg.s > 0 ? 0.9 : 0.5;
      hipRot = THREE.MathUtils.lerp(hipRot, airHip, a);
      kneeRot = THREE.MathUtils.lerp(kneeRot, airKnee, a) + this.blend.land * 0.6;
      hipRot -= this.blend.land * 0.35;
      ankleRot = THREE.MathUtils.lerp(ankleRot, 0.2, a);
      leg.hip.rotation.x = hipRot;
      leg.knee.rotation.x = kneeRot;
      leg.ankle.rotation.x = ankleRot - kneeRot * 0.15;
      leg.hip.rotation.z = 0;
    }

    for (const arm of this.arms) {
      const p = arm.s > 0 ? ph + Math.PI : ph;
      const as = Math.sin(p);
      let sh = -as * armAmp;
      let el = -(0.15 + 0.15 * m + 1.0 * r);
      let spread = 0.08 + 0.04 * r;
      // en el aire: brazos arriba y abiertos
      sh = THREE.MathUtils.lerp(sh, -0.6 - (vy > 0 ? 0.4 : 0), a);
      el = THREE.MathUtils.lerp(el, -0.6, a);
      spread = THREE.MathUtils.lerp(spread, 0.45, a);
      arm.shoulder.rotation.x = sh + breathe * 2;
      arm.shoulder.rotation.z = arm.s * spread;
      arm.elbow.rotation.x = el;
    }
    return footstep;
  }

  land(intensity) {
    this.blend.land = Math.min(1, 0.3 + intensity * 0.12);
  }

  // Las geometrías son compartidas: solo se liberan los materiales propios.
  dispose() {
    for (const m of Object.values(this.materials)) m.dispose();
  }
}
