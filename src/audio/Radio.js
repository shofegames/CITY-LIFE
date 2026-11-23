import { createRng } from '../world/rng.js';

// ============================================================================
// Radio de los autos: 4 emisoras con música original generada en tiempo real
// (batería, bajo, acordes y melodía sintetizados con Web Audio).
// ============================================================================

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export const STATIONS = [
  {
    name: 'Vega FM', genre: 'Pop electrónico', bpm: 112, swing: 0,
    chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], scale: [57, 60, 62, 64, 67, 69, 72],
    kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], bass: [0, 2, 4, 6, 8, 10, 12, 14], lead: 'square', pad: 'sawtooth',
  },
  {
    name: 'Ritmo Costa', genre: 'Urbano latino', bpm: 96, swing: 0,
    chords: [[50, 53, 57], [46, 50, 53], [48, 52, 55], [45, 49, 52]], scale: [62, 65, 67, 69, 72, 74],
    kick: [0, 4, 8, 12], snare: [3, 6, 11, 14], hat: [0, 2, 4, 6, 8, 10, 12, 14], bass: [0, 3, 8, 11], lead: 'triangle', pad: 'triangle',
  },
  {
    name: 'Puerto Rock', genre: 'Rock', bpm: 132, swing: 0, distort: true,
    chords: [[40, 47, 52], [36, 43, 48], [38, 45, 50], [35, 42, 47]], scale: [64, 67, 69, 71, 74, 76],
    kick: [0, 7, 8, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], bass: [0, 2, 4, 6, 8, 10, 12, 14], lead: 'sawtooth', pad: 'sawtooth',
  },
  {
    name: 'Noche Lo-Fi', genre: 'Lo-fi para manejar', bpm: 78, swing: 0.18, vinyl: true,
    chords: [[62, 65, 69, 72], [60, 64, 67, 71], [57, 60, 64, 67], [59, 62, 66, 69]], scale: [69, 72, 74, 76, 79],
    kick: [0, 7, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], bass: [0, 7, 10], lead: 'sine', pad: 'triangle',
  },
];

export class Radio {
  constructor(audio) {
    this.audio = audio;
    this.index = -1;
    this.timer = null;
    this.bus = null;
  }

  get station() {
    return this.index >= 0 ? STATIONS[this.index] : null;
  }

  play(index) {
    if (!this.audio.started) return;
    this.stop();
    this.index = index;
    const ctx = this.audio.ctx;
    const st = STATIONS[index];
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.gain.setTargetAtTime(1, ctx.currentTime, 0.15);
    // filtro de "radio de auto"
    const tone = ctx.createBiquadFilter();
    tone.type = 'highshelf'; tone.frequency.value = 6000; tone.gain.value = -6;
    this.bus.connect(tone).connect(this.audio.music);
    if (st.distort) {
      this.dist = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(x * 4); }
      this.dist.curve = curve;
      this.dist.connect(this.bus);
    } else this.dist = null;
    if (st.vinyl) this.vinyl();
    const step = 60 / st.bpm / 4;
    this.next = ctx.currentTime + 0.1;
    this.bar = Math.floor(Math.random() * 16);
    const schedule = () => {
      while (this.next < ctx.currentTime + 1.2) {
        this.scheduleBar(st, this.next, step, this.bar);
        this.next += step * 16;
        this.bar++;
      }
    };
    schedule();
    this.timer = setInterval(schedule, 300);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.bus) {
      const b = this.bus;
      b.gain.setTargetAtTime(0, this.audio.ctx.currentTime, 0.08);
      setTimeout(() => b.disconnect(), 600);
      this.bus = null;
    }
    this.vinylSrc?.stop();
    this.vinylSrc = null;
  }

  // ------------------------------------------------------------ un compás
  scheduleBar(st, t0, step, bar) {
    const rng = createRng(bar * 7919 + this.index * 31);
    const chord = st.chords[bar % st.chords.length];
    const at = (i) => t0 + i * step + (i % 2 ? st.swing * step : 0);
    for (const i of st.kick) this.kick(at(i));
    for (const i of st.snare) this.snare(at(i), st.index);
    for (const i of st.hat) this.hat(at(i), i % 4 === 2 ? 0.05 : 0.03);
    // bajo
    for (const i of st.bass) this.tone(midi(chord[0] - 12), at(i), step * 1.7, 'sawtooth', 0.12, 500, st.distort);
    // acordes (pad)
    if (st.distort) {
      for (const i of [0, 4, 8, 12]) for (const n of chord) this.tone(midi(n), at(i), step * 3.6, 'sawtooth', 0.05, 2500, true);
    } else {
      for (const n of chord) this.tone(midi(n), t0, step * 15, st.pad, 0.035, 1400);
    }
    // melodía: frases de 8 pasos generadas con semilla (se repiten cada 4 compases)
    if (bar % 8 >= 2) {
      const mr = createRng((bar % 4) * 101 + this.index * 13);
      for (let i = 0; i < 16; i++) {
        if (mr.next() < 0.42) {
          const n = st.scale[Math.floor(mr.next() * st.scale.length)];
          this.tone(midi(n), at(i), step * (mr.next() < 0.3 ? 3 : 1.4), st.lead, 0.05, 3500, st.distort);
        }
      }
    }
    void rng;
  }

  out(distort) {
    return distort && this.dist ? this.dist : this.bus;
  }

  tone(freq, t, dur, type, vol, cutoff, distort = false) {
    if (!this.bus) return;
    const ctx = this.audio.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.5, dur * 0.3);
    o.connect(f).connect(g).connect(this.out(distort));
    o.start(t);
    o.stop(t + dur + 0.3);
  }

  kick(t) {
    if (!this.bus) return;
    const ctx = this.audio.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.25);
  }

  snare(t) {
    if (!this.bus) return;
    const ctx = this.audio.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.audio.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    n.connect(bp).connect(g).connect(this.bus);
    n.start(t, Math.random(), 0.2);
  }

  hat(t, vol) {
    if (!this.bus) return;
    const ctx = this.audio.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.audio.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 7500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(hp).connect(g).connect(this.bus);
    n.start(t, Math.random(), 0.06);
  }

  vinyl() {
    const ctx = this.audio.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.audio.noiseBuf;
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 3000; bp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0.012;
    n.connect(bp).connect(g).connect(this.bus);
    n.start();
    this.vinylSrc = n;
  }
}
