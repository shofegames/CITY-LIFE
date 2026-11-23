import * as THREE from 'three';

// ============================================================================
// Personaje humanoide procedural con esqueleto jerárquico y animación
// procedimental (quieto, caminar, correr, sprint, saltar, caer, aterrizar).
//
// - Brazos y piernas con forma (se afinan hacia muñecas y tobillos), torso con
//   cintura y pecho, cara con ojos, cejas, boca y orejas, manos con dedos.
// - La cadencia de pasos se sincroniza con la distancia recorrida y la altura
//   de la cadera se calcula con el largo real de las piernas: el pie de apoyo
//   queda plantado en el piso (sin patinar ni flotar).
// - Se inclina en las curvas, al acelerar y al frenar; quieto respira, cambia
//   el peso de pierna, mira alrededor y parpadea.
//
// El cuerpo se describe como "piezas" (geometría compartida + color + pose
// local sobre una articulación). Con { rigOnly: true } no se crean mallas:
// el PedRenderer dibuja cientos de peatones con InstancedMesh.
// Mira hacia +Z en espacio local.
// ============================================================================

export const SKIN_TONES = [0xf1c7a5, 0xe0ac87, 0xc68b62, 0x9c6644, 0x6f4a32];

const THIGH = 0.45, SHIN = 0.45, ANKLE_H = 0.08; // largo de piernas
const HIP_Y = THIGH + SHIN + ANKLE_H; // altura de la cadera parado (0.98)
const TAU = Math.PI * 2;

// Brazo/pierna afinada con puntas redondeadas (de y=0 hacia abajo).
function taperGeometry(r0, r1, len, radial = 10) {
  const pts = [];
  const n = 4;
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(0.0001, r1 * Math.cos(a)), -len + r1 + r1 * Math.sin(a)));
  }
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(0.0001, r0 * Math.cos(a)), -r0 + r0 * Math.sin(a)));
  }
  return new THREE.LatheGeometry(pts, radial);
}

function latheProfile(profile, radial = 14) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)), radial);
}

// Geometrías compartidas por todos los personajes
const GEO = new Map();
export function charGeometry(key) {
  if (GEO.has(key)) return GEO.get(key);
  let g;
  const [kind, a, b, c] = key.split(':');
  switch (kind) {
    case 'pelvis':
      g = latheProfile([[0, -0.1], [0.1, -0.095], [0.145, -0.05], [0.155, 0.0], [0.15, 0.05], [0.14, 0.09], [0, 0.095]]);
      break;
    case 'torso':
      // cintura angosta, pecho y hombros más anchos
      g = latheProfile([[0, -0.03], [0.135, -0.02], [0.138, 0.06], [0.148, 0.16], [0.168, 0.26], [0.178, 0.33], [0.17, 0.39], [0.14, 0.44], [0.08, 0.475], [0, 0.48]]);
      break;
    case 'belt': g = new THREE.CylinderGeometry(0.142, 0.142, 0.05, 16, 1, true); break;
    case 'collar': g = new THREE.TorusGeometry(0.068, 0.017, 6, 14); break;
    case 'shirtFront': g = new THREE.BoxGeometry(0.11, 0.4, 0.02); break;
    case 'neck': g = new THREE.CylinderGeometry(0.052, 0.06, 0.12, 10); break;
    case 'head': {
      g = new THREE.SphereGeometry(0.115, 22, 16);
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const t = y < 0 ? -y / 0.115 : 0;
        // mandíbula y mentón más angostos, cara apenas plana, nuca más llena
        x *= 0.9 * (1 - 0.28 * Math.pow(t, 1.4));
        z *= z > 0 ? 1 - 0.12 * Math.pow(t, 1.2) : 1.06;
        y *= 1.1;
        if (z > 0.07) z -= (z - 0.07) * 0.35;
        p.setXYZ(i, x, y, z);
      }
      g.computeVertexNormals();
      break;
    }
    case 'ear': g = new THREE.SphereGeometry(1, 8, 6); g.scale(0.014, 0.032, 0.022); break;
    case 'eyeWhite': g = new THREE.SphereGeometry(1, 10, 8); g.scale(0.017, 0.0115, 0.008); break;
    case 'iris': g = new THREE.SphereGeometry(1, 8, 6); g.scale(0.0105, 0.0105, 0.004); break;
    case 'brow': g = new THREE.BoxGeometry(0.038, 0.008, 0.01); break;
    case 'mouth': g = new THREE.BoxGeometry(0.034, 0.007, 0.008); break;
    case 'nose': g = new THREE.SphereGeometry(1, 8, 6); g.scale(0.016, 0.026, 0.02); break;
    case 'hair': g = new THREE.SphereGeometry(0.124, 18, 10, 0, TAU, 0, Math.PI * 0.56); break;
    case 'quiff': g = new THREE.SphereGeometry(1, 10, 8); g.scale(0.085, 0.04, 0.06); break;
    case 'hairBack': g = new THREE.CapsuleGeometry(0.1, 0.2, 4, 10); break;
    case 'lock': g = new THREE.CapsuleGeometry(0.03, 0.2, 3, 6); break;
    case 'ponytail': g = new THREE.CapsuleGeometry(0.04, 0.2, 4, 6); break;
    case 'deltoid': g = new THREE.SphereGeometry(1, 10, 8); g.scale(0.07, 0.065, 0.068); break;
    case 'taper': g = taperGeometry(parseFloat(a), parseFloat(b), parseFloat(c)); break;
    case 'palm': g = new THREE.BoxGeometry(0.064, 0.068, 0.028); g.translate(0, -0.032, 0); break;
    case 'fingers': g = new THREE.CapsuleGeometry(0.015, 0.045, 3, 6); g.scale(2.0, 1, 0.9); g.translate(0, -0.035, 0); break;
    case 'thumb': g = new THREE.CapsuleGeometry(0.013, 0.035, 3, 6); g.translate(0, -0.025, 0); break;
    case 'shoe': g = new THREE.CapsuleGeometry(0.052, 0.15, 4, 8); g.rotateX(Math.PI / 2); g.scale(1, 0.72, 1); break;
    case 'sole': g = new THREE.BoxGeometry(0.105, 0.03, 0.26); break;
    default: throw new Error('geometría de personaje desconocida: ' + key);
  }
  GEO.set(key, g);
  return g;
}

// Color de una pieza según la apariencia (lo usa también el PedRenderer).
const _pc = new THREE.Color();
export function partColor(look, key) {
  switch (key) {
    case 'dark': return 0x15171b;
    case 'white': return 0xf2f0ec;
    case 'iris': return 0x3b2a1e;
    case 'belt': return 0x1d1a17;
    case 'lip': return _pc.set(look.skin).multiplyScalar(0.78).lerp(_pc.clone().set(0x9a4a44), 0.25).getHex();
    case 'sole': return look.shoes === 0xf2f2f2 || look.shoes === 0xffffff ? 0xc9c9c9 : 0xeeeeee;
    default: return look[key] ?? 0xff00ff;
  }
}

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const smooth = (t) => t * t * (3 - 2 * t);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

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
    this.phase = Math.random() * TAU;
    this.blend = { move: 0, run: 0, air: 0, land: 0 };
    this.lean = 0;
    this.bank = 0;
    this.time = Math.random() * 10;
    this.look_ = { yaw: 0, pitch: 0, target: 0, timer: 2 + Math.random() * 3 };
    this.blink = { timer: 1 + Math.random() * 3, t: 0 };
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
    const small = ['eyeWhite', 'iris', 'brow', 'mouth', 'nose', 'ear', 'thumb', 'collar'].includes(geoKey);
    mesh.castShadow = !small;
    joint.add(mesh);
    return mesh;
  }

  material(colorKey) {
    if (!this.materials[colorKey]) {
      const color = partColor(this.look, colorKey);
      const rough = { skin: 0.6, shirt: 0.85, pants: 0.9, shoes: 0.55, sole: 0.8, hair: 0.75, jacket: 0.65, dark: 0.5, white: 0.35, iris: 0.3, belt: 0.5, lip: 0.6 }[colorKey] ?? 0.8;
      this.materials[colorKey] = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
    }
    return this.materials[colorKey];
  }

  build() {
    const L = this.look;
    const slim = L.build === 'slim';
    const tw = slim ? 0.94 : 1.08, td = slim ? 0.62 : 0.66;
    const D = this.detail;
    const top = L.jacket ? 'jacket' : 'shirt';

    // "body" gira todo el cuerpo desde los pies (inclinación en curvas)
    this.body = this.joint(this.root, 0, 0, 0);
    this.hips = this.joint(this.body, 0, HIP_Y, 0);
    this.part(this.hips, 'pelvis', 'pants', [0, 0, 0], [0, 0, 0], [tw * 0.98, 1, 0.78]);
    this.part(this.hips, 'belt', 'belt', [0, 0.075, 0], [0, 0, 0], [tw * 0.98, 1, 0.74]);
    this.spine = this.joint(this.hips, 0, 0.09, 0);
    this.part(this.spine, 'torso', 'shirt', [0, 0, 0], [0, 0, 0], [tw, 1, td]);
    if (L.jacket) {
      this.part(this.spine, 'torso', 'jacket', [0, -0.01, -0.004], [0, 0, 0], [tw * 1.07, 1.02, td * 1.12]);
      this.part(this.spine, 'shirtFront', 'shirt', [0, 0.22, 0.118 * (td / 0.66)], [-0.06, 0, 0]);
    }
    this.chest = this.joint(this.spine, 0, 0.4, 0);
    this.part(this.chest, 'neck', 'skin', [0, 0.08, 0.005]);
    this.part(this.chest, 'collar', top, [0, 0.07, 0.005], [Math.PI / 2 - 0.15, 0, 0], [1.05, 1, 1]);

    // cabeza
    this.neck = this.joint(this.chest, 0, 0.115, 0.01);
    this.head = this.joint(this.neck, 0, 0.02, 0);
    this.part(this.head, 'head', 'skin', [0, 0.1, 0.005]);
    for (const s of [-1, 1]) this.part(this.head, 'ear', 'skin', [s * 0.102, 0.1, -0.005], [0, s * 0.3, 0]);
    this.part(this.head, 'nose', 'skin', [0, 0.085, 0.112], [-0.25, 0, 0]);
    if (L.hairStyle === 'long') {
      this.part(this.head, 'hair', 'hair', [0, 0.115, -0.005], [-0.2, 0, 0], [0.9, 1.06, 1.06]);
      this.part(this.head, 'hairBack', 'hair', [0, 0.03, -0.075], [0.08, 0, 0], [1.22, 1.05, 0.62]);
      for (const s of [-1, 1]) this.part(this.head, 'lock', 'hair', [s * 0.092, 0.04, 0.015], [0, 0, s * -0.06]);
      this.part(this.head, 'ponytail', 'hair', [0, -0.04, -0.13], [0.4, 0, 0]);
    } else {
      this.part(this.head, 'hair', 'hair', [0, 0.118, -0.008], [-0.22, 0, 0], [0.86, 1.0, 1.02]);
      this.part(this.head, 'quiff', 'hair', [0, 0.19, 0.068], [-0.45, 0, 0], [0.95, 0.7, 0.8]);
    }
    if (D) {
      this.eyes = [];
      for (const s of [-1, 1]) {
        const eye = this.joint(this.head, s * 0.038, 0.115, 0.1);
        this.part(eye, 'eyeWhite', 'white');
        this.part(eye, 'iris', 'iris', [0, 0, 0.0055]);
        this.part(this.head, 'brow', 'hair', [s * 0.039, 0.143, 0.104], [0.15, 0, s * -0.1]);
        this.eyes.push(eye);
      }
      this.part(this.head, 'mouth', 'lip', [0, 0.038, 0.1], [0.12, 0, 0]);
    }

    // brazos
    this.arms = [];
    const armR = slim ? 0.046 : 0.054;
    for (const s of [-1, 1]) {
      const shoulder = this.joint(this.chest, s * (slim ? 0.175 : 0.2), -0.02, 0);
      this.part(shoulder, 'deltoid', top, [s * 0.005, -0.015, 0], [0, 0, 0], slim ? [0.6, 0.6, 0.6] : [0.68, 0.66, 0.68]);
      this.part(shoulder, `taper:${armR}:${armR * 0.82}:0.3`, L.jacket ? 'jacket' : 'skin');
      if (!L.jacket) this.part(shoulder, `taper:${armR * 1.16}:${armR * 1.1}:0.17`, 'shirt', [0, 0.01, 0]);
      const elbow = this.joint(shoulder, 0, -0.28, 0);
      this.part(elbow, `taper:${armR * 0.86}:${armR * 0.66}:0.26`, L.jacket ? 'jacket' : 'skin');
      const wrist = this.joint(elbow, 0, -0.255, 0);
      this.part(wrist, 'palm', 'skin', [0, 0, 0], [0, 0, 0], slim ? [0.9, 0.92, 0.9] : [1, 1, 1]);
      this.part(wrist, 'fingers', 'skin', [0, -0.06, 0.004], [0.25, 0, 0], slim ? [0.9, 0.92, 0.9] : [1, 1, 1]);
      if (D) this.part(wrist, 'thumb', 'skin', [s * -0.032, -0.02, 0.02], [0.4, 0, s * 0.5]);
      this.arms.push({ s, shoulder, elbow, wrist });
    }

    // piernas
    this.legs = [];
    const legR = slim ? 0.074 : 0.082;
    for (const s of [-1, 1]) {
      const hip = this.joint(this.hips, s * 0.092, -0.02, 0);
      this.part(hip, `taper:${legR}:${legR * 0.74}:${THIGH + 0.02}`, 'pants');
      const knee = this.joint(hip, 0, -THIGH, 0);
      this.part(knee, `taper:${legR * 0.78}:${legR * 0.66}:${SHIN}`, 'pants');
      const ankle = this.joint(knee, 0, -SHIN, 0);
      this.part(ankle, 'shoe', 'shoes', [0, -0.035, 0.045]);
      this.part(ankle, 'sole', 'sole', [0, -0.066, 0.045]);
      this.legs.push({ s, hip, knee, ankle, h: THIGH + SHIN });
    }
  }

  // speed: velocidad horizontal (m/s). grounded: en el piso. vy: velocidad vertical.
  // extra (opcional): { turn: velocidad de giro rad/s, accel: m/s², lookYaw: hacia dónde mirar (rad, relativo al cuerpo) }
  // Devuelve true en el frame en que un pie toca el suelo (para sonidos de pasos).
  update(dt, speed, grounded, vy, sprinting, extra = null) {
    this.time += dt;
    const k = 1 - Math.exp(-dt * 10);
    const moveTarget = grounded ? Math.min(1, speed / 1.2) : 0;
    const runTarget = grounded ? THREE.MathUtils.clamp((speed - 2.6) / 2.4, 0, 1) : 0;
    const B = this.blend;
    B.move += (moveTarget - B.move) * k;
    B.run += (runTarget - B.run) * k;
    B.air += ((grounded ? 0 : 1) - B.air) * (1 - Math.exp(-dt * 12));
    B.land = Math.max(0, B.land - dt * 3.2);
    const m = B.move, r = B.run, a = B.air, ld = B.land;
    const sp = sprinting ? 1 : 0;
    const idle = (1 - m) * (1 - a);

    // ---- fase de la caminata: avanza según la distancia (zancada) ----
    const stride = THREE.MathUtils.lerp(1.42, 2.55, r) + sp * 0.4;
    const prev = this.phase;
    if (grounded) this.phase += (speed * dt * TAU) / stride;
    if (this.phase > 1e4) this.phase -= TAU * 1000;
    let footstep = false;
    if (grounded && speed > 0.3 && Math.floor((prev + Math.PI / 2) / Math.PI) !== Math.floor((this.phase + Math.PI / 2) / Math.PI)) footstep = true;
    const ph = this.phase;
    const sinP = Math.sin(ph), cosP = Math.cos(ph);

    // ---- inclinaciones: acelerar/frenar y curvas ----
    const accel = extra?.accel ?? 0, turn = extra?.turn ?? 0;
    const leanTarget = 0.03 * m + 0.14 * r + sp * 0.1 + THREE.MathUtils.clamp(accel * 0.018, -0.12, 0.14) * (1 - a);
    this.lean += (leanTarget - this.lean) * (1 - Math.exp(-dt * 6));
    const bankTarget = grounded ? THREE.MathUtils.clamp(-turn * speed * 0.028, -0.28, 0.28) : 0;
    this.bank += (bankTarget - this.bank) * (1 - Math.exp(-dt * 7));
    this.body.rotation.z = this.bank;

    // ---- quieto: respiración, cambio de peso, mirar alrededor, parpadeo ----
    const breathe = Math.sin(this.time * 1.9);
    const shift = Math.sin(this.time * 0.45) * idle; // pasa el peso de una pierna a la otra
    const L = this.look_;
    L.timer -= dt;
    if (L.timer <= 0) {
      L.timer = 2.5 + Math.random() * 4;
      L.target = Math.random() < 0.55 ? (Math.random() - 0.5) * 1.3 : 0;
    }
    let lookYaw = extra?.lookYaw;
    if (lookYaw == null || Math.abs(lookYaw) > 1.7) lookYaw = L.target * idle;
    lookYaw = THREE.MathUtils.clamp(lookYaw, -1.0, 1.0);
    L.yaw += (lookYaw - L.yaw) * (1 - Math.exp(-dt * 4));
    if (this.eyes) {
      const bl = this.blink;
      bl.timer -= dt;
      if (bl.timer <= 0) { bl.t = 0.14; bl.timer = 2 + Math.random() * 4; }
      bl.t = Math.max(0, bl.t - dt);
      const sy = bl.t > 0 ? 0.15 : 1;
      for (const e of this.eyes) e.scale.y = sy;
    }

    // ---- piernas ----
    const legAmp = (0.36 + 0.3 * r + sp * 0.1) * m;
    const swingFlex = (0.95 + 1.0 * r + sp * 0.2) * m;
    const stanceFlex = (0.06 + 0.3 * r) * m;
    let maxH = 0;
    for (const leg of this.legs) {
      const p = ((leg.s > 0 ? ph : ph + Math.PI) % TAU + TAU) % TAU;
      const ls = Math.sin(p), lc = Math.cos(p);
      // muslo: adelante = rotación negativa; al correr el muslo va más adelante
      let hipRot = -ls * legAmp - 0.1 * r * m;
      // rodilla: se dobla mucho en el vuelo de la pierna y un poco al apoyar
      let kneeRot = Math.pow(Math.max(0, lc), 1.3) * swingFlex + Math.max(0, -lc) * stanceFlex + 0.04;
      // pie: talón al apoyar, punta al despegar, plano en el medio
      let footPitch;
      if (lc <= 0) {
        const t = (p - Math.PI / 2) / Math.PI; // 0 = talón toca, 1 = punta despega
        footPitch = t < 0.18 ? -0.26 * (1 - t / 0.18) : t > 0.62 ? 0.65 * Math.pow((t - 0.62) / 0.38, 2) : 0;
      } else {
        const t = ((p - 1.5 * Math.PI + TAU) % TAU) / Math.PI;
        footPitch = THREE.MathUtils.lerp(0.65, -0.22, smooth(Math.min(1, t * 1.3)));
      }
      footPitch *= m;
      // quieto: la pierna que no carga peso se afloja
      kneeRot += Math.max(0, -shift * leg.s) * 0.16;
      // aire: subiendo, piernas recogidas; cayendo, se estiran para aterrizar
      const rising = vy > 0 ? 1 : 0;
      const airHip = leg.s > 0 ? -0.75 * rising - 0.25 : -0.05 + 0.15 * rising;
      const airKnee = leg.s > 0 ? 1.1 * rising + 0.35 : 0.55 + 0.3 * rising;
      hipRot = THREE.MathUtils.lerp(hipRot, airHip, a);
      kneeRot = THREE.MathUtils.lerp(kneeRot, airKnee, a);
      footPitch = THREE.MathUtils.lerp(footPitch, 0.3, a);
      // aterrizaje: flexión
      hipRot -= ld * 0.55;
      kneeRot += ld * 1.0;
      footPitch = THREE.MathUtils.lerp(footPitch, 0, ld);
      leg.hip.rotation.x = hipRot;
      leg.knee.rotation.x = kneeRot;
      leg.ankle.rotation.x = footPitch - hipRot - kneeRot;
      leg.h = THIGH * Math.cos(hipRot) + SHIN * Math.cos(hipRot + kneeRot);
      maxH = Math.max(maxH, leg.h);
    }

    // ---- cadera: altura según la pierna de apoyo (pies plantados) ----
    const sway = -cosP * 0.055 * m * (1 - 0.5 * r);
    this.hips.position.y = THREE.MathUtils.lerp(ANKLE_H + maxH, HIP_Y + 0.02, a) + breathe * 0.003 * idle;
    this.hips.position.x = -cosP * 0.022 * m * (1 - r) + shift * 0.03;
    this.hips.position.z = -this.lean * 0.05;
    this.hips.rotation.y = -sinP * (0.12 + 0.06 * r) * m;
    this.hips.rotation.z = sway - shift * 0.05;
    for (const leg of this.legs) leg.hip.rotation.z = -this.hips.rotation.z + leg.s * (0.02 + 0.06 * a);
    this.hips.rotation.x = ld * 0.25;

    // ---- torso: contragiro de hombros, inclinación, respiración ----
    this.spine.rotation.y = sinP * (0.18 + 0.1 * r) * m + L.yaw * 0.25;
    this.spine.rotation.z = -this.hips.rotation.z * 0.8;
    this.spine.rotation.x = this.lean + breathe * 0.012 * idle + ld * 0.15 - a * 0.05;
    this.chest.rotation.x = breathe * 0.01 * idle;
    // cabeza: compensa la inclinación y mira hacia donde apunta la cámara
    this.neck.rotation.x = -this.lean * 0.7 - ld * 0.2 + (extra?.lookPitch ?? 0) * 0.3;
    this.neck.rotation.y = L.yaw * 0.75 - this.spine.rotation.y * 0.6 - this.hips.rotation.y * 0.5;
    this.neck.rotation.z = -this.spine.rotation.z * 0.5 - this.bank * 0.4;

    // ---- brazos: balanceo opuesto a las piernas ----
    const armAmp = (0.3 + 0.45 * r + sp * 0.15) * m;
    for (const arm of this.arms) {
      const p = arm.s > 0 ? ph + Math.PI : ph;
      const as = Math.sin(p);
      let sh = -as * armAmp - 0.08 * r * m;
      let el = -(0.12 + 0.18 * m + Math.max(0, as) * 0.2 * m * (1 - r) + 1.15 * r + sp * 0.15);
      let spread = 0.06 + 0.06 * r + breathe * 0.006 * idle;
      // quieto: brazos relajados
      sh += breathe * 0.015 * idle;
      // aire: brazos arriba y abiertos; cayendo mucho, se agitan
      const flail = vy < -8 ? Math.sin(this.time * 14 + arm.s) * 0.4 : 0;
      sh = THREE.MathUtils.lerp(sh, -0.7 - (vy > 0 ? 0.5 : 0) + flail, a);
      el = THREE.MathUtils.lerp(el, -0.7, a);
      spread = THREE.MathUtils.lerp(spread, 0.55, a);
      // aterrizaje: brazos hacia adelante para equilibrar
      sh -= ld * 0.4;
      el -= ld * 0.3;
      arm.shoulder.rotation.x = sh;
      arm.shoulder.rotation.z = arm.s * spread;
      arm.shoulder.rotation.y = 0;
      arm.elbow.rotation.x = el;
      arm.wrist.rotation.x = -0.1 - 0.25 * r * m;
      arm.wrist.rotation.z = arm.s * -0.08;
    }
    return footstep;
  }

  land(intensity) {
    this.blend.land = Math.min(1, 0.25 + intensity * 0.06);
  }

  // Las geometrías son compartidas: solo se liberan los materiales propios.
  dispose() {
    for (const m of Object.values(this.materials)) m.dispose();
  }
}
