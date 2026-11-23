import { CharacterModel } from './CharacterModel.js';

// ============================================================================
// Los dos protagonistas de CITY LIFE. Cada uno tiene su propia vida en
// San Vega (posición, salud, misiones). El dinero es compartido.
// ============================================================================

export const PROTAGONISTS = {
  nico: {
    id: 'nico', name: 'Nico Vargas', short: 'NICO', color: '#4cc9f0',
    bio: 'Mecánico y piloto callejero. Llegó a San Vega con una mochila y una deuda.',
    look: { skin: 0xe0ac87, shirt: 0x2f6fb3, pants: 0x2b2f3a, shoes: 0xf2f2f2, hair: 0x2a1d14 },
  },
  lara: {
    id: 'lara', name: 'Lara Quintero', short: 'LARA', color: '#ff8fa3',
    bio: 'Ex custodia de seguridad. Ahora consigue cosas difíciles para clientes caros.',
    look: { skin: 0xc68b62, shirt: 0xf2f2f2, jacket: 0x7a1f2b, pants: 0x1d1f26, shoes: 0x222222, hair: 0x1a1210, hairStyle: 'long', build: 'slim' },
  },
};

export const LARA_START = { x: -308, y: 0.15, z: -330, yaw: 0, health: 100 };

export class ProtagonistSystem {
  constructor() {
    this.current = 'nico';
    this.models = {};
  }

  model(id) {
    if (!this.models[id]) this.models[id] = new CharacterModel(PROTAGONISTS[id].look);
    return this.models[id];
  }

  get info() {
    return PROTAGONISTS[this.current];
  }

  other() {
    return this.current === 'nico' ? 'lara' : 'nico';
  }
}
