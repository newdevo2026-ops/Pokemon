// Everything you hear is synthesised at runtime with WebAudio — no audio files,
// no licensing questions, and the whole soundtrack costs a few hundred bytes.

const NOTES = { C:0, 'C#':1, D:2, 'D#':3, E:4, F:5, 'F#':6, G:7, 'G#':8, A:9, 'A#':10, B:11 };

/** "A4" / "F#3" -> frequency in Hz. */
export function noteFreq(name) {
  const m = /^([A-G]#?)(-?\d)$/.exec(name);
  if (!m) return 440;
  const semi = NOTES[m[1]] + (parseInt(m[2], 10) + 1) * 12;
  return 440 * Math.pow(2, (semi - 69) / 12);
}

const T = (s) => s.split(' ').filter(Boolean);

/** Songs are: bpm, a lead line, a bass line and an optional pad.
 *  '-' holds the previous note, '.' is a rest. One symbol == one 16th step. */
export const SONGS = {
  town: {
    bpm: 116, wave: 'triangle',
    lead: T(`E5 - G5 - A5 - B5 - A5 - G5 - E5 - . -
             D5 - E5 - G5 - E5 - D5 - B4 - . - . -
             E5 - G5 - A5 - C6 - B5 - A5 - G5 - E5 -
             D5 - E5 - D5 - B4 - A4 - . - . - . -`),
    bass: T(`E3 . E3 . C3 . C3 . G3 . G3 . D3 . D3 .
             E3 . E3 . C3 . C3 . A2 . A2 . B2 . B2 .`),
    pad: T(`E4 . . . C4 . . . G4 . . . D4 . . .`),
  },
  route: {
    bpm: 138, wave: 'square',
    lead: T(`A4 - C5 D5 E5 - D5 C5 A4 - . - E5 - D5 C5
             G4 - B4 C5 D5 - C5 B4 G4 - . - D5 - C5 B4
             A4 - C5 D5 E5 - G5 E5 D5 - C5 - A4 - . -
             E5 - D5 - C5 - B4 - A4 - . - . - . -`),
    bass: T(`A2 . A2 A2 F2 . F2 . C3 . C3 . G2 . G2 .
             A2 . A2 A2 F2 . F2 . E2 . E2 . E2 . E2 .`),
    pad: T(`A3 . . . F3 . . . C4 . . . G3 . . .`),
  },
  battle: {
    bpm: 168, wave: 'sawtooth',
    lead: T(`D5 D5 . D5 F5 . E5 . D5 . C5 . A4 . . .
             D5 D5 . D5 A5 . G5 . F5 . E5 . D5 . . .
             F5 . E5 . D5 . C5 . D5 . F5 . A5 . G5 .
             F5 . D5 . C5 . A4 . D5 . . . . . . .`),
    bass: T(`D2 D2 . D2 D2 . D2 . A2 A2 . A2 A2 . A2 .
             Bb2 Bb2 . Bb2 Bb2 . Bb2 . C3 C3 . C3 A2 . A2 .`),
    pad: T(`D4 . . . D4 . . . A3 . . . A3 . . .`),
  },
  cave: {
    bpm: 92, wave: 'sine',
    lead: T(`A4 - - - C5 - - - B4 - - - E4 - - -
             G4 - - - A4 - - - F4 - - - . - - -`),
    bass: T(`A2 . . . . . . . F2 . . . . . . .
             G2 . . . . . . . E2 . . . . . . .`),
    pad: T(`A3 . . . . . . . F3 . . . . . . .`),
  },
  victory: {
    bpm: 150, wave: 'square',
    lead: T(`C5 C5 C5 C5 - G4 - A4 - C5 - . C5 - D5 -
             E5 - - - E5 - - - D5 - C5 - C5 - - -`),
    bass: T(`C3 . C3 . G2 . G2 . C3 . C3 . G3 . G3 .`),
    pad: T(`C4 . . . G3 . . . C4 . . . E4 . . .`),
  },
  center: {
    bpm: 96, wave: 'sine',
    lead: T(`G4 - B4 - D5 - B4 - C5 - E5 - D5 - . -
             A4 - C5 - E5 - C5 - D5 - B4 - G4 - . -`),
    bass: T(`G2 . . . E2 . . . C3 . . . D3 . . .`),
    pad: T(`G3 . . . E3 . . . C4 . . . D4 . . .`),
  },
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.muted = false;
    this.current = null;
    this._timer = null;
    this._step = 0;
    this._nextTime = 0;
  }

  /** Browsers only allow audio after a gesture, so this is called on first input. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.34;
    this.musicGain.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.6;
    this.sfxGain.connect(this.master);

    if (this._pending) { const p = this._pending; this._pending = null; this.play(p); }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  }

  play(name) {
    if (this.current === name) return;
    if (!this.ctx) { this._pending = name; this.current = name; return; }
    this.current = name;
    this.stop();
    const song = SONGS[name];
    if (!song) return;
    this._song = song;
    this._step = 0;
    this._nextTime = this.ctx.currentTime + 0.06;
    this._timer = setInterval(() => this._schedule(), 25);
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  _schedule() {
    const song = this._song;
    if (!song || !this.ctx) return;
    const stepDur = 60 / song.bpm / 4;
    while (this._nextTime < this.ctx.currentTime + 0.25) {
      const t = this._nextTime;
      this._emit(song.lead, this._step, t, stepDur, song.wave, 0.16, 0);
      this._emit(song.bass, this._step, t, stepDur, 'triangle', 0.22, -12);
      if (song.pad) this._emit(song.pad, this._step, t, stepDur * 4, 'sine', 0.07, 0);
      if (this._step % 4 === 0) this._drum(t, this._step % 8 === 0 ? 'kick' : 'hat');
      this._step++;
      this._nextTime += stepDur;
    }
  }

  _emit(track, step, time, stepDur, wave, vol, detune) {
    if (!track || !track.length) return;
    const sym = track[step % track.length];
    if (!sym || sym === '.' || sym === '-') return;
    // Hold as long as the following symbols are ties.
    let len = 1;
    for (let i = 1; i < 8; i++) {
      if (track[(step + i) % track.length] === '-') len++; else break;
    }
    const freq = noteFreq(sym.replace('Bb', 'A#'));
    this._voice(freq, time, stepDur * len * 0.92, wave, vol, detune, this.musicGain);
  }

  _voice(freq, time, dur, wave, vol, detune, dest) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = wave;
    osc.frequency.value = freq;
    if (detune) osc.detune.value = detune;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, time + dur);
    osc.connect(g); g.connect(dest);
    osc.start(time); osc.stop(time + dur + 0.03);
  }

  _drum(time, kind) {
    const ctx = this.ctx;
    if (kind === 'kick') {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.setValueAtTime(150, time);
      osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
      g.gain.setValueAtTime(0.28, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
      osc.connect(g); g.connect(this.musicGain);
      osc.start(time); osc.stop(time + 0.18);
    } else {
      const buf = this._noiseBuffer();
      const src = ctx.createBufferSource();
      const g = ctx.createGain();
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 6500;
      src.buffer = buf;
      g.gain.setValueAtTime(0.05, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
      src.connect(hp); hp.connect(g); g.connect(this.musicGain);
      src.start(time); src.stop(time + 0.06);
    }
  }

  _noiseBuffer() {
    if (this._noise) return this._noise;
    const len = this.ctx.sampleRate * 0.3;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  // ---- one-shot sound effects -------------------------------------------
  sfx(name) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const S = this.sfxGain;
    switch (name) {
      case 'cursor':
        this._voice(880, t, 0.06, 'square', 0.16, 0, S); break;
      case 'select':
        this._voice(660, t, 0.05, 'square', 0.18, 0, S);
        this._voice(990, t + 0.05, 0.09, 'square', 0.16, 0, S); break;
      case 'back':
        this._voice(500, t, 0.06, 'square', 0.15, 0, S);
        this._voice(340, t + 0.05, 0.09, 'square', 0.13, 0, S); break;
      case 'bump':
        this._voice(150, t, 0.08, 'square', 0.12, 0, S); break;
      case 'step':
        this._voice(230, t, 0.035, 'triangle', 0.05, 0, S); break;
      case 'hit': {
        const src = this.ctx.createBufferSource();
        const g = this.ctx.createGain();
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8;
        src.buffer = this._noiseBuffer();
        g.gain.setValueAtTime(0.35, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        src.connect(bp); bp.connect(g); g.connect(S);
        src.start(t); src.stop(t + 0.24);
        break;
      }
      case 'super':
        this._voice(180, t, 0.1, 'sawtooth', 0.3, 0, S);
        this._voice(120, t + 0.06, 0.22, 'sawtooth', 0.3, 0, S);
        this.sfx('hit'); break;
      case 'weak':
        this._voice(320, t, 0.12, 'sine', 0.16, 0, S); break;
      case 'faint':
        for (let i = 0; i < 6; i++) {
          this._voice(600 - i * 80, t + i * 0.06, 0.1, 'triangle', 0.16, 0, S);
        }
        break;
      case 'heal':
        [523, 659, 784, 1046].forEach((f, i) =>
          this._voice(f, t + i * 0.08, 0.2, 'sine', 0.2, 0, S));
        break;
      case 'levelup':
        [523, 659, 784, 1046, 1318].forEach((f, i) =>
          this._voice(f, t + i * 0.07, 0.22, 'square', 0.18, 0, S));
        break;
      case 'ball':
        this._voice(700, t, 0.07, 'square', 0.2, 0, S);
        this._voice(420, t + 0.08, 0.12, 'square', 0.18, 0, S); break;
      case 'wobble':
        this._voice(300, t, 0.09, 'triangle', 0.2, 0, S); break;
      case 'caught':
        [659, 784, 988, 1318].forEach((f, i) =>
          this._voice(f, t + i * 0.1, 0.3, 'square', 0.2, 0, S));
        break;
      case 'escape':
        this._voice(400, t, 0.08, 'square', 0.15, 0, S);
        this._voice(300, t + 0.07, 0.08, 'square', 0.15, 0, S);
        this._voice(200, t + 0.14, 0.14, 'square', 0.15, 0, S); break;
      case 'buy':
        this._voice(880, t, 0.05, 'square', 0.16, 0, S);
        this._voice(1174, t + 0.05, 0.12, 'square', 0.16, 0, S); break;
      case 'encounter':
        for (let i = 0; i < 8; i++) {
          this._voice(300 + i * 90, t + i * 0.045, 0.06, 'square', 0.2, 0, S);
        }
        break;
      default: break;
    }
  }

  /** Every creature gets a deterministic "cry" derived from its own numbers. */
  cry(seed, pitch = 1) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const waves = ['square', 'sawtooth', 'triangle'];
    const wave = waves[seed % waves.length];
    const base = (140 + (seed % 260)) * pitch;
    const steps = 3 + (seed % 3);
    for (let i = 0; i < steps; i++) {
      const dir = (seed >> (i * 3)) & 1 ? 1 : -1;
      const f = base * Math.pow(1.18, dir * (i + 1)) * (1 + ((seed >> i) % 5) * 0.04);
      this._voice(f, t + i * 0.075, 0.14, wave, 0.2, 0, this.sfxGain);
    }
  }
}
