// In-memory SettingsBridge used outside Tauri (browser playground).
import { DEFAULT_SETTINGS } from '@shared/defaults';
import type { AgentId, PomodoroState, Settings, SettingsBridge } from '@shared/types';
import { AGENTS } from './helpers';

const idle = (): PomodoroState => ({ phase: 'idle', endsAt: null, cycle: 0, paused: false, remainingMs: 0 });

export function createMockBridge(): SettingsBridge {
  let settings: Settings = structuredClone(DEFAULT_SETTINGS);
  let pomo = idle();
  const subs = new Set<(s: PomodoroState) => void>();
  const push = (): void => subs.forEach((f) => f({ ...pomo }));
  const installed: Record<string, boolean> = { 'claude-code': true };
  const fileOf = (id: string): string => AGENTS.find((a) => a.id === id)?.file ?? '';
  const phaseMs = (p: PomodoroState['phase']): number =>
    60_000 *
    (p === 'focus'
      ? settings.pomodoro.focusMin
      : p === 'break'
        ? settings.pomodoro.breakMin
        : settings.pomodoro.longBreakMin);

  const begin = (phase: PomodoroState['phase'], cycle: number): PomodoroState => ({
    phase,
    cycle,
    paused: false,
    endsAt: Date.now() + phaseMs(phase),
    remainingMs: phaseMs(phase),
  });

  return {
    get: () => Promise.resolve(structuredClone(settings)),
    set: (patch) => {
      settings = { ...settings, ...patch };
      return Promise.resolve(structuredClone(settings));
    },
    pomodoro: (cmd) => {
      if (cmd === 'start') pomo = begin('focus', 1);
      else if (cmd === 'stop') pomo = idle();
      else if (cmd === 'pause' && pomo.phase !== 'idle' && !pomo.paused) {
        pomo = { ...pomo, paused: true, remainingMs: Math.max(0, (pomo.endsAt ?? Date.now()) - Date.now()), endsAt: null };
      } else if (cmd === 'resume' && pomo.paused) {
        pomo = { ...pomo, paused: false, endsAt: Date.now() + pomo.remainingMs };
      } else if (cmd === 'skip' && pomo.phase !== 'idle') {
        pomo = pomo.phase === 'focus' ? begin('break', pomo.cycle) : begin('focus', pomo.cycle + 1);
      }
      push();
      return Promise.resolve({ ...pomo });
    },
    pomodoroState: () => Promise.resolve({ ...pomo }),
    onPomodoro: (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    agentStatus: () =>
      Promise.resolve(
        Object.fromEntries(
          AGENTS.map((a) => [a.id, { installed: !!installed[a.id], path: fileOf(a.id) }]),
        ),
      ),
    installAgent: (id: AgentId) => {
      installed[id] = true;
      return Promise.resolve({ ok: true, message: `Installed hooks (mock) in ${fileOf(id)}` });
    },
    uninstallAgent: (id: AgentId) => {
      installed[id] = false;
      return Promise.resolve({ ok: true, message: `Removed hooks (mock) from ${fileOf(id)}` });
    },
    testEvent: () => Promise.resolve(),
    testReminder: () => Promise.resolve(),
    exportSettings: () => Promise.resolve('mock-settings.json'),
    importSettings: () => Promise.resolve(false),
    checkUpdate: () => Promise.resolve({ available: false }),
    installUpdate: () => Promise.resolve(),
    updateStatus: () =>
      Promise.resolve({ currentVersion: '0.2.1', lastCheckedAt: null, available: false, downloaded: false }),
  };
}
