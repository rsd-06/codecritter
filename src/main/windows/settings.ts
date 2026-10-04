import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { loadPage } from './overlay';

let win: BrowserWindow | null = null;

/**
 * Settings window is created lazily on demand and DESTROYED on close so its renderer
 * process (and memory) is released while the companion idles in the tray.
 */
export function openSettings(): void {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 900,
    height: 640,
    show: false,
    title: 'CodeCritter Settings',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/settings.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => {
    win?.show();
    win?.focus();
  });
  win.on('closed', () => {
    win = null;
  });
  loadPage(win, 'settings');
}

/** Push a message to the settings window (no-op when it is closed). */
export function sendToSettings(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

export function isSettingsOpen(): boolean {
  return !!win && !win.isDestroyed();
}

/** Kept for API compatibility; nothing to do now that close destroys the window. */
export function markQuitting(): void {
  /* no-op */
}
