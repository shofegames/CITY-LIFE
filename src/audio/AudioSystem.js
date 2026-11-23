import { bus } from '../core/EventBus.js';

// ============================================================================
// Audio System: todo se sintetiza con Web Audio (no hay archivos que descargar).
// Canales: música, efectos y ambiente, cada uno con volumen configurable.
// ============================================================================

export class AudioSystem {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.started = false;
    this.musicTimer = null;
    this.musicOn = false;
    bus.on('settings:changed', () => this.applyVolumes());
    bus.on('player:footstep', (e) => this.footstep(e.speed));
    bus.on('player:jump', () => this.thump(0.25, 160));
    bus.on('player:land', (v) => this.thump(Math.min(1, 0.25 + v * 0.05), 90));
    bus.on('ui:click', () => this.click());
  }

  // Los navegadores exigen un gesto del usuario para iniciar audio.
  unlock() {
    if (this.started) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.music = this.ctx.createGain();
    this.sfx = this.ctx.createGain();
    this.amb = this.ctx.createGain();
    this.music.connect(this.master);
    this.sfx.connect(this.master);
    this.amb.connect(this.master);
    this.noiseBuf = this.makeNoise(2);
    this.brownBuf = this.makeBrown(4);
    this.started = true;
    this.applyVolumes();
    this.startAmbience();
  }

  applyVolumes() {
    if (!this.started) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.get('masterVolume'), t, 0.05);
    this.music.gain.setTargetAtTime(s.get('musicVolume') * 0.35, t, 0.05);
    this.sfx.gain.setTargetAtTime(s.get('sfxVolume'), t, 0.05);
    this.amb.gain.setTargetAtTime(s.get('ambientVolume') * 0.5, t, 0.05);
  }

  makeNoise(seconds) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  makeBrown(seconds) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  // ------------------------------------------------------------- ambiente urbano
  startAmbience() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.brownBuf;
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    this.ambGain = this.ctx.createGain();
    this.ambGain.gain.value = 0;
    src.connect(lp).connect(this.ambGain).connect(this.amb);
    src.start();
    // viento suave
    const w = this.ctx.createBufferSource();
    w.buffer = this.noiseBuf;
    w.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.4;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    w.connect(bp).connect(this.windGain).connect(this.amb);
    w.start();
  }

  // intensidad de ciudad (0..1) según zona y hora; viento según altura/costa
  setAmbience(city, wind) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.ambGain.gain.setTargetAtTime(0.25 + city * 0.6, t, 0.8);
    this.windGain.gain.setTargetAtTime(0.02 + wind * 0.12, t, 0.8);
  }

  // ------------------------------------------------------------- efectos
  footstep(speed) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400 + Math.random() * 600;
    bp.Q.value = 1.2;
    const g = this.ctx.createGain();
    const vol = Math.min(0.55, 0.16 + speed * 0.05);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    src.connect(bp).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 1.5, 0.12);
  }

  thump(vol, freq) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol * 0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.2);
    this.footstep(3);
  }

  click() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(1320, t + 0.04);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.1);
  }

  // ------------------------------------------------------------- vehículos
  // Motor sintetizado: dos osciladores (fundamental + subarmónico) filtrados.
  startEngine() {
    if (!this.started || this.engine) return;
    const c = this.ctx;
    const o1 = c.createOscillator(), o2 = c.createOscillator(), o3 = c.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'square'; o3.type = 'triangle';
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2;
    const g = c.createGain();
    g.gain.value = 0;
    const g2 = c.createGain();
    g2.gain.value = 0.35;
    o1.connect(lp); o2.connect(g2).connect(lp); o3.connect(lp);
    lp.connect(g).connect(this.sfx);
    o1.start(); o2.start(); o3.start();
    // chirrido de neumáticos
    const sk = c.createBufferSource();
    sk.buffer = this.noiseBuf;
    sk.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1700;
    bp.Q.value = 6;
    const sg = c.createGain();
    sg.gain.value = 0;
    sk.connect(bp).connect(sg).connect(this.sfx);
    sk.start();
    // bocina (dos tonos)
    const h1 = c.createOscillator(), h2 = c.createOscillator();
    h1.type = 'square'; h2.type = 'square';
    h1.frequency.value = 415; h2.frequency.value = 523;
    const hl = c.createBiquadFilter();
    hl.type = 'lowpass';
    hl.frequency.value = 1800;
    const hg = c.createGain();
    hg.gain.value = 0;
    h1.connect(hl); h2.connect(hl);
    hl.connect(hg).connect(this.sfx);
    h1.start(); h2.start();
    this.engine = { o1, o2, o3, lp, g, sg, bp, hg, nodes: [o1, o2, o3, sk, h1, h2] };
  }

  stopEngine() {
    if (!this.engine) return;
    const e = this.engine;
    const t = this.ctx.currentTime;
    e.g.gain.setTargetAtTime(0, t, 0.08);
    e.sg.gain.setTargetAtTime(0, t, 0.05);
    e.hg.gain.setTargetAtTime(0, t, 0.02);
    const nodes = e.nodes;
    setTimeout(() => nodes.forEach((n) => { try { n.stop(); } catch { /* ya detenido */ } }), 500);
    this.engine = null;
  }

  setEngine(rpm, throttle, slip, horn, alive = true) {
    const e = this.engine;
    if (!e) return;
    const t = this.ctx.currentTime;
    const f = 18 + (rpm / 60) * 1.6;
    e.o1.frequency.setTargetAtTime(f, t, 0.03);
    e.o2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    e.o3.frequency.setTargetAtTime(f * 2.01, t, 0.03);
    e.lp.frequency.setTargetAtTime(220 + throttle * 900 + rpm * 0.12, t, 0.05);
    e.g.gain.setTargetAtTime(alive ? 0.07 + throttle * 0.09 : 0, t, 0.06);
    e.sg.gain.setTargetAtTime(Math.min(0.28, Math.max(0, slip - 0.35) * 0.3), t, 0.05);
    e.hg.gain.setTargetAtTime(horn ? 0.14 : 0, t, 0.01);
  }

  crash(intensity) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const v = Math.min(1, intensity / 18);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900 + v * 2500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.25 + v * 0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35 + v * 0.4);
    src.connect(lp).connect(g).connect(this.sfx);
    src.start(t, Math.random(), 1);
    this.thump(0.4 + v * 0.6, 120);
    // tintineo metálico
    for (let i = 0; i < 3; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 1800 + Math.random() * 2500;
      const og = this.ctx.createGain();
      const st = t + 0.05 + Math.random() * 0.2;
      og.gain.setValueAtTime(0.03 * v, st);
      og.gain.exponentialRampToValueAtTime(0.0001, st + 0.15);
      o.connect(og).connect(this.sfx);
      o.start(st);
      o.stop(st + 0.2);
    }
  }

  // bocina de otro auto (volumen según la distancia)
  distantHorn(dist) {
    if (!this.started || dist > 80) return;
    const t = this.ctx.currentTime;
    const v = 0.12 * (1 - dist / 80);
    const f = 360 + Math.random() * 140;
    for (const m of [1, 1.26]) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f * m;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1500;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(v, t + 0.02);
      g.gain.setValueAtTime(v, t + 0.35);
      g.gain.linearRampToValueAtTime(0.0001, t + 0.45);
      o.connect(lp).connect(g).connect(this.sfx);
      o.start(t);
      o.stop(t + 0.5);
    }
  }

  // ------------------------------------------------------------- policía
  ensureSiren() {
    if (this.siren || !this.started) return;
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.55; // "wail"
    const lfoGain = c.createGain();
    lfoGain.gain.value = 380;
    lfo.connect(lfoGain).connect(o.frequency);
    o.frequency.value = 980;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    const g = c.createGain();
    g.gain.value = 0;
    o.connect(lp).connect(g).connect(this.sfx);
    o.start(); lfo.start();
    // rotor de helicóptero: ruido modulado en amplitud
    const n = c.createBufferSource();
    n.buffer = this.brownBuf;
    n.loop = true;
    const rl = c.createBiquadFilter();
    rl.type = 'lowpass';
    rl.frequency.value = 300;
    const rg = c.createGain();
    rg.gain.value = 0;
    const am = c.createGain();
    am.gain.value = 0.5;
    const amLfo = c.createOscillator();
    amLfo.type = 'square';
    amLfo.frequency.value = 17;
    const amDepth = c.createGain();
    amDepth.gain.value = 0.5;
    amLfo.connect(amDepth).connect(am.gain);
    n.connect(rl).connect(am).connect(rg).connect(this.sfx);
    n.start(); amLfo.start();
    this.siren = { g, rg };
  }

  setSiren(v) {
    if (!this.started) return;
    if (v > 0) this.ensureSiren();
    if (this.siren) this.siren.g.gain.setTargetAtTime(v * v * 0.12, this.ctx.currentTime, 0.1);
  }

  setRotor(v) {
    if (!this.started) return;
    if (v > 0) this.ensureSiren();
    if (this.siren) this.siren.rg.gain.setTargetAtTime(v * 0.5, this.ctx.currentTime, 0.2);
  }

  // ------------------------------------------------------------- jingles
  jingle(kind) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const seqs = {
      pass: [[72, 0], [76, 0.12], [79, 0.24], [84, 0.36]],
      fail: [[64, 0], [60, 0.18], [55, 0.36]],
      start: [[67, 0], [72, 0.15]],
      checkpoint: [[84, 0]],
      pickup: [[79, 0], [88, 0.08]],
      count: [[69, 0]],
      go: [[81, 0]],
      money: [[84, 0], [91, 0.07]],
      star: [[57, 0], [57, 0.12]],
    };
    for (const [n, dt] of seqs[kind] || []) {
      const o = this.ctx.createOscillator();
      o.type = kind === 'fail' ? 'sawtooth' : 'triangle';
      o.frequency.value = 440 * Math.pow(2, (n - 69) / 12);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.linearRampToValueAtTime(0.16, t + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + (kind === 'pass' ? 0.5 : 0.3));
      o.connect(g).connect(this.sfx);
      o.start(t + dt);
      o.stop(t + dt + 0.6);
    }
  }

  // ------------------------------------------------------------- música del menú
  // Progresión suave sintetizada (pad + bajo + percusión liviana).
  startMusic() {
    if (!this.started || this.musicOn) return;
    this.musicOn = true;
    const chords = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 65]];
    const bpm = 84, beat = 60 / bpm;
    let bar = 0;
    let next = this.ctx.currentTime + 0.1;
    const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
    const schedule = () => {
      while (next < this.ctx.currentTime + 1.5) {
        const ch = chords[bar % chords.length];
        // pad
        for (const n of ch) this.note(midi(n), next, beat * 4, 'sawtooth', 0.035, 1200);
        // bajo
        this.note(midi(ch[0] - 12), next, beat * 1.8, 'triangle', 0.16, 600);
        this.note(midi(ch[0] - 12), next + beat * 2, beat * 1.8, 'triangle', 0.13, 600);
        // arpegio
        for (let i = 0; i < 8; i++) this.note(midi(ch[(i * 3) % 4] + 12), next + i * beat * 0.5, beat * 0.4, 'sine', 0.05, 3000);
        // hi-hat
        for (let i = 0; i < 8; i++) this.hat(next + i * beat * 0.5, i % 2 ? 0.025 : 0.045);
        next += beat * 4;
        bar++;
      }
    };
    schedule();
    this.musicTimer = setInterval(schedule, 500);
  }

  stopMusic() {
    this.musicOn = false;
    clearInterval(this.musicTimer);
    this.musicTimer = null;
    if (this.started) {
      const t = this.ctx.currentTime;
      this.music.gain.cancelScheduledValues(t);
      this.music.gain.setTargetAtTime(0, t, 0.3);
      setTimeout(() => this.applyVolumes(), 1600);
    }
  }

  note(freq, time, dur, type, vol, cutoff) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vol, time + Math.min(0.3, dur * 0.3));
    g.gain.setTargetAtTime(0.0001, time + dur * 0.6, dur * 0.25);
    o.connect(f).connect(g).connect(this.music);
    o.start(time);
    o.stop(time + dur + 0.5);
  }

  hat(time, vol) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    src.connect(hp).connect(g).connect(this.music);
    src.start(time, Math.random(), 0.06);
  }
}
