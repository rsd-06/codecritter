import { app, dialog, ipcMain } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { IPC } from '../shared/ipc';
import type {
  AgentEvent,
  AgentEventType,
  ReminderEvent,
  ReminderKind,
  Settings,
} from '../shared/types';
import { initAutostart } from './autostart';
import { getAgentApi, getPomodoroState, pomodoroCommand, registerAgentApi } from './hooks';
import { prepareHookCmd } from './hookCmd';
import { startPeek, stopPeek } from './peek';
import { startScheduler, stopScheduler } from './scheduler';
import { exportToFile, importFromFile, SyncFolder } from './sync';
import { startCursorPoller, stopCursorPoller } from './input/cursor';
import { startInputMonitor, stopInputMonitor } from './input/monitor';
import { registerShortcuts, unregisterShortcuts } from './shortcuts';
import { getSettings, onSettingsChanged, updateSettings } from './store';
import { createTray, popupMenu } from './tray';
import {
  broadcast,
  createOverlayWindow,
  dragEnd,
  dragMove,
  dragStart,
  setInteractive,
} from './windows/overlay';
import { openSettings } from './windows/settings';

// --- Lightweight-by-default: tiny pixel canvas renders fine in software. ---
if (process.env['CRITTER_GPU'] !== '1') app.disableHardwareAcceleration();
app.commandLine.appendSwitch(
  'disable-features',
  'CalculateNativeWinOcclusion,MediaRouter,SpareRendererForSitePerProcess,HardwareMediaKeyHandling',
);
// Fold GPU + network service into the browser process (saves ~2 helper processes).
if (process.env['CRITTER_GPU'] !== '1') app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('enable-features', 'NetworkServiceInProcess2');
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128');
app.commandLine.appendSwitch('disable-renderer-backgrounding'); // keep overlay timers accurate

const REMINDER_TEXT: Record<ReminderKind, string> = {
  stretch: 'Time to stretch!',
  water: 'Drink some water!',
  message: 'Hello from CodeCritter!',
  'pomodoro-focus': 'Focus time!',
  'pomodoro-break': 'Break time!',
  'pomodoro-done': 'All done!',
};

/** Hook script source: bin/ in dev, resources/bin when packaged (extraResources). */
function hookSource(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'bin', 'critter-hook.mjs')
    : join(app.getAppPath(), 'bin', 'critter-hook.mjs');
}

type Handle = { close(): Promise<void> };
let agentServer: Handle | null = null;
let agentKey = '';

/**
 * Agent bridge: HTTP server (agent C). Dynamic import in try/catch so a missing/broken
 * module never prevents the companion from starting. Restarts on enabled/port changes.
 */
async function syncAgentServer(): Promise<void> {
  const s = getSettings();
  const key = s.agents.enabled ? String(s.agents.port) : '';
  if (key === agentKey) return;
  agentKey = key;
  const old = agentServer;
  agentServer = null;
  await old?.close().catch(() => undefined);
  if (!key) return;
  try {
    const [{ startAgentServer }, { ensureToken }] = await Promise.all([
      import('./agents/server'),
      import('./agents/token'),
    ]);
    const token = await ensureToken();
    const handle = await startAgentServer({
      port: s.agents.port,
      token,
      onEvent: (e: AgentEvent) => broadcast(IPC.agent, e),
    });
    if (agentKey === key) agentServer = handle;
    else await handle.close();
  } catch (err) {
    agentKey = '';
    console.warn('[agents] bridge unavailable:', (err as Error).message);
  }
}

async function registerAgentInstallers(): Promise<void> {
  try {
    const { AGENT_INSTALLERS, agentStatusAll } = await import('./agents/installers');
    const home = homedir();
    const hookCmd = (): Promise<string[]> =>
      prepareHookCmd({ dir: join(home, '.codecritter'), hookSource: hookSource() }).then(
        (r) => r.hookCmd,
      );
    // refresh the copied hook script on every launch (keeps it in sync with the app version)
    void hookCmd().catch((e: Error) => console.warn('[agents] hook script:', e.message));
    registerAgentApi({
      status: () => agentStatusAll(home),
      install: async (id) => {
        const inst = AGENT_INSTALLERS[id];
        if (!inst) return { ok: false, message: `Unknown agent ${id}` };
        return inst.install(home, await hookCmd());
      },
      uninstall: async (id) => {
        const inst = AGENT_INSTALLERS[id];
        if (!inst) return { ok: false, message: `Unknown agent ${id}` };
        return inst.uninstall(home);
      },
    });
  } catch (err) {
    console.warn('[agents] installers unavailable:', (err as Error).message);
  }
}

const sync = new SyncFolder({
  getSettings,
  apply: (next) => updateSettings(next),
});

function registerIpc(): void {
  ipcMain.handle(IPC.getSettings, () => getSettings());
  ipcMain.handle(IPC.setSettings, (_e, patch: Partial<Settings>) => updateSettings(patch ?? {}));
  ipcMain.handle(IPC.pomodoroCmd, (_e, cmd) => pomodoroCommand(cmd));
  ipcMain.handle(IPC.pomodoroState, () => getPomodoroState());
  ipcMain.handle(IPC.agentStatus, () => getAgentApi().status());
  ipcMain.handle(IPC.installAgent, (_e, id) => getAgentApi().install(id));
  ipcMain.handle(IPC.uninstallAgent, (_e, id) => getAgentApi().uninstall(id));
  ipcMain.handle(IPC.testEvent, (_e, type: AgentEventType) => {
    const ev: AgentEvent = { agent: 'generic', type, message: `test ${type}`, ts: Date.now() };
    broadcast(IPC.agent, ev);
  });
  ipcMain.handle(IPC.testReminder, (_e, kind: ReminderKind) => {
    const ev: ReminderEvent = { kind, text: REMINDER_TEXT[kind] ?? 'Reminder', durationMs: 6000 };
    broadcast(IPC.reminder, ev);
  });
  ipcMain.handle(IPC.exportSettings, async () => {
    const { filePath } = await dialog.showSaveDialog({
      defaultPath: 'codecritter-settings.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!filePath) return null;
    await exportToFile(filePath, getSettings());
    return filePath;
  });
  ipcMain.handle(IPC.importSettings, async () => {
    const r = await dialog.showOpenDialog({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    const file = r.filePaths[0];
    if (!file) return false;
    const next = await importFromFile(file, getSettings());
    if (!next) return false;
    updateSettings(next);
    return true;
  });
  // overlay
  ipcMain.on(IPC.setInteractive, (_e, on: boolean) => setInteractive(!!on));
  ipcMain.on(IPC.dragStart, () => dragStart());
  ipcMain.on(IPC.dragMove, () => dragMove());
  ipcMain.on(IPC.dragEnd, () => dragEnd());
  ipcMain.on(IPC.openSettings, () => openSettings());
  ipcMain.on(IPC.contextMenu, () => popupMenu());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.dock?.hide();
  app.on('second-instance', () => openSettings());
  app.whenReady().then(async () => {
    getSettings(); // load + migrate
    registerIpc();
    createOverlayWindow();
    createTray();
    registerShortcuts();
    initAutostart();
    startInputMonitor();
    startCursorPoller();
    startScheduler();
    startPeek();
    await registerAgentInstallers();
    await syncAgentServer();
    onSettingsChanged((next, prev) => {
      if (next.agents.enabled !== prev.agents.enabled || next.agents.port !== prev.agents.port)
        void syncAgentServer();
      if (next.syncFolder !== prev.syncFolder) void sync.setFolder(next.syncFolder);
      else sync.settingsChanged();
    });
    void sync.setFolder(getSettings().syncFolder);
    if (process.env['CRITTER_METRICS']) {
      setTimeout(() => {
        const m = app.getAppMetrics();
        const mem = m.reduce((a, p) => a + p.memory.workingSetSize, 0) / 1024;
        const cpu = m.reduce((a, p) => a + p.cpu.percentCPUUsage, 0);
        const mu = process.memoryUsage();
        console.log(`[metrics] main heapUsed=${(mu.heapUsed / 1048576).toFixed(0)}MB rss=${(mu.rss / 1048576).toFixed(0)}MB external=${(mu.external / 1048576).toFixed(0)}MB`);
        console.log(
          `[metrics] total workingSet=${mem.toFixed(0)}MB cpu=${cpu.toFixed(2)}% ` +
            m
              .map(
                (p) =>
                  `${p.type}:${(p.memory.workingSetSize / 1024).toFixed(0)}MB(priv ${((p.memory.privateBytes ?? 0) / 1024).toFixed(0)})/${p.cpu.percentCPUUsage.toFixed(1)}%`,
              )
              .join(' '),
        );
      }, 15000);
    }
  });
  app.on('will-quit', () => {
    unregisterShortcuts();
    stopInputMonitor();
    stopCursorPoller();
    stopScheduler();
    stopPeek();
    sync.stop();
    void agentServer?.close();
  });
  app.on('window-all-closed', () => {
    // tray app: keep running (quit is explicit)
  });
}
