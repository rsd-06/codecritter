// Overlay app entry. All Electron access goes through bridge.ts so this runs in a plain browser too.
import { DEFAULT_SETTINGS } from '@shared/defaults';
import type { CursorSample, OverlayBridge, Settings } from '@shared/types';
import { getBridge } from './bridge';
import { isTauriRuntime } from '../tauri-bridge';
import { createCharacter } from './characters';
import { OverlayDriver } from './behavior/driver';
import { Scheduler } from './engine/scheduler';
import { SoundEngine } from './engine/sound';
import { Stage } from './engine/stage';

export interface OverlayHandle {
  stage: Stage;
  driver: OverlayDriver;
  scheduler: Scheduler;
  sound: SoundEngine;
  /** Re-apply settings (also called for bridge settings events). */
  applySettings(s: Settings): void;
  destroy(): void;
}

export function startOverlay(
  bridge: OverlayBridge = getBridge(),
  opts: { canvas?: HTMLCanvasElement; settings?: Settings } = {},
): OverlayHandle {
  const canvas =
    opts.canvas ??
    (document.getElementById('stage') instanceof HTMLCanvasElement
      ? (document.getElementById('stage') as HTMLCanvasElement)
      : document.body.appendChild(document.createElement('canvas')));

  const initial = opts.settings ?? DEFAULT_SETTINGS;
  const stage = new Stage(canvas, createCharacter(initial.character, initial.palettes[initial.character]), initial.scale);
  const sound = new SoundEngine();
  const driver = new OverlayDriver(stage, sound);
  const scheduler = new Scheduler(driver);
  driver.setWake(() => scheduler.wake());

  let current: Settings = initial;
  const paletteKey = (s: Settings): string => `${s.character}|${JSON.stringify(s.palettes[s.character])}`;
  let lastKey = paletteKey(initial);

  const applySettings = (s: Settings): void => {
    const prev = current;
    current = s;
    const key = paletteKey(s);
    if (s.character !== prev.character) {
      stage.setCharacter(createCharacter(s.character, s.palettes[s.character]));
    } else if (key !== lastKey) {
      stage.char.setPalette(s.palettes[s.character]); // recompiles cached sprites
    }
    lastKey = key;
    if (s.scale !== prev.scale) stage.setScale(s.scale);
    canvas.style.opacity = String(s.opacity);
    sound.configure({ enabled: s.sound.enabled, volume: s.sound.volume, character: s.character });
    driver.applySettings(s);
  };
  applySettings(initial);

  const offs = [
    bridge.onSettings(applySettings),
    bridge.onCursor((c) => {
      driver.handleCursor(c);
      if (tauriHitTest) hitTestFromCursor(c);
    }),
    bridge.onInput((i) => driver.handleInput(i)),
    bridge.onAgent((e) => driver.handleAgent(e)),
    bridge.onReminder((r) => driver.handleReminder(r)),
    bridge.onPomodoro((p) => driver.handlePomodoro(p)),
    bridge.onPeek((p) => driver.handlePeek(p)),
  ];
  void bridge.getSettings().then((s) => applySettings(s)).catch(() => undefined);

  // ---- hit-test driven click-through + drag with mochi squash
  let over = false;
  let dragging = false;
  let last = { x: 0, y: 0 };

  // Tauri: set_ignore_cursor_events(true) swallows pointer moves, so hover is derived from
  // CursorSample (physical screen px + overlay bounds) instead of DOM events. DOM events still
  // work while the window is interactive (drag, right-click, petting).
  const tauriHitTest = isTauriRuntime();
  const hitTestFromCursor = (c: CursorSample): void => {
    if (dragging || c.winW <= 0 || c.winH <= 0) return;
    const cx = ((c.x - c.winX) * window.innerWidth) / c.winW;
    const cy = ((c.y - c.winY) * window.innerHeight) / c.winH;
    setOver(stage.hitTest(cx, cy));
  };

  const setOver = (v: boolean): void => {
    if (v === over) return;
    over = v;
    bridge.setInteractive(v);
  };
  const onMove = (e: PointerEvent): void => {
    if (dragging) {
      const dx = e.screenX - last.x;
      const dy = e.screenY - last.y;
      last = { x: e.screenX, y: e.screenY };
      if (dx || dy) {
        bridge.dragMove(dx, dy);
        driver.dragMove(dx, dy);
      }
      return;
    }
    setOver(stage.hitTest(e.clientX, e.clientY));
  };
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !stage.hitTest(e.clientX, e.clientY)) return;
    if (!current.reactions.drag) return;
    dragging = true;
    last = { x: e.screenX, y: e.screenY };
    canvas.setPointerCapture(e.pointerId);
    bridge.dragStart();
    driver.dragStart();
  };
  const onUp = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    bridge.dragEnd();
    driver.dragEnd();
    setOver(stage.hitTest(e.clientX, e.clientY));
  };
  const onLeave = (): void => {
    if (!dragging) setOver(false);
  };
  const onContext = (e: MouseEvent): void => {
    e.preventDefault();
    if (stage.hitTest(e.clientX, e.clientY)) bridge.showContextMenu();
  };
  document.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  document.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('contextmenu', onContext);

  scheduler.start();

  return {
    stage,
    driver,
    scheduler,
    sound,
    applySettings,
    destroy() {
      scheduler.stop();
      sound.dispose();
      offs.forEach((off) => off());
      document.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      document.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('contextmenu', onContext);
    },
  };
}

// Only auto-start inside the real overlay window (the playground calls startOverlay itself).
if (typeof window !== 'undefined' && isTauriRuntime()) {
  startOverlay(getBridge());
}
