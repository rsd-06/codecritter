// Pure sound design: what to play (steps), when it is allowed (gate), and the escalation / repeat
// schedules. No AudioContext in here, so everything is unit-tested. The SoundEngine renders `Step`s.
//
// Base character: a classic mechanical keyboard. Every sound is built from a short filtered-noise
// transient ("clack") plus a low sine body ("thock"), with small random pitch / timing variation.
import type { CharacterId, SoundCategory } from '@shared/types';

export const SOUND_CATEGORIES: readonly SoundCategory[] = ['typing', 'agents', 'reminders', 'pomodoro', 'other'];

export const CATEGORY_LABEL: Record<SoundCategory, { label: string; hint: string }> = {
  typing: { label: 'Typing & clicks', hint: 'Soft key clacks while you type and a rattle when you click too fast.' },
  agents: { label: 'AI agents', hint: 'Clacks when an agent starts working, finishes, fails or waits for you.' },
  reminders: { label: 'Reminders', hint: 'A soft chime for stretch and water reminders; it repeats, louder, until you react.' },
  pomodoro: { label: 'Pomodoro', hint: 'A small bell when a focus or break phase changes.' },
  other: { label: 'Other', hint: 'Petting, picking it up, overheating, sleeping and its speech voice.' },
};

export type SoundName =
  | 'key'
  | 'click'
  | 'clickFrenzy'
  | 'agentWork'
  | 'agentDone'
  | 'agentError'
  | 'agentWaiting'
  | 'reminder'
  | 'pomodoroFocus'
  | 'pomodoroBreak'
  | 'pomodoroDone'
  | 'overheat'
  | 'purrClick'
  | 'lift'
  | 'drop'
  | 'sleep'
  | 'speak';

export const CATEGORY_OF: Record<SoundName, SoundCategory> = {
  key: 'typing',
  click: 'typing',
  clickFrenzy: 'typing',
  agentWork: 'agents',
  agentDone: 'agents',
  agentError: 'agents',
  agentWaiting: 'agents',
  reminder: 'reminders',
  pomodoroFocus: 'pomodoro',
  pomodoroBreak: 'pomodoro',
  pomodoroDone: 'pomodoro',
  overheat: 'other',
  purrClick: 'other',
  lift: 'other',
  drop: 'other',
  sleep: 'other',
  speak: 'other',
};

/* ------------------------------------------------------------------ gate ---- */

export interface SoundGate {
  enabled: boolean;
  volume: number;
  categories: Record<SoundCategory, boolean>;
  dnd: { enabled: boolean; from: string; to: string };
  /** fullscreen peek: only reminder-class sounds break through */
  peeking: boolean;
}

export function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/** Overnight ranges (22:00 -> 07:00) wrap past midnight; from == to means "never". */
export function inDnd(dnd: { enabled: boolean; from: string; to: string }, minutesNow: number): boolean {
  if (!dnd.enabled) return false;
  const a = toMinutes(dnd.from);
  const b = toMinutes(dnd.to);
  if (a === b) return false;
  return a < b ? minutesNow >= a && minutesNow < b : minutesNow >= a || minutesNow < b;
}

export function soundAllowed(name: SoundName, g: SoundGate, minutesNow: number): boolean {
  if (!g.enabled || g.volume <= 0) return false;
  const cat = CATEGORY_OF[name];
  if (!g.categories[cat]) return false;
  if (inDnd(g.dnd, minutesNow)) return false;
  if (g.peeking && cat !== 'reminders' && cat !== 'pomodoro') return false;
  return true;
}

/* ------------------------------------------------------------------ steps ---- */

export type Step =
  /** noise transient + sine body */
  | { k: 'clack'; t: number; g: number; pitch: number; bright: number; len: number; body: number }
  /** dull low thump */
  | { k: 'thunk'; t: number; g: number; pitch: number }
  /** one damped tone */
  | { k: 'tone'; t: number; g: number; f: number; f2: number; dur: number; wave: OscillatorType }
  /** bell-like: fundamental + inharmonic partial, long damped tail */
  | { k: 'bell'; t: number; g: number; f: number; dur: number };

export interface PlanOpts {
  /** reminder escalation 0..1 (louder, layered) */
  level?: number;
  character?: CharacterId;
}

type Rand = () => number;
const vary = (r: Rand, amount: number): number => 1 + (r() * 2 - 1) * amount;

const clack = (r: Rand, t: number, g: number, o: Partial<Extract<Step, { k: 'clack' }>> = {}): Step => ({
  k: 'clack',
  t: Math.max(0, t + (r() * 2 - 1) * 0.004),
  g,
  pitch: (o.pitch ?? 1) * vary(r, 0.08),
  bright: o.bright ?? 3200,
  len: o.len ?? 0.028,
  body: o.body ?? 1,
});

/** Reminder layers for an escalation level: 1..3. */
export function reminderLayers(level: number): 1 | 2 | 3 {
  return level > 0.67 ? 3 : level > 0.34 ? 2 : 1;
}

/** Gain for an escalation level: 0.55 at level 0 up to 1 (the volume setting is the hard cap). */
export function reminderGain(level: number): number {
  return 0.55 + 0.45 * Math.min(1, Math.max(0, level));
}

export function planSound(name: SoundName, opts: PlanOpts = {}, r: Rand = Math.random): Step[] {
  const yoda = opts.character === 'yoda' ? 0.92 : 1; // a hair lower for Yoda, the keyboard stays the same
  switch (name) {
    case 'key':
      return [clack(r, 0, 0.3, { pitch: yoda })];
    case 'click':
      return [clack(r, 0, 0.35, { bright: 4200, body: 0.8, len: 0.022 })];
    case 'clickFrenzy': {
      const out: Step[] = [];
      let t = 0;
      for (let i = 0; i < 9; i++) {
        out.push(clack(r, t, 0.3 + i * 0.03, { bright: 5000 + i * 120, body: 0.7, len: 0.016, pitch: 1.15 }));
        t += 0.04 + r() * 0.012;
      }
      out.push(clack(r, t + 0.02, 0.55, { pitch: 0.8, body: 1.2 })); // final thock
      return out;
    }
    case 'agentWork':
      return [clack(r, 0, 0.6, { pitch: 1.08 * yoda }), clack(r, 0.075 + r() * 0.01, 0.7, { pitch: 0.95 * yoda })];
    case 'agentDone':
      return [
        clack(r, 0, 0.6, { pitch: yoda }),
        clack(r, 0.09, 0.9, { pitch: 0.78 * yoda, body: 1.5, len: 0.05, bright: 1800 }),
        { k: 'tone', t: 0.22, g: 0.28, f: 880, f2: 990, dur: 0.07, wave: 'triangle' },
        { k: 'tone', t: 0.29, g: 0.28, f: 1318, f2: 1480, dur: 0.1, wave: 'triangle' },
      ];
    case 'agentError':
      return [
        { k: 'thunk', t: 0, g: 0.85, pitch: 1 * yoda },
        { k: 'thunk', t: 0.17, g: 0.75, pitch: 0.88 * yoda },
      ];
    case 'agentWaiting':
      return [clack(r, 0, 0.32, { bright: 1800, body: 0.7, len: 0.03 })];
    case 'reminder': {
      const level = Math.min(1, Math.max(0, opts.level ?? 0));
      const g = reminderGain(level);
      const up = 1 + 0.12 * level;
      const out: Step[] = [
        { k: 'tone', t: 0, g: 0.8 * g, f: 210 * up, f2: 115 * up, dur: 0.24, wave: 'sine' }, // soft damped thump
        { k: 'tone', t: 0.02, g: 0.32 * g, f: 523 * up, f2: 520 * up, dur: 0.5, wave: 'triangle' }, // chime
      ];
      const layers = reminderLayers(level);
      if (layers >= 2) out.push({ k: 'tone', t: 0.1, g: 0.28 * g, f: 659 * up, f2: 655 * up, dur: 0.45, wave: 'triangle' });
      if (layers >= 3) {
        out.push({ k: 'tone', t: 0.19, g: 0.26 * g, f: 784 * up, f2: 780 * up, dur: 0.45, wave: 'triangle' });
        out.push({ k: 'tone', t: 0.13, g: 0.6 * g, f: 190 * up, f2: 105 * up, dur: 0.2, wave: 'sine' }); // second thump
      }
      return out;
    }
    case 'pomodoroFocus':
      return [clack(r, 0, 0.45, { bright: 2400 }), { k: 'bell', t: 0.04, g: 0.6, f: 784, dur: 0.6 }];
    case 'pomodoroBreak':
      return [
        { k: 'bell', t: 0, g: 0.6, f: 659, dur: 0.55 },
        { k: 'bell', t: 0.3, g: 0.55, f: 523, dur: 0.65 },
      ];
    case 'pomodoroDone':
      return [
        { k: 'bell', t: 0, g: 0.5, f: 523, dur: 0.5 },
        { k: 'bell', t: 0.2, g: 0.5, f: 659, dur: 0.5 },
        { k: 'bell', t: 0.4, g: 0.5, f: 784, dur: 0.5 },
        { k: 'bell', t: 0.6, g: 0.6, f: 1047, dur: 0.8 },
      ];
    case 'overheat': {
      const out: Step[] = [];
      let t = 0;
      let gap = 0.09;
      for (let i = 0; i < 8; i++) {
        out.push(clack(r, t, 0.35 + i * 0.045, { pitch: 1 + i * 0.06, bright: 2800 + i * 250, len: 0.02 }));
        t += gap;
        gap = Math.max(0.035, gap * 0.82);
      }
      return out;
    }
    case 'purrClick':
      return [clack(r, 0, 0.17, { bright: 900, body: 0.55, len: 0.03, pitch: yoda })];
    case 'lift':
      return [{ k: 'tone', t: 0, g: 0.45, f: 280, f2: 760, dur: 0.07, wave: 'sine' }];
    case 'drop':
      return [clack(r, 0, 0.8, { pitch: 0.75, body: 1.3, len: 0.04, bright: 2200 })];
    case 'sleep':
      return [{ k: 'tone', t: 0, g: 0.1, f: 92, f2: 70, dur: 0.9, wave: 'sine' }]; // very quiet
    case 'speak':
      return []; // the character voice is rendered by the engine (gibberish / hum)
  }
}

export function planDuration(steps: Step[]): number {
  let end = 0;
  for (const s of steps) {
    const d = s.k === 'clack' ? s.len + 0.08 : s.k === 'thunk' ? 0.16 : s.dur;
    end = Math.max(end, s.t + d);
  }
  return end;
}

/* ------------------------------------------------------------------ reminder nag ---- */

export interface NagStep {
  /** seconds since the reminder first fired */
  at: number;
  /** 0..1 escalation */
  level: number;
}

export const NAG_FIRST_INTERVAL_S = 20;
export const NAG_MIN_INTERVAL_S = 8;
export const NAG_TOTAL_S = 120;

/** Repeat times after the initial chime: every ~20 s, shrinking toward 8 s, until ~2 min have passed. */
export function nagSchedule(): NagStep[] {
  const ats: number[] = [];
  let gap = NAG_FIRST_INTERVAL_S;
  let at = gap;
  while (at <= NAG_TOTAL_S) {
    ats.push(at);
    gap = Math.max(NAG_MIN_INTERVAL_S, gap - 2);
    at += gap;
  }
  return ats.map((a, i) => ({ at: a, level: ats.length > 1 ? (i + 1) / ats.length : 1 }));
}

/** Repeating, escalating stretch / water reminder until acknowledged. */
export class ReminderNag {
  private readonly steps = nagSchedule();
  private started = -1;
  private next = 0;
  kind: 'stretch' | 'water' | null = null;

  get active(): boolean {
    return this.kind !== null;
  }

  start(kind: 'stretch' | 'water', t: number): void {
    this.kind = kind;
    this.started = t;
    this.next = 0;
  }

  /** The user petted / clicked the critter or its bubble. */
  ack(): void {
    this.kind = null;
  }

  /** The step that is due at time `t`, once; null when none is due (or the nag is over). */
  poll(t: number): NagStep | null {
    if (!this.kind) return null;
    if (this.next >= this.steps.length) {
      this.kind = null;
      return null;
    }
    const s = this.steps[this.next]!;
    if (t - this.started < s.at) return null;
    this.next++;
    return s;
  }

  /** Seconds until the next step (Infinity when finished). */
  nextIn(t: number): number {
    if (!this.kind || this.next >= this.steps.length) return Infinity;
    return Math.max(0.05, this.started + this.steps[this.next]!.at - t);
  }
}

/* ------------------------------------------------------------------ agent waiting taps ---- */

export const WAIT_TAP_TIMES_S: readonly number[] = [0, 3.5, 7];

/** Gentle repeated tap while an agent waits for you: at most 3, stops at the first user input. */
export class WaitingTapper {
  private started = -1;
  private next = WAIT_TAP_TIMES_S.length;

  get active(): boolean {
    return this.next < WAIT_TAP_TIMES_S.length;
  }

  start(t: number): void {
    this.started = t;
    this.next = 0;
  }

  cancel(): void {
    this.next = WAIT_TAP_TIMES_S.length;
  }

  poll(t: number): boolean {
    if (!this.active) return false;
    if (t - this.started < WAIT_TAP_TIMES_S[this.next]!) return false;
    this.next++;
    return true;
  }

  nextIn(t: number): number {
    return this.active ? Math.max(0.05, this.started + WAIT_TAP_TIMES_S[this.next]! - t) : Infinity;
  }
}

/* ------------------------------------------------------------------ audition (Settings) ---- */

export interface AuditionStep {
  at: number;
  name: SoundName;
  opts?: PlanOpts;
}

export function auditionPlan(cat: SoundCategory): AuditionStep[] {
  switch (cat) {
    case 'typing':
      return [
        { at: 0, name: 'key' },
        { at: 0.16, name: 'key' },
        { at: 0.3, name: 'key' },
        { at: 0.7, name: 'click' },
        { at: 1.2, name: 'clickFrenzy' },
      ];
    case 'agents':
      return [
        { at: 0, name: 'agentWork' },
        { at: 0.8, name: 'agentDone' },
        { at: 1.7, name: 'agentError' },
        { at: 2.5, name: 'agentWaiting' },
      ];
    case 'reminders':
      return [
        { at: 0, name: 'reminder', opts: { level: 0 } },
        { at: 1.2, name: 'reminder', opts: { level: 0.5 } },
        { at: 2.4, name: 'reminder', opts: { level: 1 } },
      ];
    case 'pomodoro':
      return [
        { at: 0, name: 'pomodoroFocus' },
        { at: 1.2, name: 'pomodoroBreak' },
        { at: 2.4, name: 'pomodoroDone' },
      ];
    case 'other':
      return [
        { at: 0, name: 'lift' },
        { at: 0.5, name: 'drop' },
        { at: 1.1, name: 'overheat' },
        { at: 2.0, name: 'purrClick' },
        { at: 2.13, name: 'purrClick' },
        { at: 2.26, name: 'purrClick' },
        { at: 2.6, name: 'speak' },
      ];
  }
}

export const ALL_SOUNDS = Object.keys(CATEGORY_OF) as SoundName[];
