import { powerMonitor } from 'electron';
import { IPC } from '../../shared/ipc';
import { registerPomodoro } from '../hooks';
import { getSettings, onSettingsChanged, updateSettings } from '../store';
import { broadcast } from '../windows/overlay';
import { PomodoroEngine } from './pomodoro';
import { startReminders, type ReminderRunner } from './reminders';

let runner: ReminderRunner | null = null;
let pomo: PomodoroEngine | null = null;
let off: (() => void) | null = null;

/** Start reminders + pomodoro and register the pomodoro engine with hooks.ts. */
export function startScheduler(): void {
  if (runner) return;
  runner = startReminders({
    now: () => Date.now(),
    idleMs: () => {
      try {
        return powerMonitor.getSystemIdleTime() * 1000;
      } catch {
        return 0;
      }
    },
    getSettings,
    emit: (e) => broadcast(IPC.reminder, e),
    disableMessage: (id) =>
      updateSettings({
        messages: getSettings().messages.map((m) => (m.id === id ? { ...m, enabled: false } : m)),
      }),
  });
  off = onSettingsChanged(() => runner?.settingsChanged());

  pomo = new PomodoroEngine({
    now: () => Date.now(),
    getConfig: () => getSettings().pomodoro,
    emitState: (s) => broadcast(IPC.pomodoro, s),
    emitReminder: (e) => broadcast(IPC.reminder, e),
  });
  registerPomodoro({
    start: () => pomo?.start(),
    pause: () => pomo?.pause(),
    resume: () => pomo?.resume(),
    skip: () => pomo?.skip(),
    stop: () => pomo?.stop(),
    getState: () =>
      pomo?.getState() ?? { phase: 'idle', endsAt: null, cycle: 0, paused: false, remainingMs: 0 },
  });
}

export function stopScheduler(): void {
  runner?.stop();
  runner = null;
  off?.();
  off = null;
  pomo?.dispose();
  pomo = null;
}
