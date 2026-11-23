import { bus } from './EventBus.js';

// Acciones del juego. "context" evita conflictos: una tecla puede repetirse
// entre acciones de contextos distintos (ej. Espacio = saltar a pie / freno de mano en auto).
export const ACTIONS = {
  forward: { label: 'Adelante / Acelerar', context: 'both' },
  back: { label: 'Atrás / Frenar y marcha atrás', context: 'both' },
  left: { label: 'Izquierda / Girar a la izquierda', context: 'both' },
  right: { label: 'Derecha / Girar a la derecha', context: 'both' },
  sprint: { label: 'Correr (mantener para sprint)', context: 'foot' },
  jump: { label: 'Saltar', context: 'foot' },
  interact: { label: 'Interactuar', context: 'foot' },
  vehicle: { label: 'Entrar / salir del vehículo', context: 'both' },
  handbrake: { label: 'Freno de mano', context: 'vehicle' },
  horn: { label: 'Bocina', context: 'vehicle' },
  camera: { label: 'Cambiar cámara', context: 'both' },
  map: { label: 'Mapa', context: 'both' },
  switchChar: { label: 'Cambiar de protagonista', context: 'both' },
};

// Primera tecla = principal (configurable). Las siguientes son alternativas fijas.
export const DEFAULT_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  interact: ['KeyE'],
  vehicle: ['KeyF'],
  handbrake: ['Space'],
  horn: ['KeyH'],
  camera: ['KeyC'],
  map: ['KeyM'],
  switchChar: ['KeyQ'],
};

const NAMES = {
  Space: 'Espacio', ShiftLeft: 'Shift', ShiftRight: 'Shift Der.', ControlLeft: 'Ctrl', ControlRight: 'Ctrl Der.',
  AltLeft: 'Alt', AltRight: 'Alt Gr', Enter: 'Enter', Tab: 'Tab', Backspace: 'Borrar', Escape: 'Esc',
  ArrowUp: 'Flecha arriba', ArrowDown: 'Flecha abajo', ArrowLeft: 'Flecha izq.', ArrowRight: 'Flecha der.',
  CapsLock: 'Bloq Mayús', Backquote: 'º', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Semicolon: 'Ñ', Quote: "'", Comma: ',', Period: '.', Slash: '-', Backslash: '\\', IntlBackslash: '<',
};

export function keyName(code) {
  if (!code) return '—';
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

export class Input {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.down = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.gameActive = false;
    this.context = 'foot';
    this.rebindCallback = null;
    this.dragging = false;

    this._onKeyDown = (e) => this.onKeyDown(e);
    this._onKeyUp = (e) => this.onKeyUp(e);
    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', () => this.down.clear());

    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (was !== this.locked) bus.emit('input:lockchange', this.locked);
    });
    document.addEventListener('pointerlockerror', () => bus.emit('input:lockerror'));

    document.addEventListener('mousemove', (e) => {
      if (this.locked || this.dragging) {
        // algunos navegadores entregan saltos enormes al capturar el mouse; se filtran
        if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });

    // Respaldo si el navegador no permite capturar el mouse: arrastrar con clic.
    canvas.addEventListener('mousedown', (e) => {
      if (!this.gameActive) return;
      if (!this.locked) {
        this.requestLock();
        this.dragging = true;
      }
      e.preventDefault();
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      if (this.gameActive) {
        bus.emit('input:wheel', Math.sign(e.deltaY));
        e.preventDefault();
      }
    }, { passive: false });
  }

  get bindings() {
    return this.settings.get('bindings');
  }

  codesFor(action) {
    return this.bindings[action] || [];
  }

  actionsForCode(code) {
    const list = [];
    for (const [action, codes] of Object.entries(this.bindings)) {
      if (codes.includes(code)) list.push(action);
    }
    return list;
  }

  activeInContext(action) {
    const ctx = ACTIONS[action]?.context;
    return ctx === 'both' || ctx === this.context;
  }

  onKeyDown(e) {
    if (this.rebindCallback) {
      e.preventDefault();
      const cb = this.rebindCallback;
      this.rebindCallback = null;
      cb(e.code === 'Escape' ? null : e.code);
      return;
    }
    if (e.code === 'Escape') {
      bus.emit('input:escape');
      return;
    }
    const actions = this.actionsForCode(e.code);
    if (this.gameActive && (actions.length || e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab')) {
      e.preventDefault(); // evita scroll y foco de botones
    }
    if (!this.down.has(e.code) && !e.repeat) {
      for (const a of actions) this.pressed.add(a);
    }
    this.down.add(e.code);
  }

  onKeyUp(e) {
    this.down.delete(e.code);
  }

  isDown(action) {
    if (!this.gameActive || !this.activeInContext(action)) return false;
    for (const code of this.codesFor(action)) if (this.down.has(code)) return true;
    return false;
  }

  wasPressed(action) {
    if (!this.gameActive || !this.activeInContext(action)) return false;
    return this.pressed.has(action);
  }

  // Eje -1..1 a partir de dos acciones
  axis(neg, pos) {
    return (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0);
  }

  consumeMouse() {
    const s = this.settings.get('mouseSensitivity');
    const d = { dx: this.mouseDX * s, dy: this.mouseDY * s * (this.settings.get('invertY') ? -1 : 1) };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  endFrame() {
    this.pressed.clear();
  }

  requestLock() {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => bus.emit('input:lockerror'));
    } catch {
      bus.emit('input:lockerror');
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
    this.dragging = false;
  }

  setGameActive(active) {
    this.gameActive = active;
    if (!active) {
      this.down.clear();
      this.pressed.clear();
      this.mouseDX = this.mouseDY = 0;
    }
  }

  // Rebind: devuelve conflictos resueltos intercambiando teclas dentro del mismo contexto.
  listenForKey(cb) {
    this.rebindCallback = cb;
  }

  setBinding(action, code) {
    const bindings = this.bindings;
    const ctxA = ACTIONS[action].context;
    const oldPrimary = bindings[action][0];
    for (const [other, codes] of Object.entries(bindings)) {
      if (other === action) continue;
      const ctxB = ACTIONS[other].context;
      const overlap = ctxA === 'both' || ctxB === 'both' || ctxA === ctxB;
      if (overlap && codes[0] === code) codes[0] = oldPrimary; // intercambio
      const idx = codes.indexOf(code);
      if (overlap && idx > 0) codes.splice(idx, 1);
    }
    bindings[action][0] = code;
    this.settings.set('bindings', bindings);
  }
}
