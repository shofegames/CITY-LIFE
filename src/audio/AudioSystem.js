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
