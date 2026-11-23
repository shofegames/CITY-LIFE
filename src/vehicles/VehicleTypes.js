// ============================================================================
// Catálogo de vehículos de San Vega (modelos originales de SHOFE GAMES).
// Física: masa (kg), potencia (W), fuerza máxima de tracción (N), velocidad
// máxima (m/s), agarre (μ), tracción (fwd/rwd/awd), freno (N), giro máx. (rad).
// Forma: alto de carrocería, cintura, capó, parabrisas, baúl y estilo trasero.
// ============================================================================

export const VEHICLE_TYPES = {
  vento: {
    name: 'Vento', category: 'Sedán', price: 18000,
    dims: { L: 4.6, W: 1.8, H: 1.45 }, wheelbase: 2.7, wheelR: 0.33, ride: 0.3,
    mass: 1350, power: 95000, maxForce: 6200, vmax: 52, grip: 0.95, drive: 'fwd', brake: 11000, steerMax: 0.6,
    shape: { belt: 0.92, hood: 1.25, ws: 0.75, rw: 0.6, trunk: 0.85, rear: 'sedan', nose: 0.62 },
    palette: [0xd8dadc, 0x1f2a44, 0x7b1e1e, 0x2d2d2d, 0xb7bcc2, 0x3c5a3a, 0xf2f2f0],
  },
  pico: {
    name: 'Pico', category: 'Hatchback', price: 12000,
    dims: { L: 3.95, W: 1.72, H: 1.48 }, wheelbase: 2.5, wheelR: 0.31, ride: 0.3,
    mass: 1100, power: 70000, maxForce: 5200, vmax: 47, grip: 0.95, drive: 'fwd', brake: 9500, steerMax: 0.65,
    shape: { belt: 0.92, hood: 0.95, ws: 0.75, rw: 0.25, trunk: 0.12, rear: 'hatch', nose: 0.64 },
    palette: [0xe8b923, 0xc0392b, 0x2e86de, 0xf2f2f0, 0x16a085, 0x6c3483, 0x34495e],
  },
  atlas: {
    name: 'Atlas', category: 'SUV', price: 32000,
    dims: { L: 4.8, W: 1.95, H: 1.75 }, wheelbase: 2.85, wheelR: 0.38, ride: 0.4,
    mass: 2000, power: 150000, maxForce: 9500, vmax: 50, grip: 0.92, drive: 'awd', brake: 15000, steerMax: 0.55,
    shape: { belt: 1.12, hood: 1.15, ws: 0.65, rw: 0.2, trunk: 0.1, rear: 'suv', nose: 0.85 },
    palette: [0x111111, 0xf2f2f0, 0x5d6d7e, 0x1b4f72, 0x784212, 0x7d8a6a],
  },
  ranchero: {
    name: 'Ranchero', category: 'Pickup', price: 28000,
    dims: { L: 5.3, W: 1.95, H: 1.8 }, wheelbase: 3.2, wheelR: 0.38, ride: 0.42,
    mass: 2200, power: 160000, maxForce: 10500, vmax: 48, grip: 0.9, drive: 'rwd', brake: 15500, steerMax: 0.55,
    shape: { belt: 1.15, hood: 1.35, ws: 0.6, rw: 0.15, trunk: 1.85, rear: 'pickup', nose: 0.9 },
    palette: [0x922b21, 0xf2f2f0, 0x1c2833, 0x2471a3, 0xb9770e, 0x566573],
  },
  furia: {
    name: 'Furia GT', category: 'Deportivo', price: 85000,
    dims: { L: 4.4, W: 1.85, H: 1.3 }, wheelbase: 2.55, wheelR: 0.34, ride: 0.24,
    mass: 1400, power: 280000, maxForce: 11500, vmax: 72, grip: 1.1, drive: 'rwd', brake: 15000, steerMax: 0.55,
    shape: { belt: 0.82, hood: 1.35, ws: 0.95, rw: 0.95, trunk: 0.35, rear: 'fastback', nose: 0.5 },
    palette: [0xc0392b, 0xf1c40f, 0x2980b9, 0xecf0f1, 0x1c1c1c, 0x27ae60],
  },
  aurora: {
    name: 'Aurora X', category: 'Superdeportivo', price: 340000,
    dims: { L: 4.55, W: 1.98, H: 1.15 }, wheelbase: 2.65, wheelR: 0.35, ride: 0.2,
    mass: 1450, power: 520000, maxForce: 15500, vmax: 92, grip: 1.22, drive: 'awd', brake: 19000, steerMax: 0.5,
    shape: { belt: 0.72, hood: 1.5, ws: 1.1, rw: 1.15, trunk: 0.25, rear: 'fastback', nose: 0.42, spoiler: true },
    palette: [0xff6b2c, 0x8e44ad, 0x00bcd4, 0xf5f5f5, 0x111111, 0x76ff03],
  },
  toro: {
    name: 'Toro 440', category: 'Muscle car', price: 65000,
    dims: { L: 4.9, W: 1.92, H: 1.35 }, wheelbase: 2.85, wheelR: 0.35, ride: 0.27,
    mass: 1650, power: 330000, maxForce: 12500, vmax: 75, grip: 0.98, drive: 'rwd', brake: 14000, steerMax: 0.55,
    shape: { belt: 0.9, hood: 1.65, ws: 0.7, rw: 0.7, trunk: 0.8, rear: 'sedan', nose: 0.72, stripes: true },
    palette: [0x1a237e, 0xb71c1c, 0x212121, 0xff8f00, 0x1b5e20, 0xeeeeee],
  },
  clasico: {
    name: 'Clásico 62', category: 'Clásico', price: 45000,
    dims: { L: 5.0, W: 1.9, H: 1.4 }, wheelbase: 2.9, wheelR: 0.36, ride: 0.3,
    mass: 1600, power: 140000, maxForce: 8500, vmax: 50, grip: 0.85, drive: 'rwd', brake: 10000, steerMax: 0.6,
    shape: { belt: 0.88, hood: 1.5, ws: 0.55, rw: 0.55, trunk: 1.15, rear: 'sedan', nose: 0.7, chrome: true },
    palette: [0x76d7c4, 0xf5cba7, 0xec7063, 0xfdfefe, 0x5dade2, 0xf7dc6f],
  },
};

// Probabilidad de aparición en el tráfico
export const TRAFFIC_WEIGHTS = { vento: 30, pico: 25, atlas: 18, ranchero: 10, toro: 5, clasico: 5, furia: 5, aurora: 2 };

export function pickTrafficType(rnd) {
  const total = Object.values(TRAFFIC_WEIGHTS).reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (const [k, w] of Object.entries(TRAFFIC_WEIGHTS)) {
    r -= w;
    if (r <= 0) return k;
  }
  return 'vento';
}
