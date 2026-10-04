import { PEEK_VISIBLE_FRACTION } from '../../shared/constants';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type PeekEdge = 'left' | 'right' | 'bottom';

/** Fraction of the stage that stays visible while peeking (shared with the renderer). */
export const PEEK_VISIBLE = PEEK_VISIBLE_FRACTION;

/**
 * Where to put the overlay so only the top PEEK_VISIBLE of the stage shows at `edge` of `display`.
 * bottom: slide down (top PEEK_VISIBLE visible). left/right: slide sideways (the PEEK_VISIBLE share nearest the
 * screen interior stays visible). x/y are kept inside the display on the other axis.
 */
export function peekRect(win: Rect, display: Rect, edge: PeekEdge, visible = PEEK_VISIBLE): Rect {
  const clampX = (x: number): number =>
    Math.min(Math.max(x, display.x), display.x + display.width - win.width);
  const clampY = (y: number): number =>
    Math.min(Math.max(y, display.y), display.y + display.height - win.height);
  if (edge === 'bottom') {
    return {
      ...win,
      x: Math.round(clampX(win.x)),
      y: Math.round(display.y + display.height - win.height * visible),
    };
  }
  const shown = win.width * visible;
  return {
    ...win,
    y: Math.round(clampY(win.y)),
    x: Math.round(
      edge === 'left' ? display.x - (win.width - shown) : display.x + display.width - shown,
    ),
  };
}

/** Foreground window covers the whole display (borderless/exclusive fullscreen). */
export function isFullscreenOn(bounds: Rect, display: Rect, tol = 2): boolean {
  return (
    bounds.x <= display.x + tol &&
    bounds.y <= display.y + tol &&
    bounds.x + bounds.width >= display.x + display.width - tol &&
    bounds.y + bounds.height >= display.y + display.height - tol
  );
}

/** Shell windows (desktop, taskbar) that cover the screen but are not fullscreen apps. */
const SHELL =
  /^(explorer(\.exe)?|searchhost|shellexperiencehost|startmenuexperiencehost|finder|dock|windowserver|gnome-shell|plasmashell)$/i;
export function isShellOwner(name: string | undefined): boolean {
  return !!name && SHELL.test(name);
}
