import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron';
import type { CharacterId } from '../shared/types';
import {
  isPeeking,
  isReactionsPaused,
  onStateChange,
  pomodoroCommand,
  togglePeek,
  toggleReactionsPaused,
} from './hooks';
import { getSettings, onSettingsChanged, updateSettings } from './store';
import { toggleCompanionVisible } from './windows/overlay';
import { openSettings } from './windows/settings';

// 16x16 placeholder head (Stitch-like). Letters map to colours; '.' transparent.
const GRID = [
  '.OO..........OO.',
  'OPPO........OPPO',
  'OPPBO......OBPPO',
  'OPBBOOOOOOOOBBPO',
  '.OBBBBBBBBBBBBO.',
  '.OBBBBBBBBBBBBO.',
  'OBBKKBBBBBBKKBBO',
  'OBKKKKBBBBKKKKBO',
  'OBKKWKBBBBKWKKBO',
  'OBBKKBBLLBBKKBBO',
  '.OBBBBLNNLBBBBO.',
  '.OBBBBBLLBBBBBO.',
  '.OBLBBBBBBBBLBO.',
  '..OBLLLLLLLLBO..',
  '...OBBBBBBBBO...',
  '....OOOOOOOO....',
];
const COLORS: Record<string, [number, number, number]> = {
  O: [0x1b, 0x2a, 0x5c],
  B: [0x3f, 0x7f, 0xd9],
  P: [0xb0, 0x46, 0x8f],
  K: [0x15, 0x15, 0x21],
  W: [0xff, 0xff, 0xff],
  L: [0xa9, 0xd3, 0xf5],
  N: [0x15, 0x15, 0x21],
};

function bitmap(scale: number): Buffer {
  const n = 16 * scale;
  const buf = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const c = COLORS[GRID[Math.floor(y / scale)]![Math.floor(x / scale)]!];
      if (!c) continue;
      const i = (y * n + x) * 4;
      buf[i] = c[2]; // BGRA
      buf[i + 1] = c[1];
      buf[i + 2] = c[0];
      buf[i + 3] = 255;
    }
  }
  return buf;
}

export function makeTrayIcon(): Electron.NativeImage {
  const img = nativeImage.createFromBitmap(bitmap(1), { width: 16, height: 16 });
  img.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: bitmap(2) });
  return img;
}

export function buildMenu(): Menu {
  const s = getSettings();
  const char = (id: CharacterId, label: string): MenuItemConstructorOptions => ({
    label,
    type: 'radio',
    checked: s.character === id,
    click: () => updateSettings({ character: id }),
  });
  return Menu.buildFromTemplate([
    { label: 'Character', enabled: false },
    char('stitch', 'Stitch'),
    char('yoda', 'Yoda'),
    { type: 'separator' },
    {
      label: 'Pomodoro',
      submenu: [
        { label: 'Start', click: () => pomodoroCommand('start') },
        { label: 'Pause', click: () => pomodoroCommand('pause') },
        { label: 'Resume', click: () => pomodoroCommand('resume') },
        { label: 'Skip phase', click: () => pomodoroCommand('skip') },
        { label: 'Stop', click: () => pomodoroCommand('stop') },
      ],
    },
    { label: 'Peek mode', type: 'checkbox', checked: isPeeking(), click: togglePeek },
    {
      label: 'Pause reactions',
      type: 'checkbox',
      checked: isReactionsPaused(),
      click: toggleReactionsPaused,
    },
    {
      label: 'Mute',
      type: 'checkbox',
      checked: !s.sound.enabled,
      click: () => updateSettings({ sound: { ...s.sound, enabled: !getSettings().sound.enabled } }),
    },
    {
      label: 'Hide / show companion',
      click: toggleCompanionVisible,
    },
    { type: 'separator' },
    { label: 'Settings…', click: openSettings },
    { label: 'Quit CodeCritter', click: () => app.quit() },
  ]);
}

/** Native popup used by the overlay's right-click (IPC.contextMenu). */
export function popupMenu(): void {
  buildMenu().popup();
}

let tray: Tray | null = null;

export function createTray(): Tray {
  tray = new Tray(makeTrayIcon());
  tray.setToolTip('CodeCritter');
  const refresh = (): void => tray?.setContextMenu(buildMenu());
  refresh();
  onSettingsChanged(refresh);
  onStateChange(refresh);
  tray.on('double-click', openSettings);
  return tray;
}
