// Landing page: runs the REAL overlay engine (src/renderer/overlay) on a canvas with a mock bridge,
// and feeds it page input the same way the desktop app feeds it OS input.
import './style.css';
import './analytics';
import { DEFAULT_SETTINGS } from '@shared/defaults';
import type { AgentEvent, AgentId, CharacterId, ReminderKind, Settings } from '@shared/types';
import { MockBridge } from '../../src/renderer/overlay/bridge';
import { startOverlay } from '../../src/renderer/overlay/main';

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

const canvas = $<HTMLCanvasElement>('#critter');
const plate = $('#plate');
const slot = $('#slot');
const dock = $('#dock');

const bridge = new MockBridge();
const settings: Settings = structuredClone(DEFAULT_SETTINGS);
settings.sound = { enabled: false, volume: 0.5 };
settings.scale = 4;
settings.character = 'yoda'; // the site leads with Yoda (the logo character)
bridge.settings = settings;
const overlay = startOverlay(bridge, { canvas, settings });

/* ------------------------------------------------------------------ integer scaling + docking */
let docked = false;
let dismissed = false;
let heroScale: 1 | 2 | 3 | 4 = 4;

function setScale(s: 1 | 2 | 3 | 4): void {
  if (bridge.settings.scale === s) return;
  bridge.emitSettings({ scale: s });
  overlay.scheduler.wake();
}
function fitHero(): void {
  const cs = getComputedStyle(plate);
  const avail = plate.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  heroScale = Math.max(1, Math.min(4, Math.floor(avail / 128))) as 1 | 2 | 3 | 4;
  slot.style.width = `${128 * heroScale}px`;
  slot.style.height = `${112 * heroScale}px`;
  if (!docked) setScale(heroScale);
}
function setDocked(d: boolean): void {
  if (d === docked) return;
  docked = d;
  if (d) {
    dock.prepend(canvas);
    setScale(innerWidth < 720 ? 1 : 2);
  } else {
    slot.append(canvas);
    setScale(heroScale);
  }
  dock.hidden = !d || dismissed;
  overlay.scheduler.wake();
}
new ResizeObserver(fitHero).observe(plate);
void Promise.resolve().then(fitHero); // after the bridge getSettings() snapshot has been applied
// dock only once the hero has scrolled UP out of view (not while it is still below the fold)
new IntersectionObserver(([e]) => setDocked(!e!.isIntersecting && e!.boundingClientRect.bottom < innerHeight / 2), {
  threshold: [0, 0.2],
}).observe(slot);
$('#dock-x').addEventListener('click', () => {
  dismissed = true;
  dock.hidden = true;
});
const undismiss = (): void => {
  if (dismissed) {
    dismissed = false;
    dock.hidden = !docked;
  }
};

/* ------------------------------------------------------------------ page input -> samples */
const keyTimes: number[] = [];
let wheelAcc = 0;
let moveDist = 0;
let lastMouse: { x: number; y: number } | null = null;
let lastActivity = performance.now();
let lastCursorEmit = 0;
let quiet = 0;
const touch = (): void => {
  lastActivity = performance.now();
};

addEventListener(
  'pointermove',
  (e) => {
    const now = performance.now();
    if (lastMouse) moveDist += Math.hypot(e.clientX - lastMouse.x, e.clientY - lastMouse.y);
    lastMouse = { x: e.clientX, y: e.clientY };
    touch();
    if (now - lastCursorEmit > 33) {
      lastCursorEmit = now;
      const r = canvas.getBoundingClientRect();
      bridge.emitCursor({ x: e.clientX, y: e.clientY, winX: r.left, winY: r.top, winW: r.width, winH: r.height });
    }
  },
  { passive: true },
);
addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.key === 'Tab') return;
  keyTimes.push(performance.now());
  touch();
});
addEventListener(
  'wheel',
  (e) => {
    wheelAcc += e.deltaY / 100;
    touch();
  },
  { passive: true },
);
addEventListener(
  'scroll',
  () => {
    touch();
  },
  { passive: true },
);

setInterval(() => {
  if (document.hidden) return;
  const now = performance.now();
  while (keyTimes.length && now - keyTimes[0]! > 1000) keyTimes.shift();
  const kps = keyTimes.length;
  const burst = kps > 0 && now - keyTimes[kps - 1]! < 150;
  const active = kps > 0 || wheelAcc !== 0 || moveDist > 0;
  const sample = { keysPerSec: kps, keyBurst: burst, scrollDelta: wheelAcc, mouseSpeed: moveDist * 10, idleMs: now - lastActivity };
  wheelAcc = 0;
  moveDist = 0;
  if (!active && ++quiet % 20 !== 0) return;
  bridge.emitInput(sample);
}, 100);

/* ------------------------------------------------------------------ pet on click, hover cursor */
bridge.onInteractive = (on) => {
  canvas.style.cursor = on ? 'grab' : 'default';
};
let downAt: { x: number; y: number; t: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
});
canvas.addEventListener('pointerup', (e) => {
  const d = downAt;
  downAt = null;
  if (!d || performance.now() - d.t > 400 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
  const r = canvas.getBoundingClientRect();
  const lx = ((e.clientX - r.left) / r.width) * 128;
  const ly = ((e.clientY - r.top) / r.height) * 112;
  if (!overlay.stage.hitTest(e.clientX - r.left, e.clientY - r.top)) return;
  overlay.driver.force('love', 2400);
  for (let i = 0; i < 5; i++) {
    overlay.stage.particles.emit('heart', lx + (Math.random() - 0.5) * 26, ly - 6 - Math.random() * 6, { variant: i });
  }
  overlay.scheduler.wake();
  $('#try').textContent = 'Aww. Rub the cursor back and forth over its head for a purr.';
});

/* ------------------------------------------------------------------ hero controls */
const root = document.documentElement;
document.querySelectorAll<HTMLButtonElement>('[data-char-btn]').forEach((b) => {
  b.addEventListener('click', () => {
    const c = b.dataset.charBtn as CharacterId;
    bridge.emitSettings({ character: c });
    root.dataset.char = c;
    document.querySelectorAll<HTMLButtonElement>('[data-char-btn]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    overlay.driver.force('happy', 1800);
    overlay.scheduler.wake();
  });
});
const soundBtn = $<HTMLButtonElement>('#sound');
soundBtn.addEventListener('click', () => {
  const on = !bridge.settings.sound.enabled;
  bridge.emitSettings({ sound: { enabled: on, volume: 0.5 } });
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.textContent = on ? 'Sound on' : 'Sound off';
});
document.querySelectorAll<HTMLButtonElement>('[data-remind]').forEach((b) => {
  b.addEventListener('click', () => {
    undismiss();
    bridge.emitReminder({ kind: b.dataset.remind as ReminderKind, durationMs: 6000 });
    overlay.scheduler.wake();
  });
});

/* ------------------------------------------------------------------ agent demo */
const AGENTS: [AgentId, string][] = [
  ['claude-code', 'Claude Code'],
  ['codex', 'Codex'],
  ['cursor', 'Cursor'],
  ['gemini', 'Gemini CLI'],
  ['antigravity', 'Antigravity'],
  ['kiro', 'Kiro'],
  ['copilot', 'Copilot'],
  ['opencode', 'OpenCode'],
  ['devin', 'Devin'],
  ['generic', 'Any agent (curl)'],
];
let agent: AgentId = 'claude-code';
const pick = $('#agent-pick');
const agentBtns: HTMLButtonElement[] = AGENTS.map(([id, name]) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = name;
  b.setAttribute('aria-pressed', String(id === agent));
  b.addEventListener('click', () => {
    agent = id;
    agentBtns.forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
  });
  pick.append(b);
  return b;
});

const EVENTS: Record<string, { type: AgentEvent['type']; message?: string; cls: string; log: string }> = {
  thinking: { type: 'thinking', cls: 'dim', log: 'thinking' },
  tool: { type: 'tool', cls: 'dim', log: 'tool: running tests' },
  attention: { type: 'attention', message: 'May I run this command?', cls: 'warn', log: 'attention: "May I run this command?"' },
  done: { type: 'done', message: 'Refactor finished, 14 tests pass', cls: 'ok', log: 'done: "Refactor finished, 14 tests pass"' },
  error: { type: 'error', message: 'Build failed in src/api', cls: 'bad', log: 'error: "Build failed in src/api"' },
};
const term = $('#term');
const lines: HTMLElement[] = [];
document.querySelectorAll<HTMLButtonElement>('[data-ev]').forEach((b) => {
  b.addEventListener('click', () => {
    const ev = EVENTS[b.dataset.ev!]!;
    undismiss();
    bridge.emitAgent({ agent, type: ev.type, message: ev.message, session: 'demo', ts: Date.now() });
    overlay.scheduler.wake();
    const name = AGENTS.find((a) => a[0] === agent)![1];
    if (!lines.length) term.textContent = '';
    const row = document.createElement('span');
    row.className = ev.cls;
    row.textContent = `$ ${name.toLowerCase().replace(/ /g, '-')} > ${ev.log}\n`;
    lines.push(row);
    if (lines.length > 6) lines.shift()!.remove();
    term.append(row);
  });
});

/* ------------------------------------------------------------------ copy button */
$('#copy').addEventListener('click', async (e) => {
  const b = e.currentTarget as HTMLButtonElement;
  try {
    await navigator.clipboard.writeText($('#clone').innerText.trim());
    b.textContent = 'Copied';
  } catch {
    b.textContent = 'Press Ctrl+C';
  }
  setTimeout(() => (b.textContent = 'Copy'), 1800);
});

/* ------------------------------------------------------------------ launch video: show only if the file exists */
void (async () => {
  try {
    const res = await fetch('/media/launch.mp4', { method: 'HEAD' });
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && type.startsWith('video/')) $('#video').hidden = false;
  } catch {
    /* no video yet */
  }
})();


/* ------------------------------------------------------------------ feature clips: play only while visible */
const clipVideos = [...document.querySelectorAll<HTMLVideoElement>('.clip video')];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const playClip = (v: HTMLVideoElement): void => void v.play().catch(() => undefined);
if (reduceMotion.matches) {
  // posters only; a hover, focus or tap plays that one clip
  clipVideos.forEach((v) => {
    v.removeAttribute('autoplay');
    v.pause();
    v.tabIndex = 0;
    v.addEventListener('pointerenter', () => playClip(v));
    v.addEventListener('pointerleave', () => v.pause());
    v.addEventListener('focus', () => playClip(v));
    v.addEventListener('blur', () => v.pause());
    v.addEventListener('click', () => (v.paused ? playClip(v) : v.pause()));
  });
} else {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const v = e.target as HTMLVideoElement;
        if (e.isIntersecting) playClip(v);
        else v.pause();
      }
    },
    { threshold: 0.25 },
  );
  clipVideos.forEach((v) => io.observe(v));
}

