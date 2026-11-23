import { bus } from '../core/EventBus.js';
import { ACTIONS, keyName } from '../core/Input.js';
import { QUALITY_PRESETS } from '../core/Settings.js';

// ============================================================================
// UI: pantallas (carga, menú, pausa, configuración, ayuda, mapa), HUD,
// avisos, tutorial y diálogos. HTML/CSS livianos sobre el canvas.
// ============================================================================

const $ = (id) => document.getElementById(id);

const TIPS = [
  'Mantené Shift para correr. Si lo seguís manteniendo, hacés sprint.',
  'Presioná M para ver el mapa completo de San Vega.',
  'Si el juego va lento, probá la calidad Baja en Configuración → Gráficos.',
  'Con la rueda del mouse acercás o alejás la cámara.',
  'Tu partida se guarda sola cada minuto. También podés guardar desde la pausa.',
  'De noche las ventanas se encienden y los faroles iluminan las veredas.',
];

export class UI {
  constructor(game) {
    this.game = game;
    this.settings = game.settings;
    this.input = game.input;
    this.stack = [];
    this.current = 'loading';
    this.toastTimer = 0;
    this.districtTimer = 0;
    this.lastDistrict = null;
    this.tut = null;
    $('version').textContent = game.version;
    $('loading-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];

    document.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        bus.emit('ui:click');
        this.onAction(el.dataset.action);
      });
    });
    document.querySelectorAll('#settings-tabs .tab').forEach((t) => {
      t.addEventListener('click', () => {
        bus.emit('ui:click');
        this.openTab(t.dataset.tab);
      });
    });
    $('tut-skip').addEventListener('click', () => this.endTutorial(true));
    $('dialog-cancel').addEventListener('click', () => this.closeDialog(false));
    $('dialog-ok').addEventListener('click', () => this.closeDialog(true));
    bus.on('settings:changed', ({ key }) => {
      if (key === 'bindings') this.buildHelp();
    });
    this.buildHelp();
    $('map-legend').innerHTML = '';
  }

  // ------------------------------------------------------------------ pantallas
  showScreen(id, push = false) {
    if (push && this.current) this.stack.push(this.current);
    else if (!push) this.stack.length = 0;
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    if (id && id !== 'game') $(`screen-${id}`).classList.add('active');
    this.current = id;
    if (id === 'settings') this.buildSettings();
    if (id === 'map') requestAnimationFrame(() => this.game.drawFullMap());
  }

  back() {
    const prev = this.stack.pop();
    if (prev === undefined) return false;
    this.showScreen(prev, false);
    // conservar el resto de la pila
    return true;
  }

  onAction(action) {
    const g = this.game;
    switch (action) {
      case 'continue': return g.continueGame();
      case 'new-game': return g.requestNewGame();
      case 'resume': return g.resume();
      case 'save': return g.saveGame(true);
      case 'load': return g.loadGame();
      case 'quit': return g.quitToMenu();
      case 'map': return this.showScreen('map', true);
      case 'settings': return this.showScreen('settings', true);
      case 'how-to-play': return this.showScreen('help', true);
      case 'credits': return this.showScreen('credits', true);
      case 'close-shop': return g.closeShop();
      case 'back': {
        if (this.current === 'map' && this.stack.length === 0) return g.closeMap();
        if (!this.back()) g.resume();
        return;
      }
    }
  }

  setLoading(p, text) {
    $('loading-fill').style.width = `${Math.round(p * 100)}%`;
    $('loading-text').textContent = text;
  }

  showError(msg) {
    $('error-text').textContent = msg;
    this.showScreen('error');
  }

  setMenuState(hasSave) {
    const c = $('btn-continue');
    c.disabled = !hasSave;
    c.classList.toggle('hidden', !hasSave);
  }

  // ------------------------------------------------------------------ diálogo
  confirm(title, text, okLabel = 'Aceptar') {
    $('dialog-title').textContent = title;
    $('dialog-text').textContent = text;
    $('dialog-ok').textContent = okLabel;
    $('dialog').classList.remove('hidden');
    return new Promise((res) => (this.dialogResolve = res));
  }

  closeDialog(ok) {
    bus.emit('ui:click');
    $('dialog').classList.add('hidden');
    const r = this.dialogResolve;
    this.dialogResolve = null;
    r?.(ok);
  }

  get dialogOpen() {
    return !$('dialog').classList.contains('hidden');
  }

  // ------------------------------------------------------------------ ayuda
  keysFor(action) {
    const codes = this.settings.get('bindings')[action] || [];
    return codes.slice(0, 1).map((c) => `<kbd>${keyName(c)}</kbd>`).join(' ');
  }

  buildHelp() {
    const row = (k, label) => `<tr><td>${k}</td><td>${label}</td></tr>`;
    const move = `${this.keysFor('forward')} ${this.keysFor('left')} ${this.keysFor('back')} ${this.keysFor('right')}`;
    $('help-foot').innerHTML = [
      row(move, 'Moverse'),
      row(this.keysFor('sprint'), 'Correr (mantener para sprint)'),
      row(this.keysFor('jump'), 'Saltar'),
      row(this.keysFor('interact'), 'Interactuar'),
      row(this.keysFor('vehicle'), 'Entrar / salir del vehículo'),
      row('<kbd>Mouse</kbd>', 'Mover la cámara'),
      row('<kbd>Rueda</kbd> ' + this.keysFor('camera'), 'Distancia de cámara'),
      row(this.keysFor('map'), 'Mapa'),
      row(this.keysFor('switchChar'), 'Cambiar entre Nico y Lara'),
      row('<kbd>Esc</kbd>', 'Pausa'),
    ].join('');
    $('help-vehicle').innerHTML = [
      row(this.keysFor('forward'), 'Acelerar'),
      row(this.keysFor('back'), 'Frenar / marcha atrás'),
      row(`${this.keysFor('left')} ${this.keysFor('right')}`, 'Girar'),
      row(this.keysFor('handbrake'), 'Freno de mano'),
      row(this.keysFor('horn'), 'Bocina'),
      row(this.keysFor('camera'), 'Cambiar cámara'),
      row(this.keysFor('radio'), 'Cambiar emisora de radio'),
      row(this.keysFor('vehicle'), 'Salir del vehículo'),
      row('<kbd>Esc</kbd>', 'Pausa'),
    ].join('');
  }

  // ------------------------------------------------------------------ configuración
  openTab(tab) {
    document.querySelectorAll('#settings-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    for (const id of ['graphics', 'audio', 'controls', 'game']) $(`tab-${id}`).classList.toggle('hidden', id !== tab);
  }

  buildSettings() {
    const s = this.settings;
    const hw = s.hardware;
    const g = $('tab-graphics');
    const presetOptions = Object.entries(QUALITY_PRESETS).map(([k, p]) => `<option value="${k}" ${s.get('quality') === k ? 'selected' : ''}>${p.label}${k === hw.recommended ? ' (recomendada)' : ''}</option>`).join('');
    g.innerHTML = `
      ${this.rowSelect('quality', 'Calidad gráfica', `Recomendada para tu equipo: <b>${QUALITY_PRESETS[hw.recommended].label}</b>`, presetOptions)}
      ${this.rowRange('resolutionScale', 'Resolución de render', 'Menos resolución = más fluidez', 0.5, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
      ${this.rowRange('drawDistance', 'Distancia de dibujado', 'Hasta dónde se ve la ciudad', 180, 800, 20, (v) => `${v} m`)}
      ${this.rowCheck('shadows', 'Sombras', 'Desactivarlas mejora mucho el rendimiento')}
      ${this.rowSelect('fpsLimit', 'Límite de FPS', 'Limitar ahorra batería y evita calentamiento', [30, 60, 0].map((v) => `<option value="${v}" ${s.get('fpsLimit') === v ? 'selected' : ''}>${v ? v + ' FPS' : 'Sin límite'}</option>`).join(''))}
      ${this.rowCheck('dynamicResolution', 'Resolución dinámica', 'Baja la resolución automáticamente si el juego se pone lento')}
      ${this.rowCheck('showFps', 'Mostrar FPS', '')}
      <p class="muted">GPU detectada: ${escapeHTML(String(hw.gpu))} · ${hw.cores} núcleos</p>`;
    const a = $('tab-audio');
    const pct = (v) => `${Math.round(v * 100)}%`;
    a.innerHTML = `
      ${this.rowRange('masterVolume', 'Volumen general', '', 0, 1, 0.05, pct)}
      ${this.rowRange('musicVolume', 'Música', '', 0, 1, 0.05, pct)}
      ${this.rowRange('sfxVolume', 'Efectos', 'Pasos, motores, choques', 0, 1, 0.05, pct)}
      ${this.rowRange('ambientVolume', 'Ambiente', 'Sonido de la ciudad', 0, 1, 0.05, pct)}`;
    const c = $('tab-controls');
    const binds = Object.entries(ACTIONS).map(([action, def]) => `
      <div class="row"><label>${def.label}<span class="hint">${def.context === 'foot' ? 'A pie' : def.context === 'vehicle' ? 'En vehículo' : 'A pie y en vehículo'}</span></label>
      <button class="btn btn-small keybind" data-bind="${action}">${keyName(s.get('bindings')[action][0])}</button></div>`).join('');
    c.innerHTML = `
      ${this.rowRange('mouseSensitivity', 'Sensibilidad del mouse', '', 0.2, 3, 0.1, (v) => v.toFixed(1))}
      ${this.rowCheck('invertY', 'Invertir eje vertical', '')}
      ${binds}
      <div class="row"><label>Restablecer teclas</label><button class="btn btn-small" id="reset-binds">Restablecer</button></div>`;
    const gm = $('tab-game');
    gm.innerHTML = `
      <div class="row"><label>Tutorial<span class="hint">Volver a mostrar el tutorial de controles</span></label><button class="btn btn-small" id="replay-tut">Mostrar de nuevo</button></div>
      <div class="row"><label>Reiniciar progreso<span class="hint">Borra la partida guardada en este navegador</span></label><button class="btn btn-small btn-danger" id="wipe-save">Borrar partida</button></div>`;

    // eventos
    for (const el of document.querySelectorAll('#screen-settings [data-setting]')) {
      const key = el.dataset.setting;
      const fmt = el.dataset.fmt;
      el.addEventListener('input', () => {
        let v = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? el.value : parseFloat(el.value);
        if (key === 'fpsLimit') v = parseInt(v, 10);
        if (key === 'quality') {
          s.applyPreset(v);
          this.buildSettings();
          return;
        }
        s.set(key, v);
        const out = el.parentElement.querySelector('.range-val');
        if (out && fmt) out.textContent = this.formatters[fmt](v);
      });
    }
    for (const b of document.querySelectorAll('#screen-settings [data-bind]')) {
      b.addEventListener('click', () => {
        const action = b.dataset.bind;
        b.textContent = 'Presioná una tecla...';
        b.classList.add('listening');
        this.input.listenForKey((code) => {
          if (code) this.input.setBinding(action, code);
          this.buildSettings();
          this.openTab('controls');
        });
      });
    }
    $('reset-binds').addEventListener('click', () => {
      s.resetBindings();
      this.buildSettings();
      this.openTab('controls');
    });
    $('replay-tut').addEventListener('click', () => {
      s.set('tutorialDone', false);
      this.toast('El tutorial se mostrará al volver al juego');
    });
    $('wipe-save').addEventListener('click', async () => {
      const ok = await this.confirm('Borrar partida', 'Se perderá todo el progreso guardado en este navegador. ¿Seguro?', 'Borrar');
      if (ok) this.game.wipeSave();
    });
  }

  get formatters() {
    return {
      pct: (v) => `${Math.round(v * 100)}%`,
      m: (v) => `${v} m`,
      x: (v) => Number(v).toFixed(1),
    };
  }

  rowSelect(key, label, hint, options) {
    return `<div class="row"><label>${label}<span class="hint">${hint}</span></label><select data-setting="${key}">${options}</select></div>`;
  }

  rowCheck(key, label, hint) {
    return `<div class="row"><label>${label}<span class="hint">${hint}</span></label><input type="checkbox" data-setting="${key}" ${this.settings.get(key) ? 'checked' : ''}></div>`;
  }

  rowRange(key, label, hint, min, max, step, fmt) {
    const v = this.settings.get(key);
    const fmtKey = key === 'drawDistance' ? 'm' : key === 'mouseSensitivity' ? 'x' : 'pct';
    return `<div class="row"><label>${label}<span class="hint">${hint}</span></label><div class="ctrl"><input type="range" data-setting="${key}" data-fmt="${fmtKey}" min="${min}" max="${max}" step="${step}" value="${v}"><span class="range-val">${fmt(v)}</span></div></div>`;
  }

  // ------------------------------------------------------------------ HUD
  showHUD(v) {
    $('hud').classList.toggle('hidden', !v);
  }

  updateHUD(st) {
    $('hud-money').textContent = `$${Math.floor(st.money).toLocaleString('es-AR')}`;
    const h = Math.floor(st.time), m = Math.floor((st.time % 1) * 60);
    $('hud-time').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    $('bar-health').style.width = `${st.health}%`;
    $('bar-stamina').style.width = `${st.stamina * 100}%`;
    const wanted = $('hud-wanted');
    if (wanted.childElementCount !== 5) wanted.innerHTML = '<div class="star"></div>'.repeat(5);
    [...wanted.children].forEach((s, i) => s.classList.toggle('on', i < st.wanted));
    wanted.style.visibility = st.wanted > 0 ? 'visible' : 'hidden';
    wanted.classList.toggle('blink', !!st.searching);
    $('hud-fps').classList.toggle('hidden', !this.settings.get('showFps'));
    if (this.settings.get('showFps')) $('hud-fps').textContent = `${st.fps} FPS · ${Math.round(st.renderScale * 100)}%`;
  }

  // ------------------------------------------------------------------ misiones
  objective(text) {
    const el = $('hud-objective');
    if (!text) return el.classList.add('hidden');
    if (this.tut) $('hud-tutorial').classList.add('hidden');
    el.innerHTML = text;
    el.classList.remove('hidden');
  }

  missionInfo(text) {
    const el = $('hud-mission-info');
    if (!text) return el.classList.add('hidden');
    el.textContent = text;
    el.classList.remove('hidden');
  }

  setTimer(sec) {
    const el = $('hud-timer');
    if (sec == null) return el.classList.add('hidden');
    const s = Math.max(0, Math.ceil(sec));
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    el.classList.toggle('urgent', s <= 15);
    el.classList.remove('hidden');
  }

  subtitle(who, line, color) {
    const el = $('hud-subtitle');
    if (!who) return el.classList.add('hidden');
    el.innerHTML = `<span class="who" style="color:${color}">${who}:</span>${escapeHTML(line)}`;
    el.classList.remove('hidden');
  }

  bigMessage(title, sub, kind = 'info', secs) {
    const el = $('hud-big');
    el.className = `hud-big ${kind}`;
    $('big-title').textContent = title;
    $('big-sub').textContent = sub || '';
    void el.offsetWidth;
    clearTimeout(this.bigTimer);
    this.bigTimer = setTimeout(() => el.classList.add('hidden'), (secs ?? (kind === 'info' ? 1.5 : 4.5)) * 1000);
  }

  hideBigMessage() {
    $('hud-big').classList.add('hidden');
  }

  missionBanner(title, giver) {
    const el = $('hud-banner');
    $('ban-title').textContent = title.toUpperCase();
    $('ban-giver').textContent = giver;
    el.classList.remove('hidden');
    clearTimeout(this.banTimer);
    this.banTimer = setTimeout(() => el.classList.add('hidden'), 3000);
  }

  moneyDelta(amount) {
    const el = $('hud-money-delta');
    el.textContent = `${amount >= 0 ? '+' : '-'}$${Math.abs(amount).toLocaleString('es-AR')}`;
    el.classList.toggle('neg', amount < 0);
    el.classList.add('show');
    clearTimeout(this.moneyTimer);
    this.moneyTimer = setTimeout(() => el.classList.remove('show'), 2500);
  }

  setCharacter(info) {
    const el = $('hud-char');
    el.textContent = info.short;
    el.style.color = info.color;
  }

  fade(on) {
    $('hud-fade').classList.toggle('on', on);
  }

  showVehicleHUD(v, vehicle) {
    $('hud-speed').classList.toggle('hidden', !v);
    if (v && vehicle) $('spd-name').textContent = `${vehicle.T.name} · ${vehicle.T.category}`;
  }

  updateVehicleHUD(v) {
    $('spd-kmh').textContent = v.kmh;
    $('spd-gear').textContent = v.dead ? '×' : v.reverse && v.forwardSpeed < -0.3 ? 'R' : v.speed < 0.3 ? 'N' : String(v.gear);
    $('bar-vehicle').style.width = `${Math.max(0, 100 - v.damage)}%`;
  }

  showClickToPlay(v) {
    $('click-to-play').classList.toggle('hidden', !v);
  }

  toast(msg, seconds = 2.5) {
    const t = $('hud-toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), seconds * 1000);
  }

  showDistrict(d) {
    if (!d || d.id === this.lastDistrict) return;
    this.lastDistrict = d.id;
    const el = $('hud-district');
    el.innerHTML = `<div class="d-name" style="color:${d.color}">${d.name}</div><div class="d-city">SAN VEGA</div>`;
    el.classList.add('show');
    clearTimeout(this.districtTimer);
    this.districtTimer = setTimeout(() => el.classList.remove('show'), 3500);
  }

  // ------------------------------------------------------------------ tutorial
  startTutorial() {
    const k = (a) => keyName(this.settings.get('bindings')[a][0]);
    this.tut = {
      i: 0,
      progress: 0,
      steps: [
        { id: 'look', text: 'Mové el <b>mouse</b> para mirar alrededor.', need: 600 },
        { id: 'move', text: `Caminá con <kbd>${k('forward')}</kbd> <kbd>${k('left')}</kbd> <kbd>${k('back')}</kbd> <kbd>${k('right')}</kbd> (o las flechas).`, need: 10 },
        { id: 'run', text: `Mantené <kbd>${k('sprint')}</kbd> para correr. Si lo seguís manteniendo, hacés sprint.`, need: 25 },
        { id: 'jump', text: `Presioná <kbd>${k('jump')}</kbd> para saltar.`, need: 1 },
        { id: 'car', text: `Al lado tuyo hay un auto deportivo rojo. Acercate y presioná <kbd>${k('vehicle')}</kbd> para subirte.`, need: 1 },
        { id: 'drive', text: `<kbd>${k('forward')}</kbd> acelera, <kbd>${k('back')}</kbd> frena y da marcha atrás, <kbd>${k('left')}</kbd> <kbd>${k('right')}</kbd> giran, <kbd>${k('handbrake')}</kbd> es el freno de mano y <kbd>${k('camera')}</kbd> cambia la cámara. Manejá un poco.`, need: 150 },
        { id: 'map', text: `Presioná <kbd>${k('map')}</kbd> para abrir el mapa de San Vega.`, need: 1 },
        { id: 'free', text: 'Con <kbd>Esc</kbd> pausás, guardás y cambiás la configuración. ¡San Vega es tuya!', need: 7 },
      ],
    };
    $('hud-tutorial').classList.remove('hidden');
    this.renderTutorial();
  }

  renderTutorial() {
    const t = this.tut;
    if (!t) return;
    $('tut-text').innerHTML = t.steps[t.i].text;
    $('tut-progress').innerHTML = t.steps.map((_, i) => `<span class="${i < t.i ? 'done' : ''}"></span>`).join('');
  }

  // Avanza el tutorial: (id del paso, cantidad)
  tutorialProgress(id, amount) {
    const t = this.tut;
    if (!t) return;
    const step = t.steps[t.i];
    if (step.id !== id) return;
    t.progress += amount;
    if (t.progress >= step.need) {
      t.i++;
      t.progress = 0;
      bus.emit('ui:click');
      if (t.i >= t.steps.length) return this.endTutorial(false);
      this.renderTutorial();
    }
  }

  get tutorialStep() {
    return this.tut ? this.tut.steps[this.tut.i].id : null;
  }

  endTutorial(skipped) {
    this.tut = null;
    $('hud-tutorial').classList.add('hidden');
    this.settings.set('tutorialDone', true);
    if (!skipped) this.toast('Tutorial completado');
  }

  setPrompt(text) {
    const p = $('hud-prompt');
    if (!text) p.classList.add('hidden');
    else {
      p.innerHTML = text;
      p.classList.remove('hidden');
    }
  }
}

function escapeHTML(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
