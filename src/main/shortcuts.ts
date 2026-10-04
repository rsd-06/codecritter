import { globalShortcut } from 'electron';
import { togglePeek } from './hooks';
import { openSettings } from './windows/settings';
import { toggleCompanionVisible } from './windows/overlay';

export function registerShortcuts(): void {
  const bind = (accel: string, fn: () => void): void => {
    try {
      if (!globalShortcut.register(accel, fn))
        console.warn(`[shortcuts] could not register ${accel}`);
    } catch (e) {
      console.warn(`[shortcuts] ${accel}:`, (e as Error).message);
    }
  };
  bind('CommandOrControl+Alt+P', togglePeek);
  bind('CommandOrControl+Alt+H', toggleCompanionVisible);
  bind('CommandOrControl+Alt+S', openSettings);
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
}
