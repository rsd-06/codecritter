// Capture page for the landing-site feature clips (see tools/clips/record.mjs).
//
// Every clip runs the REAL overlay engine (Stage + OverlayDriver + Brain) on a manual clock: no
// timers, no rAF, a seeded rng, so every run renders the same frames. Each clip is a small script that
// feeds the engine the same synthetic samples the desktop app gets from the OS (CursorSample,
// InputSample, AgentEvent, ReminderEvent, PomodoroState, peek, drag) while we draw an original pixel
// desktop behind it. The scenario is looped: it runs for two warm-up passes first and the third pass is
// recorded, so the last frame flows straight into the first (seamless loop).
import { DEFAULT_PALETTES, DEFAULT_SETTINGS } from '@shared/defaults';
import type { CharacterId, Palette, Settings } from '@shared/types';
import { OverlayDriver } from '../../src/renderer/overlay/behavior/driver';
import { createCharacter } from '../../src/renderer/overlay/characters';
import { drawText, textWidth } from '../../src/renderer/overlay/engine/font';
import { Stage } from '../../src/renderer/overlay/engine/stage';
import { STAGE_H, STAGE_W } from '../../src/renderer/overlay/engine/types';

/* ------------------------------------------------------------------ constants & helpers ---- */

const K = 4; // scene pixel = 4 output px (same grid as the hero critter at 4x)
const W = 512;
const H = 512;
const FPS = 24;
const DT = 1 / FPS;
const EPOCH = Date.UTC(2026, 9, 5, 9, 41, 0);
const TASKBAR_Y = 120; // logical (scene is 128x128 logical = 512x512 px)
const BASE_SCALE = 4;

type Ctx = CanvasRenderingContext2D;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rect = (g: Ctx, x: number, y: number, w: number, h: number, c: string): void => {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
};
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const clamp01 = (u: number): number => Math.max(0, Math.min(1, u));
const smooth = (u: number): number => {
  const c = clamp01(u);
  return c * c * (3 - 2 * c);
};

type KF = [t: number, x: number, y: number, ease?: 'l' | 's'];
/** Piecewise path through keyframes; segments ease unless the keyframe says 'l' (linear). */
function path(kfs: KF[], s: number): { x: number; y: number } {
  const first = kfs[0]!;
  const last = kfs[kfs.length - 1]!;
  if (s <= first[0]) return { x: first[1], y: first[2] };
  if (s >= last[0]) return { x: last[1], y: last[2] };
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]!;
    const b = kfs[i + 1]!;
    if (s >= a[0] && s < b[0]) {
      const u = (s - a[0]) / (b[0] - a[0]);
      const e = a[3] === 'l' ? u : smooth(u);
      return { x: lerp(a[1], b[1], e), y: lerp(a[2], b[2], e) };
    }
  }
  return { x: last[1], y: last[2] };
}

function layer(draw: (g: Ctx) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.setTransform(K, 0, 0, K, 0, 0);
  draw(g);
  return c;
}

/* ------------------------------------------------------------------ palette of the fake desktop ---- */

const C = {
  ink: '#0a0e24',
  panel: '#1a2048',
  panel2: '#12162f',
  bar: '#2d3563',
  line: '#3a4480',
  dim: '#6a76b8',
  text: '#dfe6ff',
  pink: '#ff8ac0',
  gold: '#ffd98a',
  mint: '#6ee7c8',
  cyan: '#8de6ff',
  red: '#ff6b8a',
  green: '#9dffb4',
};

/* ------------------------------------------------------------------ static pixel backdrops ---- */

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Vertical gradient with ordered dithering between the stops (pixel-art "soft wallpaper"). */
function gradient(g: Ctx, y0: number, y1: number, stops: string[]): void {
  const n = y1 - y0;
  for (let y = 0; y < n; y++) {
    const pos = (y / n) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(pos));
    const f = pos - i;
    for (let x = 0; x < 128; x++) {
      const thr = (BAYER[y & 3]![x & 3]! + 0.5) / 16;
      g.fillStyle = f > thr ? stops[i + 1]! : stops[i]!;
      g.fillRect(x, y0 + y, 1, 1);
    }
  }
}

function wallpaper(stops: string[], hills: [string, string], seed: number, moon = true): HTMLCanvasElement {
  return layer((g) => {
    const rng = mulberry32(seed);
    gradient(g, 0, TASKBAR_Y, stops);
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(rng() * 128);
      const y = Math.floor(rng() * 70);
      rect(g, x, y, 1, 1, rng() < 0.3 ? '#ffffff' : '#9aa4e8');
    }
    if (moon) {
      const cx = 104;
      const cy = 30;
      for (let j = -8; j <= 8; j++)
        for (let i = -8; i <= 8; i++) if (i * i + j * j <= 64) rect(g, cx + i, cy + j, 1, 1, '#fff3d6');
      for (let j = -8; j <= 8; j++)
        for (let i = -8; i <= 8; i++) if (i * i + j * j <= 64 && (i + 3) * (i + 3) + (j - 2) * (j - 2) <= 36) rect(g, cx + i, cy + j, 1, 1, '#f5dca8');
    }
    for (let x = 0; x < 128; x++) {
      const hy = Math.round(112 + Math.sin(x / 19) * 5 + Math.sin(x / 7.3) * 2);
      rect(g, x, hy, 1, TASKBAR_Y - hy, hills[0]);
      const hy2 = Math.round(128 + Math.sin(x / 13 + 2) * 4 + Math.sin(x / 5) * 1.5);
      rect(g, x, hy2, 1, TASKBAR_Y - hy2, hills[1]);
    }
  });
}

const WALLPAPERS = {
  dusk: () => wallpaper(['#0c1230', '#1c2060', '#3b2a80', '#7a3d96', '#c95a9a', '#f2a07b'], ['#141a4a', '#0e1238'], 7),
  teal: () => wallpaper(['#07182b', '#0b3550', '#126b78', '#2fa59a', '#8fe0b8', '#e8f6c8'], ['#0c3a4a', '#08293a'], 11),
  plum: () => wallpaper(['#150a2e', '#32155e', '#6a2a8a', '#b04a98', '#f0788a', '#ffc58a'], ['#2a1450', '#1c0c3a'], 19),
};

function taskbarBase(g: Ctx): void {
  rect(g, 0, TASKBAR_Y, 128, 8, C.ink);
  rect(g, 0, TASKBAR_Y, 128, 1, C.line);
  rect(g, 3, TASKBAR_Y + 2, 5, 5, C.mint);
  rect(g, 4, TASKBAR_Y + 3, 3, 3, C.ink);
  const apps = [C.pink, C.gold, C.cyan, C.green];
  apps.forEach((c, i) => {
    rect(g, 14 + i * 8, TASKBAR_Y + 2, 5, 5, C.bar);
    rect(g, 15 + i * 8, TASKBAR_Y + 3, 3, 3, c);
  });
  rect(g, 104, TASKBAR_Y + 3, 2, 3, C.dim);
  rect(g, 107, TASKBAR_Y + 3, 2, 3, C.dim);
}

function clock(g: Ctx, minutes: number): void {
  const m = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  const text = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  rect(g, 90, TASKBAR_Y + 1, 37, 7, C.ink);
  drawText(g, text, 111, TASKBAR_Y + 2, C.text);
}

const taskbarLayer = (): HTMLCanvasElement => layer(taskbarBase);

function windowFrame(g: Ctx, x: number, y: number, w: number, h: number, title: string, body = C.panel): void {
  rect(g, x - 1, y - 1, w + 2, h + 2, C.ink);
  rect(g, x, y, w, 7, C.bar);
  rect(g, x + 2, y + 2, 3, 3, C.red);
  rect(g, x + 6, y + 2, 3, 3, C.gold);
  rect(g, x + 10, y + 2, 3, 3, C.mint);
  drawText(g, title, x + 17, y + 1, '#a9b4f0');
  rect(g, x, y + 7, w, h - 7, body);
}

/** Filler "file manager" window made of bars. */
function barsWindow(g: Ctx, x: number, y: number, w: number, h: number, title: string, accent: string): void {
  windowFrame(g, x, y, w, h, title);
  rect(g, x, y + 7, 14, h - 7, C.panel2);
  for (let i = 0; i < Math.floor((h - 14) / 6); i++) {
    rect(g, x + 3, y + 11 + i * 6, 8, 2, i % 3 === 0 ? accent : C.line);
    rect(g, x + 18, y + 11 + i * 6, 12 + ((i * 17) % 26), 2, i % 2 ? C.line : C.dim);
  }
}

/* ------------------------------------------------------------------ code / terminal drawing ---- */

const TOKEN_RE = /(\/\/.*)|('[^']*')|\b(const|let|new|await|function|return|if|async)\b|\b(\d+)\b|([A-Za-z_]\w*)(?=[(.])|(\w+)|(.)/g;

function colorize(line: string): { text: string; color: string }[] {
  const out: { text: string; color: string }[] = [];
  for (const m of line.matchAll(TOKEN_RE)) {
    const color = m[1] ? C.dim : m[2] ? C.gold : m[3] ? C.pink : m[4] ? C.green : m[5] ? C.cyan : m[6] ? C.text : '#8892c8';
    out.push({ text: m[0], color });
  }
  return out;
}

/** Draws `count` characters of the code; returns the caret position. */
function drawCode(g: Ctx, lines: string[], count: number, x: number, y: number): { x: number; y: number } {
  let left = count;
  let caret = { x, y };
  for (let i = 0; i < lines.length; i++) {
    const ly = y + i * 8;
    let cx = x;
    caret = { x: cx, y: ly };
    for (const tok of colorize(lines[i]!)) {
      if (left <= 0) break;
      const n = Math.min(left, tok.text.length);
      drawText(g, tok.text, cx, ly, tok.color, n);
      cx += textWidth(tok.text.slice(0, n)) + 1;
      left -= n;
      caret = { x: cx, y: ly };
    }
    if (left <= 0) break;
  }
  return caret;
}

function editor(g: Ctx, title: string, nLines: number): void {
  windowFrame(g, 8, 6, 112, 62, title, C.panel2);
  rect(g, 8, 13, 13, 55, C.panel);
  for (let i = 0; i < nLines; i++) drawText(g, String(i + 1), 11, 16 + i * 8, C.line);
}

/* ------------------------------------------------------------------ cursor sprites ---- */

const ARROW = [
  'X...........',
  'XX..........',
  'X#X.........',
  'X##X........',
  'X###X.......',
  'X####X......',
  'X#####X.....',
  'X######X....',
  'X#######X...',
  'X########X..',
  'X#####XXXXX.',
  'X##X##X.....',
  'X#X.X##X....',
  'XX..X##X....',
  'X....X##X...',
  '.....XXXX...',
];
const HAND = [
  '...XX.XX.XX...',
  '..X##X##X##X..',
  '..X########XX.',
  '.XX#########X.',
  'X##X########X.',
  'X###########X.',
  '.X##########X.',
  '.X#########X..',
  '..X########X..',
  '..XX######XX..',
  '...XXXXXXXX...',
];

function drawSprite(g: Ctx, sprite: string[], x: number, y: number, hx: number, hy: number, px: number): void {
  const x0 = Math.round(x - hx * px);
  const y0 = Math.round(y - hy * px);
  sprite.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === 'X') rect(g, x0 + i * px, y0 + j * px, px, px, '#0a0e24');
      else if (ch === '#') rect(g, x0 + i * px, y0 + j * px, px, px, '#ffffff');
    }
  });
}

/* ------------------------------------------------------------------ the rig (engine on a manual clock) ---- */

interface Rig {
  t: number;
  stage: Stage;
  driver: OverlayDriver;
  settings: Settings;
  scale: number;
  win: { x: number; y: number };
  base: { x: number; y: number };
  /** head centre in scene px at the base pose */
  head: { x: number; y: number };
  cursor: { x: number; y: number; kind: 'arrow' | 'hand'; visible: boolean; feed: boolean };
  /** per-clip scratch */
  mem: Record<string, number>;
}

const SOUND = { speak() {}, jingle() {}, alert() {}, purr() {}, blip() {} };

function winFor(scale: number): { x: number; y: number } {
  return { x: (W - STAGE_W * scale) / 2, y: TASKBAR_Y * K - STAGE_H * scale };
}

function makeRig(character: CharacterId, seed: number, patch: Partial<Settings> = {}): Rig {
  const settings: Settings = structuredClone(DEFAULT_SETTINGS);
  Object.assign(settings, patch);
  settings.character = character;
  settings.scale = BASE_SCALE;
  settings.sound = { enabled: false, volume: 0 };
  const canvas = document.createElement('canvas');
  const stage = new Stage(canvas, createCharacter(character, settings.palettes[character]), BASE_SCALE);
  const rng = mulberry32(seed);
  const rig: Rig = {
    t: 1000,
    stage,
    driver: null as unknown as OverlayDriver,
    settings,
    scale: BASE_SCALE,
    win: winFor(BASE_SCALE),
    base: winFor(BASE_SCALE),
    head: { x: 0, y: 0 },
    cursor: { x: 440, y: 150, kind: 'arrow', visible: false, feed: true },
    mem: {},
  };
  rig.driver = new OverlayDriver(stage, SOUND as never, {
    now: () => rig.t,
    epoch: () => EPOCH + rig.t * 1000,
    hour: () => 14,
    rng,
    settings,
  });
  rig.driver.applySettings(settings);
  const h = stage.head;
  rig.head = { x: rig.win.x + h.x * BASE_SCALE, y: rig.win.y + h.y * BASE_SCALE };
  return rig;
}

function feedCursor(rig: Rig): void {
  const c = rig.cursor;
  if (!c.visible || !c.feed) return;
  rig.driver.handleCursor({
    x: c.x,
    y: c.y,
    winX: rig.win.x,
    winY: rig.win.y,
    winW: STAGE_W * rig.scale,
    winH: STAGE_H * rig.scale,
  });
}

function setLook(rig: Rig, id: CharacterId, palette: Palette, scale: number): void {
  const prev = rig.stage.char.id;
  rig.settings = { ...rig.settings, character: id, palettes: { ...rig.settings.palettes, [id]: palette }, scale: scale as 1 | 2 | 3 | 4 };
  if (id !== prev) rig.stage.setCharacter(createCharacter(id, palette));
  else rig.stage.char.setPalette(palette);
  if (scale !== rig.scale) {
    rig.stage.setScale(scale);
    rig.scale = scale;
    rig.win = winFor(scale);
    rig.base = winFor(scale);
  }
  rig.driver.applySettings(rig.settings);
}

/* ------------------------------------------------------------------ clip definition ---- */

interface ClipDef {
  id: string;
  title: string;
  seconds: number;
  character: CharacterId;
  seed: number;
  /** poster frame time (s) */
  poster: number;
  /** keep the engine out of bored/sleep (heartbeat input samples) */
  heartbeat?: boolean;
  patch?: Partial<Settings>;
  setup?(rig: Rig): void;
  /** feed the engine for local time s (prev = previous frame's s) */
  script(rig: Rig, s: number, prev: number): void;
  /** background drawn before the stage (identity transform) */
  back(g: Ctx, rig: Rig, s: number): void;
  /** optional drawing above the stage and below the cursor */
  front?(g: Ctx, rig: Rig, s: number): void;
}

const crossed = (t: number, s: number, prev: number): boolean => t > prev + 1e-9 && t <= s + 1e-9;
const every = (period: number, s: number, prev: number): boolean => Math.floor(s / period + 1e-9) !== Math.floor(prev / period + 1e-9);

const input = (rig: Rig, o: Partial<{ keysPerSec: number; keyBurst: boolean; idleMs: number; scrollDelta: number; mouseSpeed: number }>): void =>
  rig.driver.handleInput({ keysPerSec: 0, keyBurst: false, scrollDelta: 0, mouseSpeed: 0, idleMs: 200, ...o });

const cache = new Map<string, HTMLCanvasElement>();
const cached = (key: string, make: () => HTMLCanvasElement): HTMLCanvasElement => {
  let c = cache.get(key);
  if (!c) {
    c = make();
    cache.set(key, c);
  }
  return c;
};
const blit = (g: Ctx, c: HTMLCanvasElement): void => {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(c, 0, 0);
  g.setTransform(K, 0, 0, K, 0, 0);
};

/* ----- 01 eye follow */
const EYE_KF: KF[] = (() => {
  const kfs: KF[] = [[0, 440, 150, 's']];
  // ellipse around the face, clockwise, 1.1 turns
  const cx = 256;
  const cy = 345;
  const a0 = -0.55;
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const a = a0 + (i / n) * Math.PI * 2.2;
    kfs.push([0.5 + (i / n) * 2.2, cx + Math.cos(a) * 195, cy + Math.sin(a) * 140, i === n ? 's' : 'l']);
  }
  kfs.push([3.0, 50, 70, 's']);
  kfs.push([3.55, 470, 420, 's']);
  kfs.push([4.1, 262, 350, 's']); // over the face
  kfs.push([4.5, 215, 328, 's']);
  kfs.push([4.9, 300, 378, 's']);
  kfs.push([5.5, 440, 150, 's']);
  return kfs;
})();

const eyeFollow: ClipDef = {
  id: 'eye-follow',
  title: 'Eye follow',
  seconds: 5.5,
  character: 'stitch',
  seed: 101,
  poster: 1.2,
  heartbeat: true,
  script(rig, s) {
    const p = path(EYE_KF, s);
    Object.assign(rig.cursor, { x: p.x, y: p.y, kind: 'arrow', visible: true });
  },
  back(g) {
    blit(g, cached('dusk', WALLPAPERS.dusk));
    g.setTransform(K, 0, 0, K, 0, 0);
    barsWindow(g, 5, 8, 46, 36, 'files', C.mint);
    barsWindow(g, 80, 20, 44, 34, 'notes', C.pink);
    blit(g, cached('taskbar', taskbarLayer));
    clock(g, 9 * 60 + 41);
  },
};

/* ----- 02 mochi drag */
const dragClip: ClipDef = {
  id: 'mochi-drag',
  title: 'Mochi drag',
  seconds: 5.3,
  character: 'yoda',
  seed: 202,
  poster: 2.2,
  heartbeat: true,
  setup(rig) {
    rig.mem.px = rig.win.x;
    rig.mem.py = rig.win.y;
  },
  script(rig, s, prev) {
    const grab = { x: rig.base.x + 256, y: rig.base.y + 372 };
    // window offset while dragged
    let dx = 0;
    let dy = 0;
    if (s >= 0.5 && s < 1.0) dy = -120 * smooth((s - 0.5) / 0.5);
    else if (s >= 1.0 && s < 3.6) {
      const env = Math.min(1, (3.6 - s) / 0.3);
      dx = 46 * Math.sin(2 * Math.PI * 2.7 * (s - 1.0)) * env;
      dy = -120 + 5 * Math.sin(2 * Math.PI * 1.3 * (s - 1.0));
    } else if (s >= 3.6 && s < 4.1) dy = -120 * (1 - smooth((s - 3.6) / 0.5));
    const px = rig.base.x + dx;
    const py = rig.base.y + dy;
    const dragging = s >= 0.5 && s < 4.1;
    if (crossed(0.5, s, prev)) rig.driver.dragStart();
    const nx = Math.round(px);
    const ny = Math.round(py);
    if (dragging) {
      const mx = nx - rig.win.x;
      const my = ny - rig.win.y;
      if (mx || my) rig.driver.dragMove(mx, my);
    }
    if (crossed(4.1, s, prev)) rig.driver.dragEnd();
    rig.win = { x: nx, y: ny };
    // cursor: arrives, grabs (hand), lets go and leaves
    if (s < 0.5) {
      const p = path([[0, 440, 200], [0.5, grab.x, grab.y]], s);
      Object.assign(rig.cursor, { x: p.x, y: p.y, kind: 'arrow', visible: true, feed: true });
    } else if (dragging) {
      Object.assign(rig.cursor, { x: grab.x + (px - rig.base.x), y: grab.y + (py - rig.base.y), kind: 'hand', visible: true, feed: false });
    } else {
      const p = path([[4.1, grab.x, grab.y], [4.45, grab.x + 20, grab.y - 10], [5.3, 440, 200]], s);
      Object.assign(rig.cursor, { x: p.x, y: p.y, kind: 'arrow', visible: true, feed: true });
    }
  },
  back(g) {
    blit(g, cached('plum', WALLPAPERS.plum));
    g.setTransform(K, 0, 0, K, 0, 0);
    barsWindow(g, 72, 10, 50, 38, 'photos', C.gold);
    barsWindow(g, 5, 22, 40, 32, 'music', C.cyan);
    blit(g, cached('taskbar', taskbarLayer));
    clock(g, 9 * 60 + 41);
  },
};

/* ----- 03 typing & overheat */
const CODE = [
  'const pet = new Pet();',
  "pet.on('keys', n => {",
  '  paws.knead(n);',
  '  heat += n / 8;',
  '});',
  'await pet.ready();',
];
const CODE_LEN = CODE.join('').length;
const typedChars = (s: number): number => {
  if (s < 0.2) return 0;
  if (s < 0.7) return (s - 0.2) * 8;
  return Math.min(CODE_LEN, 4 + (Math.min(s, 3.9) - 0.7) * 29);
};

const typing: ClipDef = {
  id: 'typing-overheat',
  title: 'Typing and overheat',
  seconds: 6.2,
  character: 'stitch',
  seed: 303,
  poster: 4.9,
  heartbeat: false,
  script(rig, s, prev) {
    rig.cursor.visible = false;
    if (every(0.1, s, prev)) {
      if (s >= 0.2 && s < 0.7) input(rig, { keysPerSec: 5, keyBurst: true, idleMs: 0 });
      else if (s >= 0.7 && s < 3.95) input(rig, { keysPerSec: 11, keyBurst: true, idleMs: 0 });
      else if (s < 0.2 || s >= 4.2) input(rig, { idleMs: 3000 });
    }
  },
  back(g, _rig, s) {
    blit(g, cached('teal', WALLPAPERS.teal));
    g.setTransform(K, 0, 0, K, 0, 0);
    editor(g, 'critter.ts', CODE.length);
    const n = Math.floor(typedChars(s));
    const caret = drawCode(g, CODE, n, 24, 16);
    if (Math.floor(s * 4) % 2 === 0 || n < CODE_LEN) rect(g, caret.x, caret.y, 2, 5, '#ffffff');
    blit(g, cached('taskbar', taskbarLayer));
    clock(g, 9 * 60 + 41);
  },
};

/* ----- 04 petting */
const petting: ClipDef = {
  id: 'petting',
  title: 'Petting',
  seconds: 5.5,
  character: 'yoda',
  seed: 404,
  poster: 2.6,
  heartbeat: true,
  script(rig, s) {
    const hx = rig.head.x;
    const hy = rig.head.y;
    let p: { x: number; y: number };
    if (s < 0.8) p = path([[0, 440, 150], [0.8, hx + 30, hy - 50]], s);
    else if (s < 2.9) {
      const u = s - 0.8;
      p = { x: hx + 46 * Math.sin(2 * Math.PI * 2.4 * u) * Math.min(1, u / 0.15), y: hy - 52 + 6 * Math.sin(2 * Math.PI * 1.2 * u) };
    } else p = path([[2.9, hx, hy - 52], [3.9, 440, 150]], s);
    Object.assign(rig.cursor, { x: p.x, y: p.y, kind: 'arrow', visible: true });
  },
  back(g) {
    blit(g, cached('dusk', WALLPAPERS.dusk));
    g.setTransform(K, 0, 0, K, 0, 0);
    barsWindow(g, 4, 14, 44, 36, 'docs', C.pink);
    barsWindow(g, 80, 8, 44, 32, 'mail', C.mint);
    blit(g, cached('taskbar', taskbarLayer));
    clock(g, 9 * 60 + 41);
  },
};

/* ----- 05 AI agent */
interface TermLine {
  at: number;
  until?: number;
  text: string;
  color: string;
}
const TERM: TermLine[] = [
  { at: 0, text: '$ claude', color: C.green },
  { at: 0, text: '> fix the failing test', color: C.text },
  { at: 0.3, until: 2.5, text: '* Thinking...', color: C.gold },
  { at: 1.1, text: 'Bash(npm test)', color: C.cyan },
  { at: 1.7, text: 'Edit(src/api.ts)', color: C.cyan },
  { at: 2.1, text: 'Bash(npm test)', color: C.cyan },
  { at: 2.5, text: '  14 passed', color: C.green },
];

const agent: ClipDef = {
  id: 'ai-agent',
  title: 'AI agent',
  seconds: 6,
  character: 'stitch',
  seed: 505,
  poster: 2.9,
  heartbeat: true,
  script(rig, s, prev) {
    rig.cursor.visible = false;
    const ev = (type: 'thinking' | 'tool' | 'done', message?: string): void =>
      rig.driver.handleAgent({ agent: 'claude-code', type, message, session: 'clip', ts: Date.now() });
    if (crossed(0.3, s, prev)) ev('thinking');
    if (crossed(1.1, s, prev)) ev('tool');
    if (crossed(1.7, s, prev)) ev('tool');
    if (crossed(2.5, s, prev)) ev('done', 'Fixed it. 14 tests pass');
  },
  back(g, _rig, s) {
    blit(g, cached('plum', WALLPAPERS.plum));
    g.setTransform(K, 0, 0, K, 0, 0);
    windowFrame(g, 8, 4, 112, 68, 'claude - ~/api', '#0b0e1c');
    let y = 14;
    // before the new prompt starts (s < 0.3) the screen still shows the previous run: the loop seam is invisible
    const ts = s < 0.3 ? 99 : s;
    for (const l of TERM) {
      if (ts < l.at || (l.until !== undefined && ts >= l.until)) continue;
      const text = l.text.startsWith('* ') ? `${['*', '+'][Math.floor(s * 6) % 2]} ${l.text.slice(2)}` : l.text;
      drawText(g, text, 13, y, l.color);
      y += 8;
    }
    blit(g, cached('taskbar', taskbarLayer));
    clock(g, 9 * 60 + 41);
  },
};

/* ----- 06 idle, sleep, wake (fast-forwarded) */
const idleSeconds = (s: number): number => {
  if (s < 0.6) return 0;
  if (s < 1.6) return ((s - 0.6) / 1.0) * 140;
  if (s < 2.6) return 140 + ((s - 1.6) / 1.0) * 190;
  if (s < 4.8) return 330 + (s - 2.6) * 60;
  return 0;
};

const sleepClip: ClipDef = {
  id: 'idle-sleep-wake',
  title: 'Idle, sleep, wake',
  seconds: 6.2,
  character: 'yoda',
  seed: 606,
  poster: 3.6,
  heartbeat: false,
  script(rig, s, prev) {
    const ff = s >= 0.6 && s < 2.6;
    rig.mem.clock = (rig.mem.clock ?? 0) + (ff ? DT * 7 : 0);
    if (crossed(0, s, prev)) rig.mem.clock = 0;
    // one input sample per frame; the virtual idle time is what the OS would report
    input(rig, { idleMs: idleSeconds(s) * 1000 });
    // fast-forward the engine clock while asleep (the 4 s before the sleeping pose, the first Zzz)
    if (crossed(2.65, s, prev)) rig.t += 3.6;
    if (crossed(3.0, s, prev)) rig.t += 1.4;
    // the cursor wakes it
    const wake = path([[4.8, 440, 150], [5.05, 380, 215], [5.3, 440, 150]], s);
    const moving = s >= 4.8 && s < 5.3;
    Object.assign(rig.cursor, { x: moving ? wake.x : 440, y: moving ? wake.y : 150, kind: 'arrow', visible: s >= 4.7 || s < 0.4, feed: moving });
    if (crossed(4.8, s, prev)) input(rig, { idleMs: 0, mouseSpeed: 300 });
  },
  back(g, rig, s) {
    blit(g, cached('dusk', WALLPAPERS.dusk));
    g.setTransform(K, 0, 0, K, 0, 0);
    barsWindow(g, 5, 10, 44, 34, 'build', C.gold);
    barsWindow(g, 76, 20, 46, 32, 'chat', C.pink);
    blit(g, cached('taskbar', taskbarLayer));
    clock(g, 9 * 60 + 41 + (rig.mem.clock ?? 0) * 3);
    // fast-forward badge
    if (s >= 0.6 && s < 2.7 && Math.floor(s * 6) % 2 === 0) {
      rect(g, 84, 4, 40, 11, C.ink);
      rect(g, 84, 4, 40, 1, C.mint);
      rect(g, 84, 14, 40, 1, C.mint);
      drawText(g, '>> x240', 91, 7, C.mint);
    }
  },
};

/* ----- 07 reminders & pomodoro */
const reminders: ClipDef = {
  id: 'reminders-pomodoro',
  title: 'Reminders and Pomodoro',
  seconds: 6,
  character: 'stitch',
  seed: 707,
  poster: 1.5,
  heartbeat: true,
  script(rig, s, prev) {
    rig.cursor.visible = false;
    if (crossed(0, s, prev)) {
      const total = 25 * 60_000;
      rig.driver.handlePomodoro({ phase: 'focus', endsAt: EPOCH + rig.t * 1000 + total - 3000, cycle: 1, paused: false, remainingMs: total });
    }
    if (crossed(0.4, s, prev)) {
      rig.driver.handleReminder({ kind: 'stretch', text: '', durationMs: 2600 });
      rig.driver.handleReminder({ kind: 'water', text: '', durationMs: 2600 });
    }
  },
  back(g, _rig, s) {
    blit(g, cached('teal', WALLPAPERS.teal));
    g.setTransform(K, 0, 0, K, 0, 0);
    editor(g, 'critter.ts', CODE.length);
    drawCode(g, CODE, CODE_LEN, 24, 16);
    blit(g, cached('taskbar', taskbarLayer));
    clock(g, 9 * 60 + 41 + Math.floor(s / 60));
  },
};

/* ----- 08 peek mode */
const VIDEO_RECT = { x: 14, y: 16, w: 100, h: 62 };
function videoScene(g: Ctx, x: number, y: number, w: number, h: number, t: number): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  const bands = ['#101845', '#243a8a', '#5a63b8', '#e89a7a', '#ffc58a'];
  bands.forEach((c, i) => rect(g, x, y + Math.floor((i * h * 0.75) / bands.length), w, Math.ceil((h * 0.75) / bands.length) + 1, c));
  const sunX = x + Math.round(w * 0.7);
  const sunY = y + Math.round(h * 0.45);
  const r = Math.max(3, Math.round(w * 0.07));
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r) rect(g, sunX + i, sunY + j, 1, 1, '#fff3d6');
  const rng = mulberry32(5);
  for (let i = 0; i < 18; i++) rect(g, x + Math.floor(rng() * w), y + Math.floor(rng() * h * 0.35), 1, 1, '#ffffff');
  const layers: [string, number, number, number][] = [
    ['#1a2158', 0.62, 10, 6],
    ['#0e1238', 0.78, 6, 14],
  ];
  for (const [c, base, amp, speed] of layers) {
    for (let i = 0; i < w; i++) {
      const hy = Math.round(y + h * base + Math.sin((i + t * speed) / (w / 9)) * (amp * w) / 128 + Math.sin((i + t * speed) / (w / 23)) * 2);
      rect(g, x + i, hy, 1, y + h - hy, c);
    }
  }
  // a tiny bird
  const bx = x + ((Math.round(t * 14) + 20) % (w + 10)) - 5;
  const by = y + Math.round(h * 0.28 + Math.sin(t * 5));
  rect(g, bx, by, 1, 1, '#0a0e24');
  rect(g, bx + 1, by + 1, 1, 1, '#0a0e24');
  rect(g, bx + 2, by, 1, 1, '#0a0e24');
  g.restore();
}

const peek: ClipDef = {
  id: 'peek-mode',
  title: 'Peek mode',
  seconds: 6.5,
  character: 'yoda',
  seed: 808,
  poster: 3.2,
  heartbeat: true,
  patch: { peek: { auto: true, edge: 'bottom' } },
  script(rig, s, prev) {
    rig.cursor.visible = false;
    if (crossed(1.0, s, prev)) rig.driver.handlePeek(true);
    if (crossed(2.7, s, prev)) rig.driver.handleReminder({ kind: 'water', text: '', durationMs: 2800 });
    if (crossed(4.8, s, prev)) rig.driver.handlePeek(false);
    // main slides the overlay window to the edge (60% stays on screen) and back
    const peekY = Math.round(H - STAGE_H * K * 0.6);
    let u = 0;
    if (s >= 1.0 && s < 4.8) u = smooth((s - 1.0) / 0.3);
    else if (s >= 4.8) u = 1 - smooth((s - 4.8) / 0.3);
    rig.win = { x: rig.base.x, y: Math.round(lerp(rig.base.y, peekY, u)) };
  },
  back(g, _rig, s) {
    blit(g, cached('dusk', WALLPAPERS.dusk));
    g.setTransform(K, 0, 0, K, 0, 0);
    barsWindow(g, 4, 6, 36, 28, 'files', C.mint);
    blit(g, cached('taskbar', taskbarLayer));
    clock(g, 9 * 60 + 41);
    // the video player: small window -> fullscreen -> back
    const full = { x: 0, y: 0, w: 128, h: 128 };
    let k = 0;
    if (s >= 0.5 && s < 1.0) k = Math.floor(((s - 0.5) / 0.5) * 4 + 0.001) / 4;
    else if (s >= 1.0 && s < 4.4) k = 1;
    else if (s >= 4.4 && s < 4.9) k = 1 - Math.floor(((s - 4.4) / 0.5) * 4 + 0.001) / 4;
    const r = {
      x: Math.round(lerp(VIDEO_RECT.x, full.x, k)),
      y: Math.round(lerp(VIDEO_RECT.y, full.y, k)),
      w: Math.round(lerp(VIDEO_RECT.w, full.w, k)),
      h: Math.round(lerp(VIDEO_RECT.h, full.h, k)),
    };
    if (k < 1) windowFrame(g, r.x, r.y - 7, r.w, r.h + 7, 'player', C.ink);
    videoScene(g, r.x, r.y, r.w, r.h, s);
    // player chrome: progress bar + pause glyph
    const bar = Math.round(lerp(0, r.w - 8, clamp01(s / 6.5)));
    rect(g, r.x + 4, r.y + r.h - 6, r.w - 8, 2, 'rgba(10,14,36,0.7)');
    rect(g, r.x + 4, r.y + r.h - 6, bar, 2, C.red);
    if (k < 1) drawText(g, '||', r.x + 5, r.y + r.h - 14, '#ffffff');
    if (k === 1 && s > 1.1 && s < 2.4) drawText(g, 'FULLSCREEN', 5, 5, 'rgba(255,255,255,0.65)');
  },
};

/* ----- 09 make it yours */
const STITCH_PINK: Palette = { outline: '#5c1b3d', body: '#e46aa0', bodyShade: '#bb4a7e', belly: '#ffd3e6', earInner: '#8f3fb0', eye: '#151521', pupil: '#ffffff', accent: '#a03f7a' };
const STITCH_AMBER: Palette = { outline: '#5a2b0f', body: '#f2a03d', bodyShade: '#c97a22', belly: '#ffe3b0', earInner: '#b0468f', eye: '#151521', pupil: '#ffffff', accent: '#7a3f1a' };
const STITCH_MINT: Palette = { outline: '#0f4a3f', body: '#3fcfa6', bodyShade: '#2aa383', belly: '#c9fbe9', earInner: '#b0468f', eye: '#151521', pupil: '#ffffff', accent: '#1f7a64' };
const YODA_SAND: Palette = { outline: '#4a3414', body: '#d9b36a', bodyShade: '#b38c45', belly: '#f3e0b0', earInner: '#c9a07a', eye: '#2a1d10', pupil: '#ffffff', accent: '#7a3b2b' };
const YODA_PLUM: Palette = { outline: '#3a1b4a', body: '#a67ad9', bodyShade: '#8458b8', belly: '#e0d0f5', earInner: '#d9a07a', eye: '#2a1d10', pupil: '#ffffff', accent: '#2b5a8a' };

const LOOKS: { at: number; id: CharacterId; pal: Palette; scale: number }[] = [
  { at: 0, id: 'stitch', pal: DEFAULT_PALETTES.stitch, scale: 4 },
  { at: 0.8, id: 'stitch', pal: STITCH_PINK, scale: 4 },
  { at: 1.6, id: 'stitch', pal: STITCH_AMBER, scale: 4 },
  { at: 2.4, id: 'stitch', pal: STITCH_MINT, scale: 4 },
  { at: 3.2, id: 'stitch', pal: STITCH_MINT, scale: 3 },
  { at: 3.9, id: 'yoda', pal: DEFAULT_PALETTES.yoda, scale: 3 },
  { at: 4.6, id: 'yoda', pal: YODA_SAND, scale: 3 },
  { at: 5.3, id: 'yoda', pal: YODA_PLUM, scale: 3 },
  { at: 6.0, id: 'yoda', pal: YODA_PLUM, scale: 4 },
  { at: 6.7, id: 'stitch', pal: DEFAULT_PALETTES.stitch, scale: 4 },
];

const makeIt: ClipDef = {
  id: 'make-it-yours',
  title: 'Make it yours',
  seconds: 7.4,
  character: 'stitch',
  seed: 909,
  poster: 2.0,
  heartbeat: true,
  script(rig, s, prev) {
    rig.cursor.visible = false;
    LOOKS.forEach((l, i) => {
      if (crossed(l.at, s, prev) && i > 0) {
        setLook(rig, l.id, l.pal, l.scale);
        rig.driver.force('excited', 700);
      }
      if (i === 0 && crossed(0, s, prev)) {
        setLook(rig, l.id, l.pal, l.scale);
      }
    });
  },
  back(g, rig, s) {
    blit(g, cached('teal', WALLPAPERS.teal));
    g.setTransform(K, 0, 0, K, 0, 0);
    // settings window mirroring what the engine is currently showing
    const x = 6;
    const y = 4;
    windowFrame(g, x, y, 116, 52, 'settings');
    const look = [...LOOKS].reverse().find((l) => s >= l.at) ?? LOOKS[0]!;
    const row = (n: number): number => y + 11 + n * 14;
    drawText(g, 'Character', x + 4, row(0) + 2, C.dim);
    (['stitch', 'yoda'] as CharacterId[]).forEach((id, i) => {
      const on = look.id === id;
      rect(g, x + 50 + i * 30, row(0), 28, 9, on ? C.mint : C.bar);
      drawText(g, id === 'stitch' ? 'Stitch' : 'Yoda', x + 53 + i * 30, row(0) + 2, on ? C.ink : C.text);
    });
    drawText(g, 'Colours', x + 4, row(1) + 2, C.dim);
    const p = rig.settings.palettes[look.id];
    [p.body, p.bodyShade, p.belly, p.earInner, p.accent].forEach((c, i) => {
      rect(g, x + 50 + i * 11, row(1), 10, 9, C.ink);
      rect(g, x + 51 + i * 11, row(1) + 1, 8, 7, c);
    });
    drawText(g, 'Scale', x + 4, row(2) + 2, C.dim);
    [1, 2, 3, 4].forEach((n, i) => {
      const on = look.scale === n;
      rect(g, x + 50 + i * 14, row(2), 12, 9, on ? C.mint : C.bar);
      drawText(g, `${n}x`, x + 53 + i * 14, row(2) + 2, on ? C.ink : C.text);
    });
    blit(g, cached('taskbar', taskbarLayer));
    clock(g, 9 * 60 + 41);
  },
};

const CLIPS: ClipDef[] = [eyeFollow, dragClip, typing, petting, agent, sleepClip, reminders, peek, makeIt];

/* ------------------------------------------------------------------ player ---- */

const sceneCanvas = document.createElement('canvas');
sceneCanvas.width = W;
sceneCanvas.height = H;
document.body.append(sceneCanvas);
const scene = sceneCanvas.getContext('2d')!;
scene.imageSmoothingEnabled = false;

interface Run {
  clip: ClipDef;
  rig: Rig;
  frames: number;
  /** frames advanced so far (warm-up included) */
  n: number;
  warm: number;
}
let run: Run | null = null;

function tick(r: Run, draw: boolean): void {
  const { clip, rig } = r;
  const i = r.n % r.frames;
  const s = i / FPS;
  const prev = s - DT;
  if (clip.heartbeat !== false && every(0.5, s, prev)) input(rig, { idleMs: 200 });
  clip.script(rig, s, prev);
  feedCursor(rig);
  rig.t += DT;
  rig.driver.update(DT);
  rig.driver.render();
  r.n++;
  if (!draw) return;
  const g = scene;
  g.setTransform(K, 0, 0, K, 0, 0);
  g.imageSmoothingEnabled = false;
  clip.back(g, rig, s);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(rig.stage.canvas, rig.win.x, rig.win.y, STAGE_W * rig.scale, STAGE_H * rig.scale);
  g.setTransform(K, 0, 0, K, 0, 0);
  clip.front?.(g, rig, s);
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (rig.cursor.visible) {
    if (rig.cursor.kind === 'hand') drawSprite(g, HAND, rig.cursor.x, rig.cursor.y, 6, 5, 2);
    else drawSprite(g, ARROW, rig.cursor.x, rig.cursor.y, 0, 0, 2);
  }
}

const api = {
  list: () =>
    CLIPS.map((c) => ({ id: c.id, title: c.title, frames: Math.round(c.seconds * FPS), fps: FPS, w: W, h: H, poster: Math.round(c.poster * FPS) })),
  /** Start a clip: build a fresh engine and run the two warm-up passes. */
  begin(id: string) {
    const clip = CLIPS.find((c) => c.id === id);
    if (!clip) throw new Error(`unknown clip ${id}`);
    const rig = makeRig(clip.character, clip.seed, clip.patch);
    clip.setup?.(rig);
    const frames = Math.round(clip.seconds * FPS);
    run = { clip, rig, frames, n: 0, warm: frames * 2 };
    while (run.n < run.warm) tick(run, false);
    return { id, frames, fps: FPS, w: W, h: H };
  },
  /** Render the next frame of the recorded pass; returns a base64 PNG. */
  next(): string {
    if (!run) throw new Error('begin() first');
    tick(run, true);
    return sceneCanvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
  },
};
(window as unknown as { clips: typeof api }).clips = api;
