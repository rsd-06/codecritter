// WebAudio synth only (no audio files). Stitch = chirpy alien gibberish, Yoda = low wise hum.
// The AudioContext is created lazily and suspended shortly after the last sound (efficiency budget).
import type { CharacterId } from '@shared/types';

export interface Blip {
  freq: number;
  slideTo: number;
  dur: number;
  gap: number;
  type: OscillatorType;
}

/** Pure plan for a gibberish utterance of `len` characters. */
export function planGibberish(len: number, rand: () => number): Blip[] {
  const n = Math.max(3, Math.min(10, Math.round(3 + len / 7)));
  const out: Blip[] = [];
  let f = 600 + rand() * 500;
  for (let i = 0; i < n; i++) {
    f = Math.max(380, Math.min(1900, f * (0.7 + rand() * 0.8)));
    out.push({
      freq: f,
      slideTo: f * (0.75 + rand() * 0.7),
      dur: 0.045 + rand() * 0.07,
      gap: 0.012 + rand() * 0.035,
      type: rand() < 0.65 ? 'square' : 'triangle',
    });
  }
  return out;
}

const SUSPEND_AFTER_MS = 1500;

export class SoundEngine {
  enabled = true;
  volume = 0.5;
  character: CharacterId = 'stitch';
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private busyUntil = 0; // ctx time
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private purrNodes: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode } | null = null;

  configure(o: { enabled?: boolean; volume?: number; character?: CharacterId }): void {
    if (o.enabled !== undefined) this.enabled = o.enabled;
    if (o.volume !== undefined) this.volume = Math.max(0, Math.min(1, o.volume));
    if (o.character) this.character = o.character;
    if (this.master) this.master.gain.value = this.volume * 0.35;
    if (!this.enabled) this.purr(false);
  }

  private ensure(): AudioContext | null {
    if (!this.enabled || this.volume <= 0) return null;
    if (typeof AudioContext === 'undefined') return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume * 0.35;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  private touch(until: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.busyUntil = Math.max(this.busyUntil, until);
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    const waitMs = Math.max(0, (this.busyUntil - ctx.currentTime) * 1000) + SUSPEND_AFTER_MS;
    this.suspendTimer = setTimeout(() => {
      if (this.purrNodes) return this.touch(ctx.currentTime + 1);
      void ctx.suspend().catch(() => undefined);
    }, waitMs);
  }

  private tone(
    start: number,
    freq: number,
    slideTo: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    opts: { lowpass?: number; vibrato?: number } = {},
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + Math.min(0.02, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    let node: AudioNode = osc;
    if (opts.lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.lowpass;
      osc.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(this.master!);
    if (opts.vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = opts.vibrato;
      depth.gain.value = freq * 0.03;
      lfo.connect(depth);
      depth.connect(osc.frequency);
      lfo.start(start);
      lfo.stop(start + dur + 0.05);
    }
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  /** Character voice: gibberish chirps (Stitch) or a hum (Yoda). `len` = text length. */
  speak(len = 12): void {
    const ctx = this.ensure();
    if (!ctx) return;
    let t = ctx.currentTime + 0.01;
    if (this.character === 'yoda') {
      this.tone(t, 128, 104, 0.5, 'sawtooth', 0.5, { lowpass: 520, vibrato: 5 });
      if (len > 18) this.tone(t + 0.62, 112, 92, 0.42, 'sawtooth', 0.45, { lowpass: 480, vibrato: 4.5 });
      this.touch(t + (len > 18 ? 1.1 : 0.6));
      return;
    }
    for (const b of planGibberish(len, Math.random)) {
      this.tone(t, b.freq, b.slideTo, b.dur, b.type, b.type === 'square' ? 0.22 : 0.4);
      t += b.dur + b.gap;
    }
    this.touch(t);
  }

  blip(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + 0.005;
    this.tone(t, this.character === 'yoda' ? 150 : 900, this.character === 'yoda' ? 130 : 1300, 0.08, 'triangle', 0.4);
    this.touch(t + 0.1);
  }

  jingle(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    let t = ctx.currentTime + 0.01;
    for (const f of [523.25, 659.25, 783.99, 1046.5]) {
      this.tone(t, f, f * 1.01, 0.13, 'triangle', 0.55);
      t += 0.1;
    }
    this.touch(t + 0.2);
  }

  alert(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    let t = ctx.currentTime + 0.01;
    for (let i = 0; i < 2; i++) {
      this.tone(t, 880, 880, 0.1, 'square', 0.25);
      this.tone(t + 0.12, 660, 660, 0.1, 'square', 0.25);
      t += 0.3;
    }
    this.touch(t);
  }

  /** Looping purr / contented hum. */
  purr(on: boolean): void {
    if (!on) {
      const p = this.purrNodes;
      if (p && this.ctx) {
        const now = this.ctx.currentTime;
        p.gain.gain.cancelScheduledValues(now);
        p.gain.gain.setTargetAtTime(0.0001, now, 0.08);
        p.osc.stop(now + 0.4);
        p.lfo.stop(now + 0.4);
        this.purrNodes = null;
        this.touch(now + 0.4);
      }
      return;
    }
    if (this.purrNodes) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = this.character === 'yoda' ? 70 : 52;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = this.character === 'yoda' ? 6 : 24;
    const depth = ctx.createGain();
    depth.gain.value = 0.35;
    lfo.connect(depth);
    depth.connect(gain.gain);
    osc.connect(lp);
    lp.connect(gain);
    gain.connect(this.master!);
    gain.gain.setTargetAtTime(0.5, ctx.currentTime, 0.15);
    osc.start();
    lfo.start();
    this.purrNodes = { osc, lfo, gain };
    this.touch(ctx.currentTime + 1);
  }

  dispose(): void {
    this.purr(false);
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.master = null;
  }
}
