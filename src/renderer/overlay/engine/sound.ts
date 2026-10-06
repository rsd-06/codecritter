// WebAudio synth only (no audio files). Base character: a mechanical keyboard (noise "clack" + sine
// "thock", see soundPlan.ts); speech bubbles keep the character voice (Stitch gibberish, Yoda hum).
// The AudioContext is created lazily and suspended shortly after the last sound (efficiency budget).
// NOTE: the click-through overlay never receives a user gesture, so WebView2 must run with
// --autoplay-policy=no-user-gesture-required (winmgr WEBVIEW2_ARGS); ensure() also resume()s.
import type { CharacterId, SoundCategory } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/defaults';
import { planSound, soundAllowed, type PlanOpts, type SoundGate, type SoundName, type Step } from './soundPlan';

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
const PURR_CLICK_EVERY_S = 0.115;
/** Volume 1.0 maps to this master gain; the compressor below keeps layered sounds from clipping. */
const MASTER_GAIN = 0.7;

export interface SoundConfig {
  enabled: boolean;
  volume: number;
  character: CharacterId;
  categories: Record<SoundCategory, boolean>;
  dnd: { enabled: boolean; from: string; to: string };
  peeking: boolean;
}

export interface PlayOpts extends PlanOpts {
  /** Settings audition: ignore category / DND / peek gates (volume still applies). */
  force?: boolean;
  /** seconds to hold the sound back (staggering several in one tick) */
  delay?: number;
}

export class SoundEngine {
  private cfg: SoundConfig = {
    enabled: true,
    volume: 0.5,
    character: 'stitch',
    categories: { ...DEFAULT_SETTINGS.sound.categories },
    dnd: { ...DEFAULT_SETTINGS.dnd },
    peeking: false,
  };
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private meterBuf: Float32Array<ArrayBuffer> | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private busyUntil = 0; // ctx time
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private purrTimer: ReturnType<typeof setTimeout> | null = null;
  /** Diagnostics (exposed on window.__critter for live verification). */
  readonly stats = { played: 0, last: '', skipped: 0 };

  get enabled(): boolean {
    return this.cfg.enabled;
  }
  get volume(): number {
    return this.cfg.volume;
  }
  get character(): CharacterId {
    return this.cfg.character;
  }
  get audioState(): AudioContextState | 'none' {
    return this.ctx ? this.ctx.state : 'none';
  }

  configure(o: Partial<SoundConfig>): void {
    const c = this.cfg;
    if (o.enabled !== undefined) c.enabled = o.enabled;
    if (o.volume !== undefined) c.volume = Math.max(0, Math.min(1, o.volume));
    if (o.character) c.character = o.character;
    if (o.categories) c.categories = { ...o.categories };
    if (o.dnd) c.dnd = { ...o.dnd };
    if (o.peeking !== undefined) c.peeking = o.peeking;
    if (this.master) this.master.gain.value = c.volume * MASTER_GAIN; // volume changes apply live
    if (!c.enabled) this.purr(false);
  }

  /** Peak output level (0..1) of the latest audio block, for live verification that sound is audible. */
  peak(): number {
    if (!this.analyser || !this.meterBuf) return 0;
    this.analyser.getFloatTimeDomainData(this.meterBuf);
    let p = 0;
    for (const v of this.meterBuf) p = Math.max(p, Math.abs(v));
    return p;
  }

  private gate(): SoundGate {
    const { enabled, volume, categories, dnd, peeking } = this.cfg;
    return { enabled, volume, categories, dnd, peeking };
  }

  private minutesNow(): number {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  private ensure(): AudioContext | null {
    if (this.cfg.volume <= 0) return null;
    if (typeof AudioContext === 'undefined') return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.cfg.volume * MASTER_GAIN;
      const comp = this.ctx.createDynamicsCompressor(); // loudness safety net for layered sounds
      comp.threshold.value = -14;
      comp.knee.value = 10;
      comp.ratio.value = 6;
      comp.attack.value = 0.002;
      comp.release.value = 0.12;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      this.analyser = this.ctx.createAnalyser(); // diagnostics only (peak meter)
      this.analyser.fftSize = 512;
      this.meterBuf = new Float32Array(new ArrayBuffer(512 * 4));
      this.master.connect(this.analyser);
      const n = Math.floor(this.ctx.sampleRate * 0.12);
      this.noiseBuf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  private touch(until: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.busyUntil = Math.max(this.busyUntil, until);
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    const waitMs = Math.max(0, (this.busyUntil - ctx.currentTime) * 1000) + SUSPEND_AFTER_MS;
    this.suspendTimer = setTimeout(() => {
      if (this.purrTimer) return this.touch(ctx.currentTime + 1);
      void ctx.suspend().catch(() => undefined);
    }, waitMs);
  }

  /** Play a named sound if the gates (Sound effects, Volume, category, DND, peek) allow it. */
  play(name: SoundName, opts: PlayOpts = {}): boolean {
    if (name === 'speak') {
      this.speak(24, opts.force);
      return true;
    }
    if (!opts.force && !soundAllowed(name, this.gate(), this.minutesNow())) {
      this.stats.skipped++;
      return false;
    }
    if (opts.force && this.cfg.volume <= 0) return false;
    const ctx = this.ensure();
    if (!ctx) return false;
    const steps = planSound(name, { character: this.cfg.character, ...opts }, Math.random);
    const t0 = ctx.currentTime + 0.012 + Math.max(0, opts.delay ?? 0);
    let end = t0;
    for (const st of steps) end = Math.max(end, this.render(st, t0));
    this.stats.played++;
    this.stats.last = name;
    this.touch(end);
    return true;
  }

  private render(s: Step, t0: number): number {
    const t = t0 + s.t;
    switch (s.k) {
      case 'clack':
        this.clack(t, s.g, s.pitch, s.bright, s.len, s.body);
        return t + s.len + 0.1;
      case 'thunk':
        this.thunk(t, s.g, s.pitch);
        return t + 0.2;
      case 'tone':
        this.tone(t, s.f, s.f2, s.dur, s.wave, s.g);
        return t + s.dur + 0.05;
      case 'bell':
        this.bell(t, s.f, s.dur, s.g);
        return t + s.dur + 0.05;
    }
  }

  private env(g: GainNode, t: number, peak: number, dur: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  /** Mechanical key: short bandpassed noise transient plus a pitch-dropping sine body. */
  private clack(t: number, g: number, pitch: number, bright: number, len: number, body: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = bright * pitch;
    bp.Q.value = 0.9;
    const ng = ctx.createGain();
    this.env(ng, t, g * 0.9, len);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(this.master!);
    src.start(t);
    src.stop(t + len + 0.02);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(190 * pitch * body, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, 92 * pitch * body), t + 0.06);
    const og = ctx.createGain();
    this.env(og, t, g * 0.75, 0.08);
    osc.connect(og);
    og.connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  /** Dull low thunk (errors). */
  private thunk(t: number, g: number, pitch: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(52 * pitch, t + 0.12);
    const og = ctx.createGain();
    this.env(og, t, g, 0.16);
    osc.connect(og);
    og.connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.18);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const ng = ctx.createGain();
    this.env(ng, t, g * 0.5, 0.05);
    src.connect(lp);
    lp.connect(ng);
    ng.connect(this.master!);
    src.start(t);
    src.stop(t + 0.07);
  }

  private tone(t: number, f: number, f2: number, dur: number, type: OscillatorType, g: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    const og = ctx.createGain();
    this.env(og, t, g, dur);
    osc.connect(og);
    og.connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  /** Mechanical-bell ding: fundamental + two inharmonic partials. */
  private bell(t: number, f: number, dur: number, g: number): void {
    this.tone(t, f, f, dur, 'sine', g);
    this.tone(t, f * 2.76, f * 2.76, dur * 0.55, 'sine', g * 0.32);
    this.tone(t, f * 5.4, f * 5.4, dur * 0.25, 'sine', g * 0.14);
  }

  private voiceTone(
    t: number,
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
    vol *= 1.8; // the voice is the quietest source; the compressor catches any overshoot
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
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
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Character voice for speech bubbles: gibberish chirps (Stitch) or a hum (Yoda). `len` = text length. */
  speak(len = 12, force = false): void {
    if (!force && !soundAllowed('speak', this.gate(), this.minutesNow())) {
      this.stats.skipped++;
      return;
    }
    const ctx = this.ensure();
    if (!ctx) return;
    let t = ctx.currentTime + 0.01;
    if (this.cfg.character === 'yoda') {
      this.voiceTone(t, 128, 104, 0.5, 'sawtooth', 0.5, { lowpass: 520, vibrato: 5 });
      if (len > 18) this.voiceTone(t + 0.62, 112, 92, 0.42, 'sawtooth', 0.45, { lowpass: 480, vibrato: 4.5 });
      this.touch(t + (len > 18 ? 1.1 : 0.6));
    } else {
      for (const b of planGibberish(len, Math.random)) {
        this.voiceTone(t, b.freq, b.slideTo, b.dur, b.type, b.type === 'square' ? 0.22 : 0.4);
        t += b.dur + b.gap;
      }
      this.touch(t);
    }
    this.stats.played++;
    this.stats.last = 'speak';
  }

  /** Soft low purr-clicks while petted (a quiet rhythmic tick, not a drone). */
  purr(on: boolean): void {
    if (!on) {
      if (this.purrTimer) clearTimeout(this.purrTimer);
      this.purrTimer = null;
      return;
    }
    if (this.purrTimer) return;
    const tick = (): void => {
      this.play('purrClick');
      this.purrTimer = setTimeout(tick, (PURR_CLICK_EVERY_S + Math.random() * 0.03) * 1000);
    };
    tick();
  }

  dispose(): void {
    this.purr(false);
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.master = null;
  }
}
