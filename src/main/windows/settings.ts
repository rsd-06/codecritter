import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { loadPage } from './overlay';

let win: BrowserWindow | null = null;
let quitting = false;

/** Lazily creates the (hidden until requested) settings window. */
export function getSettingsWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win;
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
      sandbox: false, // preload bundles share a chunk (see MEMORY.md)
    },
  });
  // Close hides rather than destroys, so reopening is instant.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win?.hide();
    }
  });
  loadPage(win, 'settings');
  return win;
}

export function openSettings(): void {
  const w = getSettingsWindow();
  w.show();
  w.focus();
}

export function markQuitting(): void {
  quitting = true;
}
