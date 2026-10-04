import type { CustomMessage, ReminderEvent, ReminderKind, Settings } from '../../shared/types';

/** Pure reminder scheduling (no Electron). Time/idle/settings/emit are injected. */

export const TICK_MS = 20_000;
export const GRACE_MS = 2 * 60_000;
export const AWAY_AFTER_MS = 5 * 60_000;
export const REMINDER_DURATION_MS = 7000;

const TEXT: Record<'stretch' | 'water', string> = {
  stretch: 'Time to stretch! Roll those shoulders.',
  water: 'Drink some water!',
};

export function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** True when `minuteOfDay` is inside [from, to). Handles windows crossing midnight. */
export function inDndWindow(minuteOfDay: number, from: string, to: string): boolean {
  const a = parseHHMM(from);
  const b = parseHHMM(to);
  if (a === null || b === null || a === b) return false;
  return a < b ? minuteOfDay >= a && minuteOfDay < b : minuteOfDay >= a || minuteOfDay < b;
}

export function isDndActive(s: Settings['dnd'], at: Date): boolean {
  return s.enabled && inDndWindow(at.getHours() * 60 + at.getMinutes(), s.from, s.to);
}

const dayKey = (d: Date): string => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Local timestamp of today's HH:MM occurrence (null when invalid). */
export function todayAt(time: string, now: Date): number | null {
  const m = parseHHMM(time);
  if (m === null) return null;
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    Math.floor(m / 60),
    m % 60,
  ).getTime();
}

export function repeatsToday(msg: CustomMessage, now: Date): boolean {
  if (msg.repeat === 'weekdays') {
    const d = now.getDay();
    return d >= 1 && d <= 5;
  }
  return true;
}

export interface ReminderDeps {
  now(): number;
  /** ms since last user input (system idle). */
  idleMs(): number;
  getSettings(): Settings;
  emit(e: ReminderEvent): void;
  /** Called after a 'once' message fires so it can be disabled. */
  disableMessage(id: string): void;
}

type Interval = 'stretch' | 'water';

export class ReminderEngine {
  private due: Record<Interval, number | null> = { stretch: null, water: null };
  private pending: Record<Interval, boolean> = { stretch: false, water: false };
  private cfgKey: Record<Interval, string> = { stretch: '', water: '' };
  private firedOn = new Map<string, string>(); // message id -> dayKey

  constructor(private deps: ReminderDeps) {
    this.syncIntervals();
  }

  /** Re-read settings: restart interval timers whose config changed. */
  syncIntervals(): void {
    const s = this.deps.getSettings();
    const now = this.deps.now();
    for (const k of ['stretch', 'water'] as const) {
      const c = s.reminders[k];
      const key = `${c.enabled}:${c.everyMin}`;
      if (key === this.cfgKey[k]) continue;
      this.cfgKey[k] = key;
      this.pending[k] = false;
      this.due[k] = c.enabled ? now + Math.max(1, c.everyMin) * 60_000 : null;
    }
  }

  private fire(kind: ReminderKind, text: string): void {
    this.deps.emit({ kind, text, durationMs: REMINDER_DURATION_MS });
  }

  /** Call every ~20 s. Wall-clock based so timer drift / sleep cannot skip or double fire. */
  tick(): void {
    const now = this.deps.now();
    const s = this.deps.getSettings();
    const at = new Date(now);
    const dnd = isDndActive(s.dnd, at);
    const away = this.deps.idleMs() > AWAY_AFTER_MS;

    for (const k of ['stretch', 'water'] as const) {
      const due = this.due[k];
      if (due === null) continue;
      const every = Math.max(1, s.reminders[k].everyMin) * 60_000;
      if (now >= due) this.pending[k] = true;
      if (!this.pending[k]) continue;
      if (dnd) {
        // silently skip this occurrence
        this.pending[k] = false;
        this.due[k] = now + every;
        continue;
      }
      if (away) continue; // postponed; fires on return
      this.pending[k] = false;
      this.due[k] = now + every;
      this.fire(k, TEXT[k]);
    }

    this.tickMessages(s.messages, now, at, dnd);
  }

  private tickMessages(messages: CustomMessage[], now: number, at: Date, dnd: boolean): void {
    const today = dayKey(at);
    for (const [id, d] of this.firedOn) if (d !== today) this.firedOn.delete(id);
    for (const msg of messages) {
      if (!msg.enabled || !repeatsToday(msg, at)) continue;
      const sched = todayAt(msg.time, at);
      if (sched === null) continue;
      if (now < sched || now - sched > GRACE_MS) continue;
      if (this.firedOn.get(msg.id) === today) continue;
      this.firedOn.set(msg.id, today);
      if (dnd) continue; // missed during DND: do not fire later
      this.fire('message', msg.text || 'Reminder');
      if (msg.repeat === 'once') this.deps.disableMessage(msg.id);
    }
  }
}

export interface ReminderRunner {
  engine: ReminderEngine;
  settingsChanged(): void;
  stop(): void;
}

/** Wire the engine to timers. Call `settingsChanged` from onSettingsChanged. */
export function startReminders(
  deps: ReminderDeps,
  timers: { setInterval: typeof setInterval; clearInterval: typeof clearInterval } = {
    setInterval,
    clearInterval,
  },
): ReminderRunner {
  const engine = new ReminderEngine(deps);
  const h = timers.setInterval(() => engine.tick(), TICK_MS);
  (h as { unref?: () => void }).unref?.();
  return {
    engine,
    settingsChanged: () => engine.syncIntervals(),
    stop: () => timers.clearInterval(h),
  };
}
