import type { PomodoroState, ReminderEvent, Settings } from '../../shared/types';

/** Pomodoro engine (pure, injectable clock/timers). */

export interface PomodoroDeps {
  now(): number;
  getConfig(): Settings['pomodoro'];
  emitState(s: PomodoroState): void;
  emitReminder(e: ReminderEvent): void;
}

type Timers = { setInterval: typeof setInterval; clearInterval: typeof clearInterval };

const IDLE: PomodoroState = {
  phase: 'idle',
  endsAt: null,
  cycle: 0,
  paused: false,
  remainingMs: 0,
};

export class PomodoroEngine {
  private state: PomodoroState = { ...IDLE };
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private deps: PomodoroDeps,
    private timers: Timers = { setInterval, clearInterval },
  ) {}

  getState(): PomodoroState {
    const s = this.state;
    if (s.phase !== 'idle' && !s.paused && s.endsAt !== null) {
      return { ...s, remainingMs: Math.max(0, s.endsAt - this.deps.now()) };
    }
    return { ...s };
  }

  private duration(phase: 'focus' | 'break' | 'longBreak'): number {
    const c = this.deps.getConfig();
    const min = phase === 'focus' ? c.focusMin : phase === 'break' ? c.breakMin : c.longBreakMin;
    return Math.max(1, min) * 60_000;
  }

  private enter(phase: 'focus' | 'break' | 'longBreak', cycle: number): void {
    const ms = this.duration(phase);
    this.state = { phase, cycle, paused: false, endsAt: this.deps.now() + ms, remainingMs: ms };
    this.startTimer();
    const text =
      phase === 'focus'
        ? `Focus time! Round ${cycle}.`
        : phase === 'break'
          ? 'Break time! Step away for a bit.'
          : 'Long break! You earned it.';
    this.deps.emitReminder({
      kind: phase === 'focus' ? 'pomodoro-focus' : 'pomodoro-break',
      text,
      durationMs: 6000,
    });
    this.push();
  }

  private finish(): void {
    this.stopTimer();
    this.state = { ...IDLE };
    this.deps.emitReminder({
      kind: 'pomodoro-done',
      text: 'Pomodoro set complete! Great work.',
      durationMs: 8000,
    });
    this.push();
  }

  private next(): void {
    const { phase, cycle } = this.state;
    const every = Math.max(1, this.deps.getConfig().cyclesBeforeLong);
    if (phase === 'focus') this.enter(cycle % every === 0 ? 'longBreak' : 'break', cycle);
    else if (phase === 'break') this.enter('focus', cycle + 1);
    else if (phase === 'longBreak') this.finish();
  }

  private push(): void {
    this.deps.emitState(this.getState());
  }

  private startTimer(): void {
    if (this.timer) return;
    this.timer = this.timers.setInterval(() => this.onTick(), 1000);
    (this.timer as { unref?: () => void }).unref?.();
  }

  private stopTimer(): void {
    if (!this.timer) return;
    this.timers.clearInterval(this.timer);
    this.timer = null;
  }

  private onTick(): void {
    const s = this.state;
    if (s.phase === 'idle' || s.paused || s.endsAt === null) return;
    if (this.deps.now() >= s.endsAt) this.next();
    else this.push();
  }

  start(): void {
    if (this.state.phase !== 'idle') return;
    this.enter('focus', 1);
  }

  pause(): void {
    const s = this.state;
    if (s.phase === 'idle' || s.paused || s.endsAt === null) return;
    this.state = {
      ...s,
      paused: true,
      remainingMs: Math.max(0, s.endsAt - this.deps.now()),
      endsAt: null,
    };
    this.stopTimer();
    this.push();
  }

  resume(): void {
    const s = this.state;
    if (s.phase === 'idle' || !s.paused) return;
    this.state = { ...s, paused: false, endsAt: this.deps.now() + s.remainingMs };
    this.startTimer();
    this.push();
  }

  skip(): void {
    if (this.state.phase === 'idle') return;
    this.next();
  }

  stop(): void {
    if (this.state.phase === 'idle') return;
    this.stopTimer();
    this.state = { ...IDLE };
    this.push();
  }

  dispose(): void {
    this.stopTimer();
  }
}
