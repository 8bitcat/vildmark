// VILDMARK — procedural WebAudio SFX + gentle ambience (no audio files)
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('vildmark_mute') === '1';
    this.windGain = null;
    this._birdT = 0;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this._startWind();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  setMuted(m) {
    this.muted = m;
    localStorage.setItem('vildmark_mute', m ? '1' : '0');
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  _startWind() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let v = 0;
    for (let i = 0; i < len; i++) {
      v = v * 0.98 + (Math.random() * 2 - 1) * 0.02;
      d[i] = v * 6;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = 380; filt.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.05;
    src.connect(filt).connect(this.windGain).connect(this.master);
    src.start();
  }

  ambience(isNight, season, dt) {
    if (!this.ctx) return;
    if (this.windGain) this.windGain.gain.value = season === 3 ? 0.12 : isNight ? 0.07 : 0.045;
    this._birdT -= dt;
    if (!isNight && season !== 3 && this._birdT <= 0) {
      this._birdT = 4 + Math.random() * 9;
      const f = 2100 + Math.random() * 1400;
      for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
        this._tone(f + Math.random() * 500, 0.05, 'sine', 0.04, 0.09 + i * 0.13, 12);
      }
    }
  }

  _tone(freq, dur, type = 'square', vol = 0.15, delay = 0, slide = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide * 60), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  _noise(dur, vol = 0.2, freq = 800, delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(filt).connect(g).connect(this.master);
    src.start(t0);
  }

  play(name) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'dig': this._noise(0.06, 0.12, 900); break;
      case 'break': this._noise(0.16, 0.3, 700); this._tone(160, 0.1, 'square', 0.1, 0, -1); break;
      case 'place': this._tone(210, 0.08, 'square', 0.14, 0, -1); this._noise(0.05, 0.1, 500); break;
      case 'hurt': this._tone(220, 0.18, 'sawtooth', 0.22, 0, -2); break;
      case 'mobhit': this._noise(0.08, 0.22, 1400); this._tone(300, 0.08, 'square', 0.1, 0, -2); break;
      case 'mobdie': this._tone(420, 0.1, 'square', 0.16, 0, -3); this._tone(240, 0.16, 'square', 0.14, 0.08, -3); this._noise(0.2, 0.18, 900, 0.05); break;
      case 'swing': this._noise(0.07, 0.08, 2400); break;
      case 'craft': this._tone(520, 0.08, 'square', 0.12); this._tone(660, 0.08, 'square', 0.12, 0.09); this._tone(880, 0.12, 'square', 0.12, 0.18); break;
      case 'eat': this._noise(0.09, 0.18, 600); this._noise(0.09, 0.16, 500, 0.13); break;
      case 'bounce': this._tone(240, 0.14, 'sine', 0.2, 0, 6); break;
      case 'night': this._tone(110, 0.5, 'triangle', 0.22, 0, -1); this._tone(82, 0.7, 'triangle', 0.2, 0.4, -1); break;
      case 'day': this._tone(440, 0.14, 'triangle', 0.14); this._tone(554, 0.14, 'triangle', 0.14, 0.14); this._tone(660, 0.2, 'triangle', 0.14, 0.28); break;
      case 'alarm': this._tone(520, 0.12, 'square', 0.2); this._tone(392, 0.16, 'square', 0.2, 0.14); break;
      case 'gnaw': this._noise(0.06, 0.1, 500); break;
      case 'spit': this._tone(600, 0.1, 'sine', 0.1, 0, -4); break;
      case 'heartlost': this._tone(330, 0.3, 'sawtooth', 0.25, 0, -2); this._tone(196, 0.5, 'sawtooth', 0.22, 0.25, -2); this._tone(131, 0.8, 'sawtooth', 0.2, 0.55, -1); break;
      case 'loot': this._tone(740, 0.06, 'square', 0.08); break;
      case 'death': this._tone(220, 0.3, 'triangle', 0.2, 0, -2); this._tone(165, 0.4, 'triangle', 0.18, 0.25, -2); this._tone(110, 0.7, 'triangle', 0.18, 0.55, -1); break;
    }
  }
}
