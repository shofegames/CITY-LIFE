import * as THREE from 'three';

// ============================================================================
// Personaje humanoide procedural con esqueleto jerárquico y animación
// procedimental (idle, caminar, correr, sprint, saltar, caer, aterrizar).
// La cadencia de pasos se sincroniza con la distancia recorrida: sin pies
// que patinan. Mira hacia +Z en espacio local.
// ============================================================================

const SKIN_TONES = [0xf1c7a5, 0xe0ac87, 0xc68b62, 0x9c6644, 0x6f4a32];

export class CharacterModel {
  constructor(look = {}) {
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
    this.root = new THREE.Group();
    this.root.name = 'Character';
    this.phase = 0;
    this.blend = { move: 0, run: 0, air: 0, land: 0 };
    this.lean = 0;
    this.time = Math.random() * 10;
    this.build();
  }

  mat(color, rough = 0.8) {
    return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
  }

  limb(radius, length, material, parent, y = 0) {
    const g = new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 4, 10);
    g.translate(0, -length / 2, 0);
    const m = new THREE.Mesh(g, material);
    m.castShadow = true;
    m.position.y = y;
    parent.add(m);
    return m;
  }

  joint(parent, x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }

  build() {
    const L = this.look;
    const skin = this.mat(L.skin, 0.65), shirt = this.mat(L.shirt, 0.85), pants = this.mat(L.pants, 0.9);
    const shoes = this.mat(L.shoes, 0.6), hair = this.mat(L.hair, 0.9), dark = this.mat(0x15171b, 0.5);
    this.materials = { skin, shirt, pants, shoes, hair };

    // pelvis (se mueve con el rebote del paso)
    this.hips = this.joint(this.root, 0, 0.98, 0);
    const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.12, 4, 10), pants);
    pelvis.rotation.z = Math.PI / 2;
    pelvis.scale.set(1, 1, 0.75);
    pelvis.castShadow = true;
    this.hips.add(pelvis);

    // torso
    this.spine = this.joint(this.hips, 0, 0.06, 0);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.32, 4, 12), shirt);
    torso.position.y = 0.26;
    const slim = L.build === 'slim';
    torso.scale.set(slim ? 0.98 : 1.12, 1, slim ? 0.64 : 0.68);
    torso.castShadow = true;
    this.spine.add(torso);
    this.chest = this.joint(this.spine, 0, 0.42, 0);
    // cuello y cabeza
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.12, 8), skin);
    neck.position.y = 0.06;
    this.chest.add(neck);
    this.head = this.joint(this.chest, 0, 0.12, 0);
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), skin);
    headMesh.scale.set(0.92, 1.08, 1);
    headMesh.position.y = 0.11;
    headMesh.castShadow = true;
    this.head.add(headMesh);
    const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.122, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
    hairMesh.scale.set(0.95, 1.05, 1.05);
    hairMesh.position.set(0, 0.13, -0.01);
    hairMesh.rotation.x = -0.25;
    this.head.add(hairMesh);
    if (L.hairStyle === 'long') {
      const back = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.16, 4, 8), hair);
      back.position.set(0, 0.06, -0.07);
      back.scale.set(1.15, 1, 0.6);
      this.head.add(back);
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.2, 4, 6), hair);
      tail.position.set(0, -0.02, -0.14);
      tail.rotation.x = 0.35;
      this.head.add(tail);
    }
    if (L.jacket) {
      const jk = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.3, 4, 12), this.mat(L.jacket, 0.7));
      jk.position.y = 0.25;
      jk.scale.set((slim ? 0.98 : 1.12) * 1.06, 1.02, (slim ? 0.64 : 0.68) * 1.1);
      jk.castShadow = true;
      this.spine.add(jk);
    }
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), dark);
      eye.position.set(s * 0.04, 0.125, 0.1);
      this.head.add(eye);
    }
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.045, 6), skin);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.095, 0.115);
    this.head.add(nose);

    // brazos
    this.arms = [];
    for (const s of [-1, 1]) {
      const shoulder = this.joint(this.chest, s * (slim ? 0.19 : 0.215), -0.02, 0);
      const sleeve = this.limb(slim ? 0.05 : 0.058, 0.3, L.jacket ? this.mat(L.jacket, 0.7) : shirt, shoulder);
      const elbow = this.joint(shoulder, 0, -0.29, 0);
      this.limb(0.048, 0.27, skin, elbow);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), skin);
      hand.scale.set(0.8, 1.15, 0.6);
      hand.position.y = -0.3;
      hand.castShadow = true;
      elbow.add(hand);
      this.arms.push({ s, shoulder, elbow, sleeve });
    }

    // piernas
    this.legs = [];
    for (const s of [-1, 1]) {
      const hip = this.joint(this.hips, s * 0.095, -0.02, 0);
      this.limb(0.078, 0.46, pants, hip);
      const knee = this.joint(hip, 0, -0.45, 0);
      this.limb(0.064, 0.45, pants, knee);
      const ankle = this.joint(knee, 0, -0.45, 0);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.075, 0.25), shoes);
      foot.position.set(0, -0.03, 0.05);
      foot.castShadow = true;
      ankle.add(foot);
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

  dispose() {
    this.root.traverse((o) => {
      o.geometry?.dispose();
    });
    for (const m of Object.values(this.materials)) m.dispose();
  }
}
