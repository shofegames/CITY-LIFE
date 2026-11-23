import * as THREE from 'three';
import { VEHICLE_TYPES } from './VehicleTypes.js';

// ============================================================================
// Modelos 3D procedurales de los autos. Cada tipo tiene una plantilla
// (carrocería extruida desde un perfil lateral con bordes redondeados,
// habitáculo, vidrios, paragolpes, ópticas). Cada auto clona la geometría
// de la carrocería para poder tener su propio color y abolladuras.
// Frente del auto hacia +Z. Lado izquierdo (conductor) hacia +X.
// ============================================================================

const C = {
  trim: 0x1b1c1e, glass: 0x18222c, chrome: 0xd5d8db, plate: 0xeeeeee, under: 0x101010, grille: 0x0d0d0d, interior: 0x222326, seat: 0x3a2a22,
};

const templates = new Map();
let wheelGeo = null;

function shapeFrom(points) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  return s;
}

// Extruye un perfil (z,y) a lo ancho (x), centrado.
function extrude(points, width, bevel = 0.045) {
  const g = new THREE.ExtrudeGeometry(shapeFrom(points), {
    depth: Math.max(0.01, width - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 4,
  });
  g.rotateY(-Math.PI / 2);
  g.translate((width - bevel * 2) / 2, 0, 0);
  return g.index ? g.toNonIndexed() : g;
}

function box(w, h, d, x, y, z) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
}

// Quad de vidrio paralelo a una línea del perfil (parabrisas / luneta)
function glassQuad(a, b, halfW, normalSign) {
  const dz = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dz, dy);
  const uz = dz / len, uy = dy / len;
  let nz = dy / len, ny = -dz / len;
  if (nz * normalSign < 0) { nz = -nz; ny = -ny; }
  const inset = 0.07, off = 0.014;
  const p0 = [a[0] + uz * inset + nz * off, a[1] + uy * inset + ny * off];
  const p1 = [b[0] - uz * inset + nz * off, b[1] - uy * inset + ny * off];
  const pos = [
    -halfW, p0[1], p0[0], halfW, p0[1], p0[0], halfW, p1[1], p1[0],
    -halfW, p0[1], p0[0], halfW, p1[1], p1[0], -halfW, p1[1], p1[0],
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // asegurar que la normal mire hacia afuera
  const n = g.getAttribute('normal');
  if (n.getZ(0) * normalSign < 0 || (Math.abs(n.getZ(0)) < 0.05 && n.getY(0) < 0)) {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i += 3) {
      const tx = p.getX(i + 1), ty = p.getY(i + 1), tz = p.getZ(i + 1);
      p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
      p.setXYZ(i + 2, tx, ty, tz);
    }
    g.computeVertexNormals();
  }
  return g;
}

// Junta piezas {geo, color, paint} en una sola geometría con color por vértice.
function merge(pieces) {
  let count = 0;
  for (const p of pieces) count += p.geo.getAttribute('position').count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3), paint = new Float32Array(count);
  let o = 0;
  const c = new THREE.Color();
  for (const p of pieces) {
    const gp = p.geo.getAttribute('position'), gn = p.geo.getAttribute('normal');
    c.set(p.color ?? 0xffffff);
    for (let i = 0; i < gp.count; i++, o++) {
      pos[o * 3] = gp.getX(i); pos[o * 3 + 1] = gp.getY(i); pos[o * 3 + 2] = gp.getZ(i);
      nor[o * 3] = gn.getX(i); nor[o * 3 + 1] = gn.getY(i); nor[o * 3 + 2] = gn.getZ(i);
      col[o * 3] = c.r; col[o * 3 + 1] = c.g; col[o * 3 + 2] = c.b;
      paint[o] = p.paint ? (p.paintShade ?? 1) : 0;
    }
    p.geo.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('paint', new THREE.BufferAttribute(paint, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function getTemplate(typeId) {
  if (templates.has(typeId)) return templates.get(typeId);
  const T = VEHICLE_TYPES[typeId];
  const { L, W, H } = T.dims;
  const S = T.shape;
  const y0 = T.ride, belt = S.belt, nose = S.nose;
  const zF = L / 2, zR = -L / 2;
  const rear = S.rear;

  // ---- perfil inferior (carrocería) ----
  const lower = [[zR + 0.08, y0], [zF - 0.1, y0], [zF, y0 + 0.14], [zF + 0.02, nose - 0.06], [zF - 0.22, nose + 0.05], [zF - S.hood, belt]];
  if (rear === 'sedan' || rear === 'fastback') lower.push([zR + S.trunk, belt], [zR + 0.18, belt - 0.03], [zR, belt - 0.2], [zR - 0.02, y0 + 0.18]);
  else if (rear === 'pickup') lower.push([zR + 0.02, belt], [zR, belt - 0.06], [zR - 0.02, y0 + 0.18]);
  else lower.push([zR + 0.06, belt], [zR, belt - 0.1], [zR - 0.02, y0 + 0.18]);

  // ---- habitáculo ----
  const bF = [zF - S.hood, belt];
  const tF = [zF - S.hood - S.ws, H];
  let bR, tR;
  if (rear === 'sedan' || rear === 'fastback') { bR = [zR + S.trunk, belt]; tR = [zR + S.trunk + S.rw, H]; }
  else if (rear === 'pickup') { bR = [zR + S.trunk, belt]; tR = [zR + S.trunk + 0.08, H]; }
  else { bR = [zR + 0.08, belt]; tR = [zR + 0.08 + S.rw, H]; }
  const cabin = [bF, tF, tR, bR];
  const glass = [[bF[0] - 0.09, belt + 0.06], [tF[0] - 0.05, H - 0.07], [tR[0] + 0.05, H - 0.07], [bR[0] + 0.09, belt + 0.06]];

  const pieces = [];
  pieces.push({ geo: extrude(lower, W, 0.06), paint: true });
  pieces.push({ geo: extrude(cabin, W * 0.86, 0.05), paint: true });
  pieces.push({ geo: extrude(glass, W * 0.885, 0.0), color: C.glass });
  pieces.push({ geo: glassQuad(bF, tF, W * 0.4, 1), color: C.glass });
  pieces.push({ geo: glassQuad(bR, tR, W * 0.4, -1), color: C.glass });
  // pilar B
  const midZ = (tF[0] + tR[0]) / 2 + 0.1;
  pieces.push({ geo: box(W * 0.895, H - belt - 0.08, 0.1, 0, (H + belt) / 2, midZ), paint: true, paintShade: 0.85 });
  // paragolpes
  const bumper = T.shape.chrome ? C.chrome : C.trim;
  pieces.push({ geo: box(W + 0.04, 0.2, 0.22, 0, y0 + 0.14, zF - 0.03), color: bumper });
  pieces.push({ geo: box(W + 0.04, 0.2, 0.22, 0, y0 + 0.16, zR + 0.05), color: bumper });
  // parrilla y patentes
  pieces.push({ geo: box(W * 0.42, 0.14, 0.05, 0, nose - 0.16, zF + 0.04), color: T.shape.chrome ? C.chrome : C.grille });
  pieces.push({ geo: box(0.5, 0.12, 0.03, 0, y0 + 0.3, zF + 0.1), color: C.plate });
  pieces.push({ geo: box(0.5, 0.12, 0.03, 0, rear === 'sedan' || rear === 'fastback' ? belt - 0.35 : y0 + 0.4, zR - 0.04), color: C.plate });
  // bajo chasis y zócalos negros
  pieces.push({ geo: box(W * 0.94, 0.08, L * 0.94, 0, y0 + 0.02, 0), color: C.under });
  pieces.push({ geo: box(W + 0.02, 0.1, L * 0.55, 0, y0 + 0.06, 0), color: C.trim });
  // espejos
  for (const s of [-1, 1]) pieces.push({ geo: box(0.16, 0.1, 0.12, s * (W / 2 + 0.06), belt + 0.08, bF[0] - 0.15), paint: true });
  // caja de pickup (interior oscuro)
  if (rear === 'pickup') pieces.push({ geo: box(W * 0.84, 0.04, S.trunk - 0.25, 0, belt + 0.005, zR + S.trunk / 2 + 0.02), color: C.under });
  // alerón
  if (S.spoiler) {
    pieces.push({ geo: box(W * 0.92, 0.05, 0.32, 0, belt + 0.28, zR + 0.22), color: C.trim });
    for (const s of [-1, 1]) pieces.push({ geo: box(0.05, 0.26, 0.12, s * W * 0.32, belt + 0.14, zR + 0.25), color: C.trim });
  }
  // franjas de muscle car
  if (S.stripes) {
    for (const s of [-1, 1]) {
      pieces.push({ geo: box(0.16, 0.012, S.hood - 0.3, s * 0.14, belt - 0.005 + 0.02, zF - S.hood / 2 - 0.05).rotateX(0), color: 0xf2f2f2 });
    }
  }
  const body = merge(pieces);

  // ---- ópticas ----
  const head = merge([-1, 1].map((s) => ({ geo: box(W * 0.2, 0.11, 0.08, s * (W / 2 - W * 0.15), nose - 0.1, zF + 0.01), color: 0xffffff })));
  const tailY = rear === 'sedan' || rear === 'fastback' ? belt - 0.16 : belt - 0.12;
  const tail = merge([-1, 1].map((s) => ({ geo: box(W * 0.24, 0.1, 0.06, s * (W / 2 - W * 0.16), tailY, zR - 0.02), color: 0xffffff })));

  // ---- interior (solo visible en cámara de cabina) ----
  const ip = [];
  ip.push({ geo: box(W * 0.9, 0.16, 0.45, 0, belt + 0.02, bF[0] - 0.3), color: C.interior });
  ip.push({ geo: box(W * 0.84, 0.04, (tF[0] - tR[0]), 0, H - 0.08, (tF[0] + tR[0]) / 2), color: C.interior });
  const wheelRing = new THREE.TorusGeometry(0.17, 0.025, 6, 16).rotateX(-0.35).translate(W * 0.22, belt + 0.22, bF[0] - 0.62).toNonIndexed();
  ip.push({ geo: wheelRing, color: C.trim });
  // pilares A vistos desde adentro
  for (const s of [-1, 1]) {
    const g = box(0.08, Math.hypot(S.ws, H - belt), 0.06, 0, 0, 0);
    g.rotateX(Math.atan2(S.ws, H - belt));
    g.translate(s * W * 0.41, (belt + H) / 2, (bF[0] + tF[0]) / 2);
    ip.push({ geo: g, color: C.interior });
  }
  const interior = merge(ip);

  const tpl = {
    body, head, tail, interior,
    dims: { L, W, H }, wheelbase: T.wheelbase, wheelR: T.wheelR, track: W - 0.25, ride: y0,
    driverEye: new THREE.Vector3(W * 0.22, belt + 0.45, bF[0] - 0.95),
    headPos: new THREE.Vector3(0, nose - 0.1, zF + 0.05),
  };
  templates.set(typeId, tpl);
  return tpl;
}

// Rueda de radio 1 (se escala por instancia): neumático + llanta.
export function getWheelGeometry() {
  if (wheelGeo) return wheelGeo;
  const tire = new THREE.CylinderGeometry(1, 1, 0.62, 18, 1).rotateZ(Math.PI / 2).toNonIndexed();
  const rim = new THREE.CylinderGeometry(0.64, 0.64, 0.64, 10, 1).rotateZ(Math.PI / 2).toNonIndexed();
  const hub = new THREE.CylinderGeometry(0.2, 0.2, 0.66, 8, 1).rotateZ(Math.PI / 2).toNonIndexed();
  // rayos para que se note el giro
  const spokes = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.BoxGeometry(0.66, 0.12, 1.15).rotateX((i / 5) * Math.PI).toNonIndexed();
    spokes.push({ geo: g, color: 0x8f969c });
  }
  wheelGeo = merge([{ geo: tire, color: 0x161616 }, { geo: rim, color: 0x5d6368 }, ...spokes, { geo: hub, color: 0xc9cdd1 }]);
  return wheelGeo;
}
