import { BrowserWindow, screen, type Rectangle } from 'electron';
import { join } from 'node:path';
import type { Settings } from '../../shared/types';
import { lockNavigation } from './links';
import { clampRect, defaultRectFor } from './geometry';
import { getSettings, onSettingsChanged, updateSettings } from '../store';

/** Logical stage (agent A's renderer uses 128x112 px per scale unit). */
export const STAGE_W = 128;
export const STAGE_H = 112;

let win: BrowserWindow | null = null;
let userHidden = false;
let peekLocked = false;
let drag: { cursor: { x: number; y: number }; origin: { x: number; y: number } } | null = null;

export function loadPage(w: BrowserWindow, page: 'overlay' | 'settings'): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void w.loadURL(`${devUrl}/${page}/index.html`);
  else void w.loadFile(join(__dirname, `../renderer/${page}/index.html`));
}

export function getOverlayWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

/** Send a message to the overlay renderer only. Safe to call at any time. */
export function broadcast(channel: string, payload: unknown): void {
  const w = getOverlayWindow();
  if (w && !w.webContents.isDestroyed()) w.webContents.send(channel, payload);
}

export function overlayVisible(): boolean {
  return !!getOverlayWindow()?.isVisible();
}

export function overlaySize(scale: number): { width: number; height: number } {
  return { width: Math.round(STAGE_W * scale), height: Math.round(STAGE_H * scale) };
}

export { clampRect };

function defaultRect(scale: number): Rectangle {
  return defaultRectFor(screen.getPrimaryDisplay().workArea, overlaySize(scale));
}

function restoredRect(s: Settings): Rectangle {
  const { width, height } = overlaySize(s.scale);
  const pos = s.position;
  if (!pos) return defaultRect(s.scale);
  const display = screen.getAllDisplays().find((d) => d.id === pos.displayId);
  if (!display) return defaultRect(s.scale);
  return clampRect({ x: pos.x, y: pos.y, width, height }, display.workArea);
}

function persistPosition(): void {
  const w = getOverlayWindow();
  if (!w || peekLocked) return;
  const b = w.getBounds();
  const displayId = screen.getDisplayMatching(b).id;
  const cur = getSettings().position;
  if (cur && cur.displayId === displayId && cur.x === b.x && cur.y === b.y) return;
  updateSettings({ position: { displayId, x: b.x, y: b.y } });
}

function applyBounds(r: Rectangle): void {
  getOverlayWindow()?.setBounds(r, false);
}

/** Re-clamp into the work area of whichever display the window is on. */
function reclamp(): void {
  const w = getOverlayWindow();
  if (!w || peekLocked) return;
  const b = w.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  const next = clampRect(b, area);
  if (next.x !== b.x || next.y !== b.y) {
    applyBounds(next);
    persistPosition();
  }
}

function applyScale(scale: number): void {
  const w = getOverlayWindow();
  if (!w) return;
  const b = w.getBounds();
  const { width, height } = overlaySize(scale);
  // keep bottom-centre anchored
  const next = {
    x: Math.round(b.x + (b.width - width) / 2),
    y: b.y + b.height - height,
    width,
    height,
  };
  applyBounds(clampRect(next, screen.getDisplayMatching(b).workArea));
  persistPosition();
}

export function createOverlayWindow(): BrowserWindow {
  const s = getSettings();
  const r = restoredRect(s);
  win = new BrowserWindow({
    ...r,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false, // we move it ourselves
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/overlay.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  lockNavigation(win.webContents);
  win.setAlwaysOnTop(true, 'screen-saver');
  if (process.platform === 'darwin')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setOpacity(s.opacity);
  win.once('ready-to-show', () => {
    if (!userHidden) win?.showInactive();
  });
  win.on('closed', () => {
    win = null;
  });
  loadPage(win, 'overlay');

  screen.on('display-removed', () => {
    const w = getOverlayWindow();
    if (!w) return;
    const b = w.getBounds();
    const stillOn = screen.getAllDisplays().some((d) => {
      const a = d.bounds;
      return (
        b.x + b.width / 2 >= a.x &&
        b.x + b.width / 2 < a.x + a.width &&
        b.y + b.height / 2 >= a.y &&
        b.y + b.height / 2 < a.y + a.height
      );
    });
    if (!stillOn) {
      applyBounds(defaultRect(getSettings().scale));
      persistPosition();
    } else reclamp();
  });
  screen.on('display-metrics-changed', reclamp);

  onSettingsChanged((next, prev) => {
    if (next.scale !== prev.scale) applyScale(next.scale);
    if (next.opacity !== prev.opacity) getOverlayWindow()?.setOpacity(next.opacity);
  });
  return win;
}

/**
 * Peek: move the window (partly off-screen) without clamping/persisting. `rect` null restores
 * `restore` (the pre-peek bounds, clamped to its display).
 */
export function setPeekBounds(rect: Rectangle | null, restore?: Rectangle): void {
  const w = getOverlayWindow();
  if (!w) return;
  if (rect) {
    peekLocked = true;
    w.setBounds(rect, false);
    return;
  }
  peekLocked = false;
  if (restore) {
    const { width, height } = overlaySize(getSettings().scale);
    const target = { ...restore, width, height };
    w.setBounds(clampRect(target, screen.getDisplayMatching(restore).workArea), false);
  }
}

/* ---- IPC-facing controls ---- */

export function setInteractive(on: boolean): void {
  const w = getOverlayWindow();
  if (!w) return;
  if (on) w.setIgnoreMouseEvents(false);
  else w.setIgnoreMouseEvents(true, { forward: true });
}

export function dragStart(): void {
  const w = getOverlayWindow();
  if (!w) return;
  const b = w.getBounds();
  drag = { cursor: screen.getCursorScreenPoint(), origin: { x: b.x, y: b.y } };
}

/** dx/dy from the renderer are ignored on purpose: screen-cursor delta is jitter-free. */
export function dragMove(): void {
  const w = getOverlayWindow();
  if (!w || !drag) return;
  const c = screen.getCursorScreenPoint();
  const { width, height } = w.getBounds();
  const target = {
    x: drag.origin.x + (c.x - drag.cursor.x),
    y: drag.origin.y + (c.y - drag.cursor.y),
    width,
    height,
  };
  applyBounds(clampRect(target, screen.getDisplayNearestPoint(c).workArea));
}

export function dragEnd(): void {
  if (!drag) return;
  drag = null;
  persistPosition();
}

export function setCompanionVisible(visible: boolean): void {
  userHidden = !visible;
  const w = getOverlayWindow();
  if (!w) return;
  if (visible) w.showInactive();
  else w.hide();
}

export function toggleCompanionVisible(): void {
  setCompanionVisible(!!userHidden);
}

export function isCompanionHidden(): boolean {
  return userHidden;
}
