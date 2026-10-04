import { app, dialog, ipcMain } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { IPC } from '../shared/ipc';
import type {
  AgentEvent,
  AgentEventType,
  ReminderEvent,
  ReminderKind,
  Settings,
} from '../shared/types';
import { initAutostart } from './autostart';
import { getAgentApi, pomodoroCommand } from './hooks';
import { startCursorPoller, stopCursorPoller } from './input/cursor';
import { startInputMonitor, stopInputMonitor } from './input/monitor';
import { registerShortcuts, unregisterShortcuts } from './shortcuts';
import { getSettings, loadSettings, updateSettings } from './store';
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

/**
 * Agent bridge: HTTP server (agent C). Dynamic import in try/catch so a missing/broken
 * module never prevents the companion from starting.
 */
async function registerAgentBridge(): Promise<{ close(): Promise<void> } | null> {
  try {
    const s = getSettings();
    if (!s.agents.enabled) return null;
    const [{ startAgentServer }, { ensureToken }] = await Promise.all([
      import('./agents/server'),
      import('./agents/token'),
    ]);
    const token = await ensureToken();
    return await startAgentServer({
      port: s.agents.port,
      token,
      onEvent: (e: AgentEvent) => broadcast(IPC.agent, e),
    });
  } catch (err) {
    console.warn('[agents] bridge unavailable:', (err as Error).message);
    return null;
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.getSettings, () => getSettings());
  ipcMain.handle(IPC.setSettings, (_e, patch: Partial<Settings>) => updateSettings(patch ?? {}));
  ipcMain.handle(IPC.pomodoroCmd, (_e, cmd) => pomodoroCommand(cmd));
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
    const s = getSettings();
    await writeFile(
      filePath,
      JSON.stringify({ ...s, agents: { ...s.agents, token: '' } }, null, 2),
    );
    return filePath;
  });
  ipcMain.handle(IPC.importSettings, async () => {
    const r = await dialog.showOpenDialog({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    const file = r.filePaths[0];
    if (!file) return false;
    try {
      const imported = loadSettings(JSON.parse(await readFile(file, 'utf8')));
      // keep machine-local bits
      updateSettings({
        ...imported,
        position: getSettings().position,
        agents: getSettings().agents,
      });
      return true;
    } catch {
      return false;
    }
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
  let agentServer: { close(): Promise<void> } | null = null;
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
    agentServer = await registerAgentBridge();
    if (process.env['CRITTER_METRICS']) {
      setTimeout(() => {
        const m = app.getAppMetrics();
        const mem = m.reduce((a, p) => a + p.memory.workingSetSize, 0) / 1024;
        const cpu = m.reduce((a, p) => a + p.cpu.percentCPUUsage, 0);
        console.log(
          `[metrics] total workingSet=${mem.toFixed(0)}MB cpu=${cpu.toFixed(2)}% ` +
            m
              .map(
                (p) =>
                  `${p.type}:${(p.memory.workingSetSize / 1024).toFixed(0)}MB/${p.cpu.percentCPUUsage.toFixed(1)}%`,
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
    void agentServer?.close();
  });
  app.on('window-all-closed', () => {
    // tray app: keep running (quit is explicit)
  });
}
