import { readJSON, writeJSON, removeKey } from './storage.js';
import { bus } from './EventBus.js';

const MAIN = 'citylife.save.v1';
const BACKUP = 'citylife.save.v1.bak';
export const SAVE_VERSION = 1;

// Estado inicial de una partida nueva.
export function newGameState(spawn = { x: 0, y: 0.15, z: 0, yaw: 0 }) {
  return {
    version: SAVE_VERSION,
    createdAt: Date.now(),
    savedAt: 0,
    playTime: 0,
    money: 500,
    health: 100,
    timeOfDay: 9.0,
    player: { ...spawn },
    current: 'nico',
    characters: { nico: { ...spawn, health: 100 }, lara: { x: -308, y: 0.15, z: -330, yaw: 0, health: 100 } },
    completedMissions: [],
    ownedVehicles: [],
    properties: [],
    garages: {},
    stats: { distanceWalked: 0, jumps: 0 },
  };
}

function valid(s) {
  return s && typeof s === 'object' && s.version === SAVE_VERSION && s.player && Number.isFinite(s.player.x) && Number.isFinite(s.money);
}

// Guardado local con copia de respaldo: si el principal se corrompe se recupera el anterior.
export class SaveSystem {
  hasSave() {
    return valid(readJSON(MAIN)) || valid(readJSON(BACKUP));
  }

  load() {
    const main = readJSON(MAIN);
    if (valid(main)) return { ...newGameState(), ...main };
    const bak = readJSON(BACKUP);
    if (valid(bak)) return { ...newGameState(), ...bak };
    return null;
  }

  save(state) {
    const prev = readJSON(MAIN);
    if (valid(prev)) writeJSON(BACKUP, prev);
    state.savedAt = Date.now();
    const ok = writeJSON(MAIN, state);
    bus.emit('save:written', { ok });
    return ok;
  }

  wipe() {
    removeKey(MAIN);
    removeKey(BACKUP);
  }
}
