import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/defaults';
import type { PomodoroState, ReminderEvent, Settings } from '../../shared/types';
import { PomodoroEngine } from './pomodoro';
import { inDndWindow, startReminders, TICK_MS } from './reminders';

const clone = (): Settings => structuredClone(DEFAULT_SETTINGS);

describe('inDndWindow', () => {
  it('same-day window', () => {
    expect(inDndWindow(12 * 60, '09:00', '17:00')).toBe(true);
    expect(inDndWindow(17 * 60, '09:00', '17:00')).toBe(false);
    expect(inDndWindow(8 * 60 + 59, '09:00', '17:00')).toBe(false);
  });
  it('window crossing midnight', () => {
    expect(inDndWindow(23 * 60, '22:00', '07:00')).toBe(true);
    expect(inDndWindow(3 * 60, '22:00', '07:00')).toBe(true);
    expect(inDndWindow(7 * 60, '22:00', '07:00')).toBe(false);
    expect(inDndWindow(12 * 60, '22:00', '07:00')).toBe(false);
  });
  it('invalid or empty window is never active', () => {
    expect(inDndWindow(60, '09:00', '09:00')).toBe(false);
    expect(inDndWindow(60, 'xx', '09:00')).toBe(false);
  });
});

describe('reminders', () => {
  let s: Settings;
  let idle: number;
  let events: ReminderEvent[];
  let disabled: string[];
  let run: ReturnType<typeof startReminders>;

  const setup = (): void => {
    run = startReminders({
      now: () => Date.now(),
      idleMs: () => idle,
      getSettings: () => s,
      emit: (e) => events.push(e),
      disableMessage: (id) => disabled.push(id),
    });
  };
  const advance = (ms: number): void => {
    vi.advanceTimersByTime(ms);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 5, 10, 0, 0)); // Monday 10:00 local
    s = clone();
    s.reminders.stretch = { enabled: true, everyMin: 30 };
    s.reminders.water = { enabled: false, everyMin: 45 };
    s.dnd.enabled = false;
    s.messages = [];
    idle = 0;
    events = [];
    disabled = [];
  });
  afterEach(() => {
    run?.stop();
    vi.useRealTimers();
  });

  it('fires stretch at the interval and repeats', () => {
    setup();
    advance(29 * 60_000);
    expect(events).toHaveLength(0);
    advance(61_000);
    expect(events.map((e) => e.kind)).toEqual(['stretch']);
    advance(30 * 60_000);
    expect(events).toHaveLength(2);
  });

  it('resets the timer when settings change', () => {
    setup();
    advance(25 * 60_000);
    s.reminders.stretch = { enabled: true, everyMin: 10 };
    run.settingsChanged();
    advance(9 * 60_000);
    expect(events).toHaveLength(0);
    advance(2 * 60_000);
    expect(events).toHaveLength(1);
  });

  it('does not fire when disabled', () => {
    s.reminders.stretch.enabled = false;
    setup();
    advance(3 * 3600_000);
    expect(events).toHaveLength(0);
  });

  it('skips while DND (midnight-crossing) is active', () => {
    vi.setSystemTime(new Date(2026, 9, 5, 23, 0, 0));
    s.dnd = { enabled: true, from: '22:00', to: '07:00' };
    setup();
    advance(2 * 3600_000);
    expect(events).toHaveLength(0);
    vi.setSystemTime(new Date(2026, 9, 6, 7, 0, 0));
    advance(31 * 60_000);
    expect(events.length).toBeGreaterThan(0);
  });

  it('postpones while the user is away and fires on return', () => {
    setup();
    idle = 6 * 60_000;
    advance(40 * 60_000);
    expect(events).toHaveLength(0);
    idle = 0;
    advance(TICK_MS);
    expect(events.map((e) => e.kind)).toEqual(['stretch']);
  });

  it('fires a daily custom message once within grace and ignores older ones', () => {
    s.messages = [
      { id: 'a', time: '10:05', text: 'Standup', repeat: 'daily', enabled: true },
      { id: 'b', time: '09:00', text: 'Missed', repeat: 'daily', enabled: true },
    ];
    s.reminders.stretch.enabled = false;
    setup();
    advance(4 * 60_000);
    expect(events).toHaveLength(0);
    advance(2 * 60_000);
    expect(events.map((e) => e.text)).toEqual(['Standup']);
    advance(10 * 60_000);
    expect(events).toHaveLength(1);
  });

  it('once messages disable themselves; weekdays skip weekends', () => {
    s.messages = [
      { id: 'o', time: '10:01', text: 'Once', repeat: 'once', enabled: true },
      { id: 'w', time: '10:01', text: 'Wk', repeat: 'weekdays', enabled: true },
    ];
    s.reminders.stretch.enabled = false;
    setup();
    advance(2 * 60_000);
    expect(events.map((e) => e.text).sort()).toEqual(['Once', 'Wk']);
    expect(disabled).toEqual(['o']);
    run.stop();
    events = [];
    vi.setSystemTime(new Date(2026, 9, 10, 10, 0, 0)); // Saturday
    s.messages = [{ id: 'w', time: '10:01', text: 'Wk', repeat: 'weekdays', enabled: true }];
    setup();
    advance(2 * 60_000);
    expect(events).toHaveLength(0);
  });
});

describe('pomodoro', () => {
  let states: PomodoroState[];
  let reminders: ReminderEvent[];
  let p: PomodoroEngine;
  const cfg = { focusMin: 25, breakMin: 5, longBreakMin: 15, cyclesBeforeLong: 2 };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    states = [];
    reminders = [];
    p = new PomodoroEngine({
      now: () => Date.now(),
      getConfig: () => cfg,
      emitState: (s) => states.push(s),
      emitReminder: (e) => reminders.push(e),
    });
  });
  afterEach(() => {
    p.dispose();
    vi.useRealTimers();
  });

  it('runs focus -> break -> focus -> longBreak -> done', () => {
    p.start();
    expect(p.getState().phase).toBe('focus');
    vi.advanceTimersByTime(25 * 60_000);
    expect(p.getState()).toMatchObject({ phase: 'break', cycle: 1 });
    vi.advanceTimersByTime(5 * 60_000);
    expect(p.getState()).toMatchObject({ phase: 'focus', cycle: 2 });
    vi.advanceTimersByTime(25 * 60_000);
    expect(p.getState()).toMatchObject({ phase: 'longBreak', cycle: 2 });
    vi.advanceTimersByTime(15 * 60_000);
    expect(p.getState().phase).toBe('idle');
    expect(reminders.map((r) => r.kind)).toEqual([
      'pomodoro-focus',
      'pomodoro-break',
      'pomodoro-focus',
      'pomodoro-break',
      'pomodoro-done',
    ]);
  });

  it('emits at most once per second and only while running', () => {
    p.start();
    const n = states.length;
    vi.advanceTimersByTime(10_000);
    expect(states.length - n).toBeLessThanOrEqual(10);
    expect(states.length - n).toBeGreaterThanOrEqual(9);
    p.pause();
    const m = states.length;
    vi.advanceTimersByTime(30_000);
    expect(states.length).toBe(m);
  });

  it('pause/resume preserves remaining time', () => {
    p.start();
    vi.advanceTimersByTime(10 * 60_000);
    p.pause();
    expect(p.getState()).toMatchObject({ paused: true, remainingMs: 15 * 60_000, endsAt: null });
    vi.advanceTimersByTime(60 * 60_000);
    p.resume();
    expect(p.getState().remainingMs).toBe(15 * 60_000);
    vi.advanceTimersByTime(15 * 60_000);
    expect(p.getState().phase).toBe('break');
  });

  it('skip advances, stop resets', () => {
    p.start();
    p.skip();
    expect(p.getState().phase).toBe('break');
    p.stop();
    expect(p.getState()).toMatchObject({ phase: 'idle', endsAt: null });
    expect(states.at(-1)?.phase).toBe('idle');
  });
});
