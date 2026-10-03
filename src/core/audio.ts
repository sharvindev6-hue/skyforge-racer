/**
 * Pure WebAudio synthesis — zero audio files. Engine = detuned saws through
 * a lowpass; wind = filtered noise; UI = short envelopes. All created lazily
 * after the first user gesture (browser autoplay policy).
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private oscA: OscillatorNode | null = null;
  private oscB: OscillatorNode | null = null;
  private windGain: GainNode | null = null;
  private sfxEnabled = true;
  private started = false;

  /** Must be called from a user gesture (click/keydown). */
  resume(): void {
    if (this.started) {
      void this.ctx?.resume();
      return;
    }
    this.started = true;
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    this.master = master;

    // Engine: two detuned saws -> lowpass.
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 2;
    engineGain.connect(filter);
    filter.connect(master);
    const oscA = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscA.frequency.value = 70;
    const oscB = ctx.createOscillator();
    oscB.type = 'sawtooth';
    oscB.frequency.value = 70 * 1.007;
    oscA.connect(engineGain);
    oscB.connect(engineGain);
    oscA.start();
    oscB.start();
    this.engineGain = engineGain;
    this.engineFilter = filter;
    this.oscA = oscA;
    this.oscB = oscB;

    // Wind: looped noise buffer -> bandpass.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 700;
    windFilter.Q.value = 0.6;
    noise.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);
    noise.start();
    this.windGain = windGain;
  }

  setSfxEnabled(on: boolean): void {
    this.sfxEnabled = on;
    if (this.master) this.master.gain.value = on ? 0.5 : 0;
  }

  /** rpm01: 0..1 throttle/engine load. speed01: 0..1. */
  setEngine(rpm01: number, speed01: number, active: boolean): void {
    if (!this.ctx || !this.engineGain || !this.oscA || !this.oscB || !this.engineFilter) return;
    const t = this.ctx.currentTime;
    const freq = 60 + rpm01 * 260 + speed01 * 60;
    this.oscA.frequency.setTargetAtTime(freq, t, 0.08);
    this.oscB.frequency.setTargetAtTime(freq * 1.007, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(300 + rpm01 * 1400, t, 0.1);
    this.engineGain.gain.setTargetAtTime(active ? 0.12 + rpm01 * 0.12 : 0, t, 0.15);
  }

  setWind(speed01: number): void {
    if (!this.ctx || !this.windGain) return;
    this.windGain.gain.setTargetAtTime(speed01 * 0.25, this.ctx.currentTime, 0.2);
  }

  blip(kind: 'ui' | 'good' | 'bad' | 'transform' | 'checkpoint'): void {
    if (!this.ctx || !this.master || !this.sfxEnabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(this.master);
    switch (kind) {
      case 'ui':
        osc.type = 'square';
        osc.frequency.setValueAtTime(880, t);
        gain.gain.setValueAtTime(0.06, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        osc.start(t);
        osc.stop(t + 0.09);
        break;
      case 'good':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(660, t);
        osc.frequency.setValueAtTime(990, t + 0.09);
        gain.gain.setValueAtTime(0.14, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.start(t);
        osc.stop(t + 0.32);
        break;
      case 'bad':
        osc.type = 'square';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.exponentialRampToValueAtTime(110, t + 0.25);
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
        osc.start(t);
        osc.stop(t + 0.3);
        break;
      case 'checkpoint':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(784, t);
        osc.frequency.setValueAtTime(1046, t + 0.07);
        osc.frequency.setValueAtTime(1318, t + 0.14);
        gain.gain.setValueAtTime(0.13, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.start(t);
        osc.stop(t + 0.42);
        break;
      case 'transform': {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(120, t);
        osc.frequency.exponentialRampToValueAtTime(720, t + 0.5);
        gain.gain.setValueAtTime(0.16, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(400, t);
        filter.frequency.exponentialRampToValueAtTime(2400, t + 0.5);
        osc.disconnect();
        osc.connect(filter);
        filter.connect(gain);
        osc.start(t);
        osc.stop(t + 0.6);
        break;
      }
    }
  }

  dispose(): void {
    try {
      this.oscA?.stop();
      this.oscB?.stop();
      void this.ctx?.close();
    } catch {
      // already closed
    }
    this.ctx = null;
    this.started = false;
  }
}
