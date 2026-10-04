import { app, ipcMain } from 'electron';
import { IPC } from '../shared/ipc';
import type { Settings } from '../shared/types';
import { getSettings, setSettings } from './store';
import { createOverlayWindow } from './windows/overlay';
import { markQuitting, openSettings } from './windows/settings';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    ipcMain.handle(IPC.getSettings, () => getSettings());
    ipcMain.handle(IPC.setSettings, (_e, patch: Partial<Settings>) => setSettings(patch));
    ipcMain.on(IPC.openSettings, () => openSettings());
    ipcMain.on(IPC.setInteractive, () => undefined);
    createOverlayWindow(getSettings().scale);
  });
  app.on('before-quit', markQuitting);
  app.on('window-all-closed', () => {
    // tray app: keep running (quit is explicit)
  });
}
