// Tauri implementation of OverlayBridge + SettingsBridge (invoke commands, listen to events).
// Command names are the snake_case IPC keys (see src-tauri/src/commands.rs); events keep the
// `critter:*` names from shared/ipc.ts.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { IPC } from '@shared/ipc';
import type {
  AgentEvent,
  AgentEventType,
  AgentId,
  CursorSample,
  InputSample,
  OverlayBridge,
  PomodoroState,
  ReminderEvent,
  ReminderKind,
  Settings,
  SettingsBridge,
  UpdateInfo,
  UpdateStatus,
} from '@shared/types';

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Subscribe synchronously; the underlying listen() resolves later. */
function on<T>(event: string, cb: (v: T) => void): () => void {
  let off: (() => void) | null = null;
  let cancelled = false;
  void listen<T>(event, (e) => cb(e.payload)).then((fn) => {
    if (cancelled) fn();
    else off = fn;
  });
  return () => {
    cancelled = true;
    off?.();
  };
}

const fire = (cmd: string, args?: Record<string, unknown>): void => {
  invoke(cmd, args).catch(() => undefined);
};

export class TauriBridge implements OverlayBridge, SettingsBridge {
  // ---- OverlayBridge
  onInput = (cb: (s: InputSample) => void) => on(IPC.input, cb);
  onCursor = (cb: (s: CursorSample) => void) => on(IPC.cursor, cb);
  onAgent = (cb: (e: AgentEvent) => void) => on(IPC.agent, cb);
  onReminder = (cb: (e: ReminderEvent) => void) => on(IPC.reminder, cb);
  onPomodoro = (cb: (s: PomodoroState) => void) => on(IPC.pomodoro, cb);
  onSettings = (cb: (s: Settings) => void) => on(IPC.settings, cb);
  onPeek = (cb: (peeking: boolean) => void) => on(IPC.peek, cb);
  getSettings = (): Promise<Settings> => invoke<Settings>('get_settings');
  setInteractive = (on_: boolean): void => fire('set_interactive', { on: on_ });
  dragStart = (): void => fire('drag_start');
  dragMove = (dx: number, dy: number): void => fire('drag_move', { dx, dy });
  dragEnd = (): void => fire('drag_end');
  openSettings = (): void => fire('open_settings');
  showContextMenu = (): void => fire('show_context_menu');

  // ---- SettingsBridge
  get = (): Promise<Settings> => invoke<Settings>('get_settings');
  set = (patch: Partial<Settings>): Promise<Settings> => invoke<Settings>('set_settings', { patch });
  pomodoro = (cmd: 'start' | 'pause' | 'resume' | 'skip' | 'stop'): Promise<PomodoroState> =>
    invoke<PomodoroState>('pomodoro_cmd', { cmd });
  pomodoroState = (): Promise<PomodoroState> => invoke<PomodoroState>('pomodoro_state');
  agentStatus = (): Promise<Record<string, { installed: boolean; path: string }>> =>
    invoke('agent_status');
  installAgent = (id: AgentId): Promise<{ ok: boolean; message: string }> =>
    invoke('install_agent', { id });
  uninstallAgent = (id: AgentId): Promise<{ ok: boolean; message: string }> =>
    invoke('uninstall_agent', { id });
  testEvent = (type: AgentEventType): Promise<void> => invoke('test_event', { kind: type });
  testReminder = (kind: ReminderKind): Promise<void> => invoke('test_reminder', { kind });
  exportSettings = (): Promise<string | null> => invoke('export_settings');
  importSettings = (): Promise<boolean> => invoke('import_settings');
  checkUpdate = (): Promise<UpdateInfo> => invoke<UpdateInfo>('check_update');
  installUpdate = (): Promise<void> => invoke('install_update');
  updateStatus = (): Promise<UpdateStatus> => invoke<UpdateStatus>('update_status');
}

/** Route `window.open(https://...)` (settings About links) to the system browser. */
export function installExternalLinks(): void {
  window.open = ((url?: string | URL) => {
    if (url) fire('open_external', { url: String(url) });
    return null;
  }) as typeof window.open;
}
