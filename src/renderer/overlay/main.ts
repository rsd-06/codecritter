// Placeholder overlay app (P1-A replaces this with the character engine).
export function startOverlay(canvas: HTMLCanvasElement, scale = 2): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  canvas.style.width = `${64 * scale}px`;
  canvas.style.height = `${64 * scale}px`;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#3f7fd9';
  ctx.fillRect(16, 20, 32, 32);
  ctx.fillStyle = '#a9d3f5';
  ctx.fillRect(22, 36, 20, 14);
  ctx.fillStyle = '#151521';
  ctx.fillRect(22, 26, 6, 6);
  ctx.fillRect(36, 26, 6, 6);
}

// Only auto-start inside the real overlay window (the playground calls startOverlay itself).
if (window.critter) {
  const canvas = document.getElementById('stage');
  if (canvas instanceof HTMLCanvasElement) startOverlay(canvas);
}
