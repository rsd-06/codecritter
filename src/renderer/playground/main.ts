// Browser playground: live overlay on a fake desktop + a control panel that drives every event.
import { PEEK_VISIBLE_FRACTION } from '@shared/constants';
import { DEFAULT_PALETTES } from '@shared/defaults';
import type { AgentEventType, AgentId, CharacterId, Palette, ReminderKind, Settings } from '@shared/types';
import { MockBridge } from '../overlay/bridge';
import { EXPRESSION_NAMES } from '../overlay/engine/expression';
import type { ExpressionName } from '../overlay/engine/types';
import { startOverlay } from '../overlay/main';
import { ALL_SOUNDS } from '../overlay/engine/soundPlan';

const bridge = new MockBridge();
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const desk = document.getElementById('desk') as HTMLElement;
const win = document.getElementById('overlayWin') as HTMLElement;
const panel = document.getElementById('panel') as HTMLElement;
const statsEl = document.getElementById('stats') as HTMLElement;

const overlay = startOverlay(bridge, { canvas, settings: bridge.settings });

/* ------------------------------------------------------------------ fake window dragging */
bridge.onDragMove = (dx, dy) => {
  const r = win.getBoundingClientRect();
  const d = desk.getBoundingClientRect();
  win.style.right = 'auto';
  win.style.bottom = 'auto';
  win.style.left = `${Math.max(0, Math.min(d.width - r.width, r.left - d.left + dx))}px`;
  win.style.top = `${Math.max(0, Math.min(d.height - r.height, r.top - d.top + dy))}px`;
};
bridge.onInteractive = (on) => {
  win.style.cursor = on ? 'grab' : 'default';
};

/* ------------------------------------------------------------------ real input -> samples */
const sim = { kps: 0, scroll: 0, mouse: 0, clicks: 0, idleSec: 0 };
const clickTimes: number[] = [];
const keyTimes: number[] = [];
let wheelAcc = 0;
let moveDist = 0;
let lastMouse: { x: number; y: number; t: number } | null = null;
let lastActivity = performance.now();
let lastCursorEmit = 0;
let quietTicks = 0;
/** pretend the last real activity was `sec` seconds ago (idle-skip buttons); real input resets it */
function skipIdle(sec: number): void {
  lastActivity -= sec * 1000;
}

desk.addEventListener('pointermove', (e) => {
  const now = performance.now();
  if (lastMouse) moveDist += Math.hypot(e.clientX - lastMouse.x, e.clientY - lastMouse.y);
  lastMouse = { x: e.clientX, y: e.clientY, t: now };
  lastActivity = now;
  if (now - lastCursorEmit > 33) {
    lastCursorEmit = now;
    const r = win.getBoundingClientRect();
    bridge.emitCursor({ x: e.clientX, y: e.clientY, winX: r.left, winY: r.top, winW: r.width, winH: r.height });
  }
});
desk.addEventListener('pointerdown', () => {
  clickTimes.push(performance.now());
  lastActivity = performance.now();
});
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  keyTimes.push(performance.now());
  lastActivity = performance.now();
  void e;
});
document.addEventListener(
  'wheel',
  (e) => {
    if (panel.contains(e.target as Node)) return;
    wheelAcc += e.deltaY / 100;
    lastActivity = performance.now();
  },
  { passive: true },
);

setInterval(() => {
  const now = performance.now();
  while (keyTimes.length && now - keyTimes[0]! > 1000) keyTimes.shift();
  const realKps = keyTimes.length;
  const recent = keyTimes.length > 0 && now - keyTimes[keyTimes.length - 1]! < 150;
  const kps = Math.max(realKps, sim.kps);
  const burst = recent || sim.kps > 0;
  while (clickTimes.length && now - clickTimes[0]! > 1000) clickTimes.shift();
  const clicks = Math.max(clickTimes.length, sim.clicks);
  const scroll = wheelAcc + sim.scroll;
  const mouse = Math.max(moveDist * 10, sim.mouse);
  const idleMs = Math.max(now - lastActivity, sim.idleSec * 1000);
  const active = kps > 0 || burst || scroll !== 0 || mouse > 0 || clicks > 0;
  wheelAcc = 0;
  moveDist = 0;
  if (!active && ++quietTicks % 20 !== 0) return; // keep the bus quiet when nothing happens
  bridge.emitInput({ keysPerSec: kps, keyBurst: burst, scrollDelta: scroll, mouseSpeed: mouse, clicksPerSec: clicks, idleMs });
}, 100);

/* ------------------------------------------------------------------ panel helpers */
function section(title: string): HTMLElement {
  const s = document.createElement('section');
  s.className = 'sec';
  const h = document.createElement('h2');
  h.textContent = title;
  s.append(h);
  panel.append(s);
  return s;
}
function row(parent: HTMLElement, label?: string, cls = ''): HTMLElement {
  const r = document.createElement('div');
  r.className = `row ${cls}`;
  if (label) {
    const l = document.createElement('label');
    l.textContent = label;
    r.append(l);
  }
  parent.append(r);
  return r;
}
function btn(parent: HTMLElement, text: string, fn: () => void, title?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  if (title) b.title = title;
  b.addEventListener('click', fn);
  parent.append(b);
  return b;
}
function slider(
  parent: HTMLElement,
  label: string,
  min: number,
  max: number,
  step: number,
  init: number,
  onInput: (v: number) => void,
): HTMLInputElement {
  const r = row(parent, label);
  const i = document.createElement('input');
  i.type = 'range';
  i.min = String(min);
  i.max = String(max);
  i.step = String(step);
  i.value = String(init);
  const v = document.createElement('span');
  v.className = 'val';
  v.textContent = String(init);
  i.addEventListener('input', () => {
    v.textContent = i.value;
    onInput(Number(i.value));
  });
  r.append(i, v);
  return i;
}
function select<T extends string>(parent: HTMLElement, options: readonly T[], value: T, on: (v: T) => void): HTMLSelectElement {
  const s = document.createElement('select');
  options.forEach((o) => s.add(new Option(o)));
  s.value = value;
  s.addEventListener('change', () => on(s.value as T));
  parent.append(s);
  return s;
}

/* ------------------------------------------------------------------ expressions */
const expr = section('Expressions (hold 4s)');
const exprRow = row(expr, undefined, 'chips');
EXPRESSION_NAMES.forEach((n) => btn(exprRow, n, () => overlay.driver.force(n, 4000)));
btn(row(expr), 'back to automatic', () => overlay.driver.force('neutral', 1));

/* ------------------------------------------------------------------ agents */
const AGENTS: AgentId[] = [
  'claude-code', 'codex', 'cursor', 'gemini', 'antigravity', 'kiro', 'copilot', 'opencode', 'devin', 'generic',
];
const TYPES: AgentEventType[] = ['thinking', 'tool', 'done', 'error', 'attention', 'idle'];
const agents = section('Agent events');
let agent: AgentId = 'claude-code';
const agentRow = row(agents, 'agent');
select(agentRow, AGENTS, agent, (v) => (agent = v));
const typeRow = row(agents, undefined, 'chips');
TYPES.forEach((t) => btn(typeRow, t, () => bridge.emitAgent({ agent, type: t })));
const perAgent = row(agents, 'all agents', 'chips');
AGENTS.forEach((a) => btn(perAgent, a, () => bridge.emitAgent({ agent: a, type: 'done' }), `${a} done`));

/* ------------------------------------------------------------------ reminders */
const rem = section('Reminders & pomodoro');
const remRow = row(rem, undefined, 'chips');
(['stretch', 'water', 'message'] as ReminderKind[]).forEach((k) =>
  btn(remRow, k, () => bridge.emitReminder({ kind: k, text: k === 'message' ? msgInput.value : '' })),
);
const msgRow = row(rem, 'message');
const msgInput = document.createElement('input');
msgInput.value = 'Standup in 5 minutes!';
msgInput.style.flex = '1';
msgRow.append(msgInput);
const pomoRow = row(rem, undefined, 'chips');
(['pomodoro-focus', 'pomodoro-break', 'pomodoro-done'] as ReminderKind[]).forEach((k) =>
  btn(pomoRow, k.replace('pomodoro-', 'pomo '), () => bridge.emitReminder({ kind: k })),
);
const timerRow = row(rem, 'timer', 'chips');
let pomoPhase: 'focus' | 'break' | 'longBreak' = 'focus';
function pomoStart(phase: 'focus' | 'break' | 'longBreak', minutes: number): void {
  pomoPhase = phase;
  const key = phase === 'focus' ? 'focusMin' : phase === 'break' ? 'breakMin' : 'longBreakMin';
  bridge.emitSettings({ pomodoro: { ...bridge.settings.pomodoro, [key]: minutes } });
  bridge.emitPomodoro({ phase, endsAt: Date.now() + minutes * 60_000, remainingMs: minutes * 60_000, cycle: 1 });
}
btn(timerRow, 'focus 25m', () => pomoStart('focus', 25));
btn(timerRow, 'break 5m', () => pomoStart('break', 5));
btn(timerRow, 'long 15m', () => pomoStart('longBreak', 15));
btn(timerRow, 'focus 30s', () => pomoStart('focus', 0.5));
btn(timerRow, 'pause', () =>
  bridge.emitPomodoro({ phase: pomoPhase, paused: true, endsAt: null, remainingMs: 12 * 60_000, cycle: 1 }),
);
btn(timerRow, 'stop', () => bridge.emitPomodoro({ phase: 'idle' }));
const peekRow = row(rem, 'peek', 'chips');
// The real overlay window is slid partly off-screen by main; emulate that by clipping the canvas.
let peekOn = false;
function clipPeek(): void {
  const c = overlay.stage.canvas;
  const hide = `${(1 - PEEK_VISIBLE_FRACTION) * 100}%`;
  const edge = bridge.settings.peek.edge;
  c.style.clipPath = !peekOn
    ? ''
    : edge === 'bottom'
      ? `inset(0 0 ${hide} 0)`
      : edge === 'right'
        ? `inset(0 ${hide} 0 0)`
        : `inset(0 0 0 ${hide})`;
}
select(peekRow, ['bottom', 'left', 'right'] as const, bridge.settings.peek.edge, (v) => {
  bridge.emitSettings({ peek: { ...bridge.settings.peek, edge: v } });
  clipPeek();
});
btn(peekRow, 'peek on', () => {
  peekOn = true;
  clipPeek();
  bridge.emitPeek(true);
});
btn(peekRow, 'peek off', () => {
  peekOn = false;
  bridge.emitPeek(false);
  setTimeout(clipPeek, 700);
});

/* ------------------------------------------------------------------ simulated input */
const inp = section('Simulated input');
slider(inp, 'keys/sec', 0, 16, 1, 0, (v) => (sim.kps = v));
slider(inp, 'scroll', 0, 10, 1, 0, (v) => (sim.scroll = v));
slider(inp, 'mouse px/s', 0, 6000, 100, 0, (v) => (sim.mouse = v));
slider(inp, 'clicks/sec', 0, 12, 1, 0, (v) => (sim.clicks = v));
slider(inp, 'idle sec', 0, 600, 10, 0, (v) => (sim.idleSec = v));
btn(row(inp), 'reset sliders', () => {
  panel.querySelectorAll<HTMLInputElement>('.sec input[type=range]').forEach((i) => {
    if (['keys/sec', 'scroll', 'mouse px/s', 'clicks/sec', 'idle sec'].includes(i.parentElement?.firstElementChild?.textContent ?? '')) {
      i.value = '0';
      i.dispatchEvent(new Event('input'));
    }
  });
});

/* ------------------------------------------------------------------ behaviour tests */
const beh = section('Behaviour tests');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
function headScreen(): { x: number; y: number; r: DOMRect } {
  const r = win.getBoundingClientRect();
  const h = overlay.stage.head;
  return { x: r.left + (h.x / 128) * r.width, y: r.top + (h.y / 112) * r.height, r };
}
function sendCursor(x: number, y: number): void {
  const r = win.getBoundingClientRect();
  lastActivity = performance.now();
  bridge.emitCursor({ x, y, winX: r.left, winY: r.top, winW: r.width, winH: r.height });
}
async function simHunt(): Promise<void> {
  const h = headScreen();
  const startX = h.x - h.r.width * 0.9;
  for (let k = 0; k <= 8; k++) {
    sendCursor(startX + k * 38, h.y + 10); // ~1250 px/s at 30 ms steps
    await sleep(30);
  }
}
async function simPetting(): Promise<void> {
  const h = headScreen();
  for (let k = 0; k < 24; k++) {
    sendCursor(h.x + (k % 2 ? 18 : -18), h.y - 4);
    await sleep(70);
  }
}
async function simShake(ms: number): Promise<void> {
  overlay.driver.dragStart();
  const n = Math.round(ms / 50);
  for (let k = 0; k < n; k++) {
    overlay.driver.dragMove(k % 2 ? 22 : -22, 0);
    await sleep(50);
  }
  overlay.driver.dragEnd();
}
async function simMultiAgent(): Promise<void> {
  const ev = (agent: AgentId, type: AgentEventType, session: string): void =>
    bridge.emitAgent({ agent, type, session });
  ev('claude-code', 'thinking', 'a');
  await sleep(800);
  ev('codex', 'thinking', 'b');
  await sleep(800);
  ev('claude-code', 'tool', 'c');
  await sleep(4000);
  ev('claude-code', 'done', 'a');
  await sleep(3500);
  ev('claude-code', 'done', 'c');
  await sleep(3500);
  ev('codex', 'done', 'b');
}
const behRow = row(beh, undefined, 'chips');
btn(behRow, 'hunt (fast cursor)', () => void simHunt());
btn(behRow, 'petting', () => void simPetting());
btn(behRow, 'shake drag 1s', () => void simShake(1000));
btn(behRow, 'shake drag 3s (dizzy)', () => void simShake(3200));
btn(behRow, 'multi-agent', () => void simMultiAgent());
const idleRow = row(beh, 'idle skip', 'chips');
btn(idleRow, '+2 min', () => skipIdle(120));
btn(idleRow, '+5 min', () => skipIdle(300));
btn(idleRow, 'wake', () => {
  lastActivity = performance.now();
  sim.idleSec = 0;
});
const lnRow = row(beh, undefined, 'chips');
const lateOn = document.createElement('input');
lateOn.type = 'checkbox';
lateOn.addEventListener('change', () => overlay.driver.brain.forceHour(lateOn.checked ? 2 : null));
const lateLabel = document.createElement('label');
lateLabel.append(lateOn, ' late night (pretend 02:00, type to see the nudge)');
lnRow.append(lateLabel);

/* ------------------------------------------------------------------ character & look */
const look = section('Character & look');
let paletteTouched = false;
const charRow = row(look, 'character');
const charSel = select(charRow, ['stitch', 'yoda'] as CharacterId[], 'stitch', (c) => {
  bridge.emitSettings({ character: c });
  renderPalette();
});
const scaleRow = row(look, 'scale');
select(scaleRow, ['1', '2', '3', '4'], '2', (v) => bridge.emitSettings({ scale: Number(v) as Settings['scale'] }));
slider(look, 'opacity', 0.2, 1, 0.05, 1, (v) => bridge.emitSettings({ opacity: v }));
const nameRow = row(look, 'name');
const nameInput = document.createElement('input');
nameInput.placeholder = 'Your name';
nameInput.style.flex = '1';
nameInput.addEventListener('input', () => bridge.emitSettings({ userName: nameInput.value }));
nameRow.append(nameInput);
const noteRow = row(look, 'pinned');
const noteInput = document.createElement('input');
noteInput.placeholder = 'Sticky note text';
noteInput.style.flex = '1';
noteInput.addEventListener('input', () => bridge.emitSettings({ pinnedNote: noteInput.value }));
noteRow.append(noteInput);

const palBox = document.createElement('div');
look.append(palBox);
const PAL_KEYS: (keyof Palette)[] = ['outline', 'body', 'bodyShade', 'belly', 'earInner', 'eye', 'pupil', 'accent'];
function renderPalette(): void {
  palBox.replaceChildren();
  const id = bridge.settings.character;
  const pal = bridge.settings.palettes[id];
  const grid = row(palBox, undefined, 'chips');
  PAL_KEYS.forEach((k) => {
    const wrap = document.createElement('label');
    wrap.style.cssText = 'display:flex;gap:4px;align-items:center;color:var(--dim)';
    const c = document.createElement('input');
    c.type = 'color';
    c.value = pal[k];
    c.addEventListener('input', () => {
      paletteTouched = true;
      const cur = bridge.settings.palettes[id];
      bridge.emitSettings({ palettes: { ...bridge.settings.palettes, [id]: { ...cur, [k]: c.value } } });
    });
    wrap.append(c, k);
    grid.append(wrap);
  });
  btn(row(palBox), 'reset palette', () => {
    bridge.emitSettings({ palettes: { ...bridge.settings.palettes, [id]: { ...DEFAULT_PALETTES[id] } } });
    renderPalette();
  });
}
renderPalette();
void paletteTouched;

/* ------------------------------------------------------------------ sound */
const snd = section('Sound');
const sRow = row(snd, undefined, 'chips');
const soundOn = document.createElement('input');
soundOn.type = 'checkbox';
soundOn.checked = true;
soundOn.addEventListener('change', () =>
  bridge.emitSettings({ sound: { ...bridge.settings.sound, enabled: soundOn.checked } }),
);
const sl = document.createElement('label');
sl.append(soundOn, ' enabled');
sRow.append(sl);
slider(snd, 'volume', 0, 1, 0.05, 0.5, (v) => bridge.emitSettings({ sound: { ...bridge.settings.sound, volume: v } }));
const sRow2 = row(snd, undefined, 'chips');
btn(sRow2, 'voice', () => overlay.sound.speak(24));
const sRow3 = row(snd, undefined, 'chips');
for (const n of ALL_SOUNDS) btn(sRow3, n, () => overlay.sound.play(n, { force: true, level: n === 'reminder' ? 0.6 : undefined }));
btn(sRow2, 'purr on', () => overlay.sound.purr(true));
btn(sRow2, 'purr off', () => overlay.sound.purr(false));

/* ------------------------------------------------------------------ stats + test handles */
let lastTicks = 0;
const recent: number[] = [];
setInterval(() => {
  const ticks = overlay.scheduler.ticks;
  const d = overlay.driver.debug();
  recent.push(ticks - lastTicks);
  if (recent.length > 10) recent.shift();
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  statsEl.textContent = `redraws/s ${ticks - lastTicks} (avg10 ${avg.toFixed(1)}) | ${d.state} / ${d.expression} | idle ${Math.round(d.idleMs / 1000)}s`;
  lastTicks = ticks;
}, 1000);

const handles = {
  bridge,
  overlay,
  stage: overlay.stage,
  driver: overlay.driver,
  emitAgent: bridge.emitAgent.bind(bridge),
  emitReminder: bridge.emitReminder.bind(bridge),
  emitPomodoro: bridge.emitPomodoro.bind(bridge),
  emitInput: bridge.emitInput.bind(bridge),
  emitCursor: bridge.emitCursor.bind(bridge),
  emitSettings: bridge.emitSettings.bind(bridge),
  emitPeek: bridge.emitPeek.bind(bridge),
  setExpression: (n: ExpressionName, ms = 4000) => overlay.driver.force(n, ms),
  hit: (x: number, y: number) => overlay.stage.hitTest(x, y),
  state: () => overlay.driver.debug(),
  brain: overlay.driver.brain,
  skipIdle,
  redrawAvg: () => recent.reduce((a, b) => a + b, 0) / Math.max(1, recent.length),
  ticks: () => overlay.scheduler.ticks,
  log: () => bridge.log,
  sim,
};
(window as unknown as { __critter: typeof handles }).__critter = handles;
void charSel;
