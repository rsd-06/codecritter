/** Pure window-geometry helpers (no electron import so they are unit-testable). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Clamp a window rect fully inside `area`. */
export function clampRect(r: Rect, area: Rect): Rect {
  const x = Math.min(Math.max(r.x, area.x), area.x + Math.max(0, area.width - r.width));
  const y = Math.min(Math.max(r.y, area.y), area.y + Math.max(0, area.height - r.height));
  return { x: Math.round(x), y: Math.round(y), width: r.width, height: r.height };
}

/** Horizontal gap kept free right of the overlay: Windows leaves room for the tray clock. */
export function defaultMargin(platform: string): number {
  return platform === 'win32' ? 260 : 24;
}

/** Default spot: bottom of the work area, left of the tray on Windows, right edge elsewhere. */
export function defaultRectFor(
  workArea: Rect,
  size: { width: number; height: number },
  platform: string = process.platform,
): Rect {
  return clampRect(
    {
      x: workArea.x + workArea.width - size.width - defaultMargin(platform),
      y: workArea.y + workArea.height - size.height,
      width: size.width,
      height: size.height,
    },
    workArea,
  );
}
