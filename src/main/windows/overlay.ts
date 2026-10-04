import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';

export function loadPage(win: BrowserWindow, page: 'overlay' | 'settings'): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void win.loadURL(`${devUrl}/${page}/index.html`);
  else void win.loadFile(join(__dirname, `../renderer/${page}/index.html`));
}

export function createOverlayWindow(scale: number): BrowserWindow {
  const size = 64 * scale + 120;
  const { workArea } = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: size,
    height: size,
    x: workArea.x + workArea.width - size,
    y: workArea.y + workArea.height - size,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/overlay.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload bundles share a chunk (see MEMORY.md)
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.once('ready-to-show', () => win.showInactive());
  loadPage(win, 'overlay');
  return win;
}
