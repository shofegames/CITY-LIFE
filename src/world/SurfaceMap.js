import { BEACH } from './CityLayout.js';

// ============================================================================
// Mapa de superficies (grilla de 2 m): define el agarre de los neumáticos.
// ============================================================================

export const SURFACE = { GRASS: 0, ASPHALT: 1, CONCRETE: 2, LAWN: 3, SAND: 4, WATER: 5, DIRT: 6 };

export const SURFACE_PROPS = {
  0: { name: 'pasto', grip: 0.62, roll: 0.035 },
  1: { name: 'asfalto', grip: 1.0, roll: 0.012 },
  2: { name: 'vereda', grip: 0.95, roll: 0.014 },
  3: { name: 'pasto', grip: 0.62, roll: 0.035 },
  4: { name: 'arena', grip: 0.5, roll: 0.07 },
  5: { name: 'agua', grip: 0.3, roll: 0.25 },
  6: { name: 'tierra', grip: 0.72, roll: 0.03 },
};

const CELL = 2, MIN_X = -620, MIN_Z = -620, W = 660, H = 620;

export class SurfaceMap {
  constructor(layout) {
    this.grid = new Uint8Array(W * H);
    this.island = layout.island || null;
    this.ext = layout.roadExtent;
    const fill = (x0, z0, x1, z1, v) => {
      const i0 = Math.max(0, Math.floor((x0 - MIN_X) / CELL)), i1 = Math.min(W - 1, Math.ceil((x1 - MIN_X) / CELL) - 1);
      const j0 = Math.max(0, Math.floor((z0 - MIN_Z) / CELL)), j1 = Math.min(H - 1, Math.ceil((z1 - MIN_Z) / CELL) - 1);
      for (let j = j0; j <= j1; j++) this.grid.fill(v, j * W + i0, j * W + i1 + 1);
    };
    const E = layout.roadExtent;
    fill(E.min, E.min, E.max, E.max, SURFACE.ASPHALT);
    for (const b of layout.blocks) fill(b.x0, b.z0, b.x1, b.z1, SURFACE.CONCRETE);
    for (const s of layout.surfaces) {
      const v = { grass: SURFACE.LAWN, pond: SURFACE.WATER, pool: SURFACE.WATER, parking: SURFACE.ASPHALT }[s.type];
      if (v !== undefined) fill(s.x0, s.z0, s.x1, s.z1, v);
    }
    fill(BEACH.x0 + 7, MIN_Z, BEACH.waterX, MIN_Z + H * CELL, SURFACE.SAND);
    fill(BEACH.waterX, MIN_Z, MIN_X + W * CELL, MIN_Z + H * CELL, SURFACE.WATER);
  }

  at(x, z) {
    const E = this.ext;
    if (this.island && !(x >= E.min && x <= E.max && z >= E.min && z <= E.max) && !(x > BEACH.x0 && Math.abs(z) <= E.max + 40)) {
      return this.island.surfaceAt(x, z);
    }
    const i = Math.floor((x - MIN_X) / CELL), j = Math.floor((z - MIN_Z) / CELL);
    if (i < 0 || j < 0 || i >= W || j >= H) return SURFACE.GRASS;
    return this.grid[j * W + i];
  }

  props(x, z) {
    return SURFACE_PROPS[this.at(x, z)];
  }
}
