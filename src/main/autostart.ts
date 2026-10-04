import { app } from 'electron';
import { onSettingsChanged, getSettings } from './store';

/** Registers login item for packaged builds only (dev would register electron.exe). */
export function applyAutostart(enabled: boolean): void {
  if (!app.isPackaged || process.platform === 'linux') return;
  app.setLoginItemSettings({ openAtLogin: enabled });
}

export function initAutostart(): void {
  applyAutostart(getSettings().autostart);
  onSettingsChanged((n, p) => {
    if (n.autostart !== p.autostart) applyAutostart(n.autostart);
  });
}
