import { DEFAULT_SETTINGS } from '@shared/defaults';
import type { AgentEvent, CursorSample, InputSample, Settings } from '@shared/types';
import { describe, expect, it } from 'vitest';
import { FixedStepper } from '../engine/spring';
import { defaultPoseState } from '../engine/types';
import { AgentTracker } from './agents';
import { Brain, type Sinks } from './brain';
import { PettingDetector, ReversalCounter } from './detectors';
import { STRINGS, format, pick, stripName, truncate, type StringKey } from './strings';

/* ------------------------------------------------------------------ harness */

function seeded(seed = 7): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function rig(patch: Partial<Settings> = {}, hour = 12) {
  let T = 1000;
  let EP = 1_700_000_000_000;
  let H = hour;
  const log = {
    bubbles: [] as { kind: string; text: string }[],
    emits: [] as string[],
    sounds: [] as string[],
    pomodoro: [] as unknown[],
    note: '',
  };
  const pose = defaultPoseState();
  const bubbleState = { active: false };
  const sinks: Sinks = {
    pose,
    head: () => ({ x: 64, y: 76 }),
    bubble: {
      show: (kind, text) => {
        log.bubbles.push({ kind, text });
        bubbleState.active = true;
      },
      update: () => undefined,
      animating: false,
      timeToChange: Infinity,
      get active() {
        return bubbleState.active;
      },
    },
    particles: {
      emit: (kind) => {
        log.emits.push(kind);
      },
      update: () => undefined,
      fastCount: 0,
    },
    sound: {
      speak: () => log.sounds.push('speak'),
      jingle: () => log.sounds.push('jingle'),
      alert: () => log.sounds.push('alert'),
      purr: (on) => log.sounds.push(on ? 'purr-on' : 'purr-off'),
      blip: () => log.sounds.push('blip'),
    },
    setPomodoro: (v) => log.pomodoro.push(v),
    setNote: (t) => {
      log.note = t;
    },
  };
  const settings: Settings = { ...DEFAULT_SETTINGS, userName: 'Sam', ...patch };
  const brain = new Brain(sinks, { now: () => T, epoch: () => EP, hour: () => H, rng: seeded(), settings });
  const advance = (sec: number): void => {
    let left = sec;
    while (left > 1e-9) {
      const dt = Math.min(1 / 12, left);
      T += dt;
      EP += dt * 1000;
      brain.update(dt);
      left -= dt;
    }
  };
  /** One scheduler tick the way engine/scheduler.ts does it: real time passes, capped fixed steps run. */
  const stepper = new FixedStepper(1 / 12, 6);
  let stepperInit = false;
  const tick = (realSec: number): void => {
    if (!stepperInit) {
      stepper.reset(T);
      stepperInit = true;
    }
    T += realSec;
    EP += realSec * 1000;
    const n = stepper.advance(T);
    for (let k = 0; k < n; k++) brain.update(stepper.step);
  };
  const input = (s: Partial<InputSample> = {}): void =>
    brain.handleInput({ keysPerSec: 0, keyBurst: false, scrollDelta: 0, mouseSpeed: 0, idleMs: 0, ...s });
  /** type at `kps` for `sec` seconds, sending a 10 Hz sample like main does */
  const type = (sec: number, kps = 5): void => {
    for (let n = 0; n < Math.round(sec * 10); n++) {
      input({ keysPerSec: kps, keyBurst: true });
      advance(0.1);
    }
  };
  const cursor = (x: number, y: number): void =>
    brain.handleCursor({ x, y, winX: 0, winY: 0, winW: 256, winH: 224 } as CursorSample);
  const agent = (type: AgentEvent['type'], extra: Partial<AgentEvent> = {}): void =>
    brain.handleAgent({ agent: 'claude-code', type, ts: 0, ...extra });
  return {
    brain,
    log,
    pose,
    sinks,
    advance,
    tick,
    input,
    type,
    cursor,
    agent,
    setHour: (h: number) => (H = h),
    clock: () => ({ T, EP }),
  };
}

const lastBubble = (r: ReturnType<typeof rig>): string => r.log.bubbles[r.log.bubbles.length - 1]?.text ?? '';

/* ------------------------------------------------------------------ strings */

describe('strings', () => {
  const chars = ['stitch', 'yoda'] as const;
  const keys = Object.keys(STRINGS.stitch) as StringKey[];

  it('has 3+ variants for every key and character', () => {
    for (const c of chars) {
      expect(Object.keys(STRINGS[c]).sort()).toEqual([...keys].sort());
      for (const k of keys) expect(STRINGS[c][k].length).toBeGreaterThanOrEqual(3);
    }
  });

  it('personalises with the name and falls back gracefully when empty', () => {
    for (const c of chars) {
      for (const k of keys) {
        for (const tpl of STRINGS[c][k]) {
          const named = format(tpl, { name: 'Sudharshan', agent: 'Claude', agents: 'Claude + Codex', version: '0.2.1' });
          expect(named).not.toMatch(/[{}]/);
          const blank = format(tpl, { name: '', agent: 'Claude', agents: 'Claude + Codex', version: '0.2.1' });
          expect(blank).not.toMatch(/[{}]/);
          expect(blank).not.toMatch(/\s{2}|\s[,.!?]|^[\s,.!?]/);
          expect(blank[0]).toBe(blank[0]!.toUpperCase());
          expect(blank.length).toBeGreaterThan(3);
        }
      }
    }
  });

  it('uses Yoda-speak for Yoda and playful lines for Stitch', () => {
    expect(format('Stretch, {name}, you must.', { name: 'Ana' })).toBe('Stretch, Ana, you must.');
    expect(stripName('Stretch, {name}, you must.')).toBe('Stretch, you must.');
    expect(stripName('{name}! Stretch time!')).toBe('Stretch time!');
    expect(stripName('Hey {name}, reach for the sky!')).toBe('Hey, reach for the sky!');
    const y = STRINGS.yoda.stretch.join(' ');
    expect(y).toMatch(/you must|you should|you will/i);
    expect(STRINGS.stitch.stretch.join(' ')).toMatch(/Ohana|Stretch time/);
    const p = pick('yoda', 'water', { name: 'Ana' }, () => 0);
    expect(p.text).toBe('Drink water you should, hmm.');
  });

  it('truncates long agent messages', () => {
    const t = truncate('x'.repeat(100), 20);
    expect(t.length).toBe(20);
    expect(t.endsWith('...')).toBe(true);
    expect(truncate('  short   one ', 20)).toBe('short one');
  });
});

/* ------------------------------------------------------------------ detectors */

describe('detectors', () => {
  it('ReversalCounter counts only large direction changes inside the window', () => {
    const c = new ReversalCounter(5, 1.5);
    let t = 0;
    for (const x of [0, 10, 0, 10, 0]) c.push(x, (t += 0.2));
    expect(c.count(t)).toBe(3);
    c.push(1, (t += 0.2)); // tiny jitter does not count
    expect(c.count(t)).toBe(3);
    expect(c.count(t + 2)).toBe(0); // window expired
  });

  it('PettingDetector needs the cursor over the head', () => {
    const p = new PettingDetector();
    let t = 0;
    let hit = false;
    for (const x of [-12, 12, -12, 12, -12]) hit = p.push(x, 0, (t += 0.15));
    expect(hit).toBe(true);
    const far = new PettingDetector();
    hit = false;
    for (const x of [-12, 12, -12, 12, -12]) hit = far.push(x + 80, 0, (t += 0.15));
    expect(hit).toBe(false);
  });
});

/* ------------------------------------------------------------------ agent sessions */

describe('AgentTracker', () => {
  it('tracks concurrent sessions and labels them', () => {
    const a = new AgentTracker();
    a.event('claude-code', 'thinking', 's1', 0);
    a.event('claude-code', 'tool', 's2', 1);
    a.event('codex', 'thinking', undefined, 2);
    expect(a.thinkingCount).toBe(3);
    expect(a.thinkingLabel()).toEqual({ text: 'Claude x2 + Codex', many: true });
    a.event('claude-code', 'done', 's1', 3);
    expect(a.thinkingCount).toBe(2);
    a.event('claude-code', 'attention', 's2', 4); // waiting for the user, not thinking
    expect(a.thinkingCount).toBe(1);
    a.event('codex', 'done', undefined, 5);
    expect(a.thinkingCount).toBe(0);
  });

  it('session-less end event closes all sessions of that agent; 30 min timeout', () => {
    const a = new AgentTracker();
    a.event('cursor', 'thinking', 'a', 0);
    a.event('cursor', 'thinking', 'b', 0);
    a.event('cursor', 'idle', undefined, 1);
    expect(a.sessionCount).toBe(0);
    a.event('kiro', 'thinking', 'x', 10);
    a.prune(10 + 29 * 60);
    expect(a.thinkingCount).toBe(1);
    a.prune(10 + 31 * 60);
    expect(a.thinkingCount).toBe(0);
  });

  it('never grows beyond its pool', () => {
    const a = new AgentTracker();
    for (let n = 0; n < 100; n++) a.event('generic', 'thinking', `s${n}`, n);
    expect(a.sessionCount).toBeLessThanOrEqual(24);
  });
});

/* ------------------------------------------------------------------ state machine */

describe('Brain: priorities and interruptions', () => {
  it('starts idle with eye-follow pupils toward the cursor', () => {
    const r = rig();
    r.advance(0.5);
    expect(r.brain.stateId).toBe('idle');
    r.cursor(250, 150); // right of the head (head centre = 128,152 screen px)
    r.advance(1);
    expect(r.pose.eyes.lookX).toBeGreaterThan(0.5);
    r.cursor(0, 152);
    r.advance(1);
    expect(r.pose.eyes.lookX).toBeLessThan(-0.5);
  });

  it('eye follow can be switched off', () => {
    const r = rig({ reactions: { ...DEFAULT_SETTINGS.reactions, eyeFollow: false } });
    r.cursor(250, 150);
    r.advance(1);
    expect(r.pose.eyes.lookX).toBe(0);
  });

  it('typing kneads with alternating paws and a focused face', () => {
    const r = rig();
    r.type(0.3);
    expect(r.brain.stateId).toBe('knead');
    expect(r.brain.i.expression).toBe('focused');
    const seen = new Set<string>();
    for (let n = 0; n < 12; n++) {
      r.type(0.1);
      seen.add(r.pose.paws);
    }
    expect(seen.has('knead-L') && seen.has('knead-R')).toBe(true);
    r.advance(2); // stops typing
    expect(r.brain.stateId).toBe('idle');
  });

  it('knead respects the reactions toggle', () => {
    const r = rig({ reactions: { ...DEFAULT_SETTINGS.reactions, knead: false } });
    r.type(1);
    expect(r.brain.stateId).not.toBe('knead');
  });

  it('follows the full priority order', () => {
    const r = rig();
    r.advance(0.2);
    r.agent('thinking');
    r.advance(1.2);
    expect(r.brain.stateId).toBe('thinking');
    r.type(0.3); // knead > thinking
    expect(r.brain.stateId).toBe('knead');
    r.brain.handleReminder({ kind: 'water', text: '', durationMs: 6000 }); // reminder > knead
    r.advance(0.1);
    expect(r.brain.stateId).toBe('reminder');
    r.brain.dragStart(); // drag > reminder
    r.advance(0.3);
    expect(r.brain.stateId).toBe('drag');
    r.brain.handlePeek(true); // peek > drag
    r.advance(0.3);
    expect(r.brain.stateId).toBe('peek');
    r.brain.handlePeek(false);
    r.brain.dragEnd();
    r.advance(8);
    expect(['idle', 'thinking']).toContain(r.brain.stateId);
  });

  it('agentDone cannot be cut short by lower priority states, but yields to reminders after its minimum', () => {
    const r = rig();
    r.agent('done');
    r.advance(0.2);
    expect(r.brain.stateId).toBe('agentDone');
    r.type(1); // knead is lower priority
    expect(r.brain.stateId).toBe('agentDone');
    r.brain.handleReminder({ kind: 'stretch', text: '', durationMs: 5000 });
    r.advance(0.3);
    expect(r.brain.stateId).toBe('agentDone'); // not interruptible inside its min duration
    r.advance(1.5);
    expect(r.brain.stateId).toBe('reminder');
  });

  it('a held-back agent alert fires once the higher state ends', () => {
    const r = rig();
    r.brain.dragStart();
    r.advance(0.3);
    r.agent('attention');
    r.advance(1);
    expect(r.brain.stateId).toBe('drag');
    r.brain.dragEnd();
    r.advance(0.5);
    expect(r.brain.stateId).toBe('agentAlert');
    expect(r.log.sounds).toContain('alert');
  });
});

describe('Brain: reminder queue', () => {
  it('stretch + water in the same tick show one after the other, ~6 s apart', () => {
    const r = rig();
    r.brain.handleReminder({ kind: 'stretch', text: '', durationMs: 6000 });
    r.brain.handleReminder({ kind: 'water', text: '', durationMs: 6000 });
    expect(r.log.bubbles.length).toBe(1);
    r.advance(3);
    expect(r.log.bubbles.length).toBe(1);
    expect(r.brain.reminder.kind).toBe('stretch');
    r.advance(3.5);
    expect(r.log.bubbles.length).toBe(2);
    expect(r.brain.reminder.kind).toBe('water');
    r.advance(10);
    expect(r.log.bubbles.length).toBe(2);
  });

  it('drops same-kind duplicates and caps the queue at 3', () => {
    const r = rig();
    const ev = (kind: 'stretch' | 'water' | 'message' | 'pomodoro-focus' | 'pomodoro-break', text = '') =>
      r.brain.handleReminder({ kind, text, durationMs: 4000 });
    ev('stretch');
    ev('stretch'); // dup of the one showing
    ev('water');
    ev('water'); // dup in queue
    ev('message', 'a');
    ev('pomodoro-focus');
    ev('pomodoro-break'); // 5th: queue (water, message, focus) is full
    r.advance(40);
    expect(r.log.bubbles.length).toBe(4);
  });

  it('a queued reminder still shows while peeking', () => {
    const r = rig();
    r.brain.handlePeek(true);
    r.brain.handleReminder({ kind: 'stretch', text: '', durationMs: 3000 });
    r.brain.handleReminder({ kind: 'water', text: '', durationMs: 3000 });
    r.advance(4);
    expect(r.log.bubbles.length).toBe(2);
  });
});

describe('Brain: reminders', () => {
  it('stretch grows the character by 1.4x and shows a personalised bubble', () => {
    const r = rig();
    r.brain.handleReminder({ kind: 'stretch', text: '', durationMs: 6000 });
    r.advance(1.5);
    expect(r.brain.stateId).toBe('reminder');
    expect(r.pose.pose).toBe('stretch');
    expect(r.pose.paws).toBe('up');
    expect(r.pose.scale).toBeGreaterThan(1.3);
    expect(r.pose.scale).toBeLessThanOrEqual(1.5);
    expect(lastBubble(r)).toContain('Sam');
    r.advance(8);
    expect(r.brain.stateId).toBe('idle');
    r.advance(2);
    expect(r.pose.scale).toBeCloseTo(1, 1);
  });

  it('water holds a cup, message uses its own text with a chirp', () => {
    const r = rig();
    r.brain.handleReminder({ kind: 'water', text: '', durationMs: 5000 });
    r.advance(0.3);
    expect(r.pose.prop).toBe('cup');
    expect(r.pose.paws).toBe('hold-cup');
    r.advance(6);
    r.brain.handleReminder({ kind: 'message', text: 'Standup in 5!', durationMs: 4000 });
    r.advance(0.2);
    expect(lastBubble(r)).toBe('Standup in 5!');
    expect(r.log.sounds).toContain('speak');
  });

  it('pomodoro kinds map to determined / relaxed / proud', () => {
    const r = rig();
    r.brain.handleReminder({ kind: 'pomodoro-focus', text: '', durationMs: 4000 });
    r.advance(0.2);
    expect(r.brain.i.expression).toBe('determined');
    r.advance(5);
    r.brain.handleReminder({ kind: 'pomodoro-break', text: '', durationMs: 4000 });
    r.advance(0.2);
    expect(r.brain.i.expression).toBe('relaxed');
    r.advance(5);
    r.brain.handleReminder({ kind: 'pomodoro-done', text: '', durationMs: 4000 });
    r.advance(0.2);
    expect(r.brain.i.expression).toBe('proud');
    expect(r.log.sounds).toContain('jingle');
  });

  it('Yoda gets Yoda-speak', () => {
    const r = rig({ character: 'yoda' });
    r.brain.handleReminder({ kind: 'water', text: '', durationMs: 4000 });
    expect(lastBubble(r)).toMatch(/water|Water|Hydrate|Thirsty/);
    expect(lastBubble(r)).toMatch(/you|hmm|Hmm|Sam/);
  });

  it('pomodoro widget follows the pomodoro state and idle mood', () => {
    const r = rig();
    r.brain.handlePomodoro({
      phase: 'focus',
      endsAt: r.clock().EP + 25 * 60_000,
      remainingMs: 25 * 60_000,
      cycle: 1,
      paused: false,
    });
    r.advance(0.3);
    expect(r.brain.i.expression).toBe('determined');
    expect(r.log.pomodoro.length).toBeGreaterThan(0);
    r.brain.handlePomodoro({ phase: 'break', endsAt: null, remainingMs: 5 * 60_000, cycle: 1, paused: true });
    r.advance(0.3);
    expect(r.brain.i.expression).toBe('relaxed');
    r.brain.handlePomodoro({ phase: 'idle', endsAt: null, remainingMs: 0, cycle: 0, paused: false });
    expect(r.log.pomodoro[r.log.pomodoro.length - 1]).toBeNull();
  });
});

describe('Brain: agents', () => {
  it('thinking stays until done, shows the agent label, then celebrates', () => {
    const r = rig();
    r.agent('thinking');
    r.advance(1.5);
    expect(r.brain.stateId).toBe('thinking');
    expect(r.pose.paws).toBe('chin');
    expect(lastBubble(r)).toContain('Claude');
    r.advance(120);
    expect(r.brain.stateId).toBe('thinking');
    r.input({ idleMs: 0 }); // the user came back
    r.agent('done');
    r.advance(0.3);
    expect(r.brain.stateId).toBe('agentDone');
    expect(lastBubble(r)).toContain('Claude');
    expect(r.log.sounds).toContain('jingle');
    r.advance(5);
    expect(r.brain.stateId).toBe('idle');
  });

  it('done uses (truncated) event.message when present', () => {
    const r = rig();
    r.agent('done', { message: 'Refactored the whole thing and all tests are passing now, nice work everyone!' });
    r.advance(0.2);
    expect(lastBubble(r).endsWith('...')).toBe(true);
    expect(lastBubble(r).length).toBeLessThanOrEqual(44);
  });

  it('attention/error -> worried + alert sound + "needs you"', () => {
    const r = rig();
    r.agent('attention');
    r.advance(0.2);
    expect(r.brain.stateId).toBe('agentAlert');
    expect(r.brain.i.expression).toBe('worried');
    expect(lastBubble(r)).toMatch(/Claude/);
    expect(r.log.sounds).toContain('alert');
    expect(r.log.emits).toContain('exclaim');
  });

  it('tracks concurrent sessions: thinking stays until the last one ends', () => {
    const r = rig();
    r.agent('thinking', { session: 'a' });
    r.agent('thinking', { agent: 'codex', session: 'b' });
    r.advance(1.5);
    expect(lastBubble(r)).toMatch(/Claude \+ Codex/);
    r.agent('idle', { session: 'a' });
    r.advance(1.5);
    expect(r.brain.stateId).toBe('thinking');
    r.agent('idle', { agent: 'codex', session: 'b' });
    r.advance(1.5);
    expect(r.brain.stateId).toBe('idle');
  });

  it('thinking times out after 30 minutes without events', () => {
    const r = rig();
    r.input({ idleMs: 0 });
    r.agent('thinking');
    r.advance(29 * 60);
    expect(r.brain.stateId).toBe('thinking');
    r.advance(2 * 60 + 10);
    expect(r.brain.agents.thinkingCount).toBe(0);
    expect(r.brain.stateId).not.toBe('thinking');
  });

  it('ignores agent visuals while peeking', () => {
    const r = rig();
    r.brain.handlePeek(true);
    r.agent('done');
    r.advance(1);
    expect(r.brain.stateId).toBe('peek');
    expect(r.log.sounds).not.toContain('jingle');
  });
});

describe('Brain: overheat', () => {
  it('needs 3 s of sustained keys/sec, ramps tint, steams, then cools down', () => {
    const r = rig();
    r.type(2.5, 9);
    expect(r.brain.stateId).not.toBe('overheat');
    expect(r.pose.tint?.amount ?? 0).toBeGreaterThan(0); // tint already ramping
    r.type(1, 9);
    expect(r.brain.stateId).toBe('overheat');
    expect(r.brain.i.expression).toBe('stressed');
    r.type(2, 9);
    expect(r.log.emits).toContain('steam');
    const hot = r.pose.tint?.amount ?? 0;
    expect(hot).toBeGreaterThan(0.25);
    r.advance(6); // stop typing: heat drains
    expect(r.brain.stateId).not.toBe('overheat');
    expect(r.pose.tint).toBeUndefined();
  });

  it('keys below the threshold never overheat; toggle respected', () => {
    const r = rig();
    r.type(6, 7);
    expect(r.brain.stateId).toBe('knead');
    const off = rig({ reactions: { ...DEFAULT_SETTINGS.reactions, overheat: false } });
    off.type(5, 12);
    expect(off.brain.stateId).toBe('knead');
  });

  it('honours a custom threshold', () => {
    const r = rig({ overheatKps: 4 });
    r.type(3.5, 5);
    expect(r.brain.stateId).toBe('overheat');
  });
});

describe('Brain: drag, shake and dizzy', () => {
  const shake = (r: ReturnType<typeof rig>, sec: number): void => {
    for (let n = 0; n < Math.round(sec * 10); n++) {
      r.brain.dragMove(n % 2 ? 18 : -18, 0);
      r.advance(0.1);
    }
  };

  it('dragging is excited, quick shaking annoyed, sustained shaking dizzy', () => {
    const r = rig();
    r.brain.dragStart();
    r.advance(0.3);
    expect(r.brain.stateId).toBe('drag');
    expect(r.brain.i.expression).toBe('excited');
    for (let n = 0; n < 5; n++) {
      r.brain.dragMove(20, 4); // steady movement: no shake
      r.advance(0.1);
    }
    expect(r.brain.i.expression).toBe('excited');
    shake(r, 1);
    expect(r.brain.i.expression).toBe('annoyed');
    shake(r, 2.2);
    expect(r.brain.i.expression).toBe('dizzy');
    r.brain.dragEnd();
    r.advance(1);
    expect(r.brain.stateId).toBe('drag'); // lingers dizzy after the drop
    expect(r.brain.i.expression).toBe('dizzy');
    r.advance(4);
    expect(r.brain.stateId).toBe('idle');
  });

  it('a short shake that stops does not get dizzy', () => {
    const r = rig();
    r.brain.dragStart();
    shake(r, 1.2);
    r.brain.dragMove(0, 0);
    r.advance(1.5);
    expect(r.brain.i.expression).not.toBe('dizzy');
    r.brain.dragEnd();
    r.advance(3);
    expect(r.brain.stateId).toBe('idle');
  });

  it('squash/stretch values are quantised to whole pixel multiples', () => {
    const r = rig();
    r.brain.dragStart();
    for (let n = 0; n < 8; n++) {
      r.brain.dragMove(10, -14);
      r.advance(0.08);
      expect(Math.round(r.pose.squashY * 32) / 32).toBeCloseTo(r.pose.squashY, 8);
      expect(Math.round(r.pose.scale * 32) / 32).toBeCloseTo(r.pose.scale, 8);
    }
  });
});

describe('Brain: hunt', () => {
  it('a fast cursor flick near the character crouches, pounces, then has a cooldown', () => {
    const r = rig();
    r.advance(0.2);
    r.cursor(60, 100);
    r.advance(0.03);
    r.cursor(200, 140); // ~140 px in 30 ms: very fast, close to the head
    r.advance(0.1);
    expect(r.brain.stateId).toBe('hunt');
    expect(r.pose.pose).toBe('crouch');
    r.advance(0.6);
    expect(r.pose.pose).toBe('pounce');
    expect(r.pose.offsetX).toBeGreaterThan(3); // pounced toward the cursor (right)
    r.advance(1.5);
    expect(r.brain.stateId).toBe('idle');
    // cooldown: another flick right away does not trigger
    r.cursor(60, 100);
    r.advance(0.03);
    r.cursor(200, 140);
    r.advance(0.3);
    expect(r.brain.stateId).not.toBe('hunt');
    r.advance(7);
    r.cursor(60, 100);
    r.advance(0.03);
    r.cursor(200, 140);
    r.advance(0.2);
    expect(r.brain.stateId).toBe('hunt');
  });

  it('slow cursor, far cursor or disabled toggle do not hunt', () => {
    const slow = rig();
    for (let x = 60; x < 200; x += 3) {
      slow.cursor(x, 120);
      slow.advance(0.033);
    }
    expect(slow.brain.stateId).not.toBe('hunt');
    const far = rig();
    far.cursor(1000, 100);
    far.advance(0.03);
    far.cursor(1400, 100);
    far.advance(0.2);
    expect(far.brain.stateId).not.toBe('hunt');
    const off = rig({ reactions: { ...DEFAULT_SETTINGS.reactions, hunt: false } });
    off.cursor(60, 100);
    off.advance(0.03);
    off.cursor(200, 140);
    off.advance(0.2);
    expect(off.brain.stateId).not.toBe('hunt');
  });
});

describe('Brain: petting / purr', () => {
  const rub = (r: ReturnType<typeof rig>, dx: number, n: number): void => {
    for (let k = 0; k < n; k++) {
      r.cursor(128 + (k % 2 ? dx : -dx), 150);
      r.advance(0.12);
    }
  };

  it('rubbing back and forth over the head -> love, hearts, purr sound', () => {
    const r = rig();
    r.advance(0.2);
    rub(r, 14, 6);
    expect(r.brain.stateId).toBe('purr');
    expect(r.brain.i.expression).toBe('love');
    expect(r.log.emits).toContain('heart');
    expect(r.log.sounds).toContain('purr-on');
    r.advance(5);
    expect(r.brain.stateId).toBe('idle');
    expect(r.log.sounds).toContain('purr-off');
  });

  it('moving across the head in one direction is not petting; cursor elsewhere is not petting', () => {
    const r = rig();
    for (let x = 90; x < 170; x += 6) {
      r.cursor(x, 150);
      r.advance(0.05);
    }
    expect(r.brain.stateId).not.toBe('purr');
    const far = rig();
    rub(far, 14, 8);
    far.cursor(600, 600);
    const e = rig();
    for (let k = 0; k < 8; k++) {
      e.cursor(300 + (k % 2 ? 14 : -14), 150);
      e.advance(0.12);
    }
    expect(e.brain.stateId).not.toBe('purr');
  });

  it('purr toggle is respected', () => {
    const r = rig({ reactions: { ...DEFAULT_SETTINGS.reactions, purr: false } });
    rub(r, 14, 8);
    expect(r.brain.stateId).not.toBe('purr');
  });
});

describe('Brain: paper', () => {
  it('scroll unspools the paper proportional to the scroll, rolls back after 4 s', () => {
    const r = rig();
    r.input({ scrollDelta: 3 });
    r.advance(0.3);
    expect(r.brain.stateId).toBe('paper');
    expect(r.pose.prop).toBe('paper');
    expect(r.pose.paws).toBe('hold-paper');
    const small = r.pose.propProgress ?? 0;
    for (let n = 0; n < 6; n++) {
      r.input({ scrollDelta: 4 });
      r.advance(0.1);
    }
    expect(r.pose.propProgress ?? 0).toBeGreaterThan(small);
    r.advance(3);
    expect(r.brain.stateId).toBe('paper'); // still holding it
    const before = r.pose.propProgress ?? 0;
    r.advance(1.5); // > 4 s since last scroll: rolling back
    expect(r.pose.propProgress ?? 0).toBeLessThan(before);
    r.advance(4);
    expect(r.brain.stateId).toBe('idle');
    expect(r.pose.prop).toBeUndefined();
  });

  it('toggle respected', () => {
    const r = rig({ reactions: { ...DEFAULT_SETTINGS.reactions, paper: false } });
    r.input({ scrollDelta: 5 });
    r.advance(0.5);
    expect(r.brain.stateId).not.toBe('paper');
  });
});

describe('Brain: idle -> bored -> sleep -> wake', () => {
  it('extrapolates idleMs between samples and walks through bored and sleep', () => {
    const r = rig();
    r.input({ idleMs: 0 });
    r.advance(100);
    expect(r.brain.idleMs).toBeGreaterThan(99_000);
    expect(r.brain.stateId).toBe('idle');
    r.advance(25); // 125 s
    expect(r.brain.stateId).toBe('bored');
    expect(['bored', 'sleepy']).toContain(r.brain.i.expression);
    r.advance(120); // 245 s
    expect(r.brain.stateId).toBe('bored');
    r.advance(60); // 305 s
    expect(r.brain.stateId).toBe('sleep');
    expect(r.brain.i.expression).toBe('sleepy');
    r.advance(6);
    expect(r.pose.pose).toBe('sleep');
    r.advance(10);
    expect(r.log.emits).toContain('zzz');
    // any input wakes with a surprised blink
    r.input({ idleMs: 0, mouseSpeed: 40 });
    r.advance(0.2);
    expect(r.brain.stateId).toBe('idle');
    expect(r.brain.i.expression).toBe('surprised');
    r.advance(2.5);
    expect(r.brain.i.expression).toBe('neutral');
  });

  it('respects the sleep reaction toggle', () => {
    const r = rig({ reactions: { ...DEFAULT_SETTINGS.reactions, sleep: false } });
    r.input({ idleMs: 400_000 });
    r.advance(3);
    expect(r.brain.stateId).toBe('idle');
  });

  it('heartbeat samples with a large idleMs keep sleeping', () => {
    const r = rig();
    r.input({ idleMs: 310_000 });
    r.advance(2);
    expect(r.brain.stateId).toBe('sleep');
    r.input({ idleMs: 320_000 });
    r.advance(2);
    expect(r.brain.stateId).toBe('sleep');
  });
});

describe('Brain: curious, surprised, late night, peek', () => {
  it('moving cursor near the character -> curious', () => {
    const r = rig();
    r.cursor(200, 160);
    r.advance(0.1);
    r.cursor(206, 164);
    r.advance(0.2);
    expect(r.brain.i.expression).toBe('curious');
    r.advance(3);
    expect(r.brain.i.expression).toBe('neutral');
  });

  it('very fast global mouse -> surprised', () => {
    const r = rig();
    r.input({ mouseSpeed: 4000 });
    r.advance(0.2);
    expect(r.brain.i.expression).toBe('surprised');
  });

  it('late night typing shows a bedtime bubble once per hour', () => {
    const r = rig({}, 23);
    r.type(1);
    const first = r.log.bubbles.filter((b) => /bed|Bed|Sleep|sleep|late|Late/.test(b.text)).length;
    expect(first).toBe(1);
    expect(r.brain.i.expression).toBe('sleepy');
    r.type(10);
    expect(r.log.bubbles.filter((b) => /bed|Bed|Sleep|sleep|late|Late/.test(b.text)).length).toBe(1);
    r.advance(3600);
    r.type(1);
    expect(r.log.bubbles.filter((b) => /bed|Bed|Sleep|sleep|late|Late/.test(b.text)).length).toBe(2);
  });

  it('no bedtime nudge during the day, and forceHour toggles it', () => {
    const r = rig({}, 14);
    r.type(2);
    expect(r.log.bubbles.length).toBe(0);
    r.brain.forceHour(2);
    r.type(1);
    expect(r.log.bubbles.length).toBe(1);
  });

  it('peek hides the pinned note and restores it afterwards', () => {
    const r = rig();
    r.brain.applySettings({ ...DEFAULT_SETTINGS, pinnedNote: 'ship it' });
    expect(r.log.note).toBe('ship it');
    r.brain.handlePeek(true);
    expect(r.log.note).toBe('');
    r.brain.applySettings({ ...DEFAULT_SETTINGS, pinnedNote: 'ship it too' });
    expect(r.log.note).toBe('');
    r.brain.handlePeek(false);
    expect(r.log.note).toBe('ship it too');
  });

  it('peek: sneaky, head pushed to the screen edge, reminders still show', () => {
    const r = rig();
    r.brain.handlePeek(true);
    r.advance(2);
    expect(r.brain.stateId).toBe('peek');
    expect(r.brain.i.expression).toBe('sneaky');
    expect(r.pose.peek).toBeGreaterThanOrEqual(0.9);
    expect(r.pose.peekEdge).toBe('bottom');
    r.brain.handleReminder({ kind: 'water', text: '', durationMs: 4000 });
    expect(r.log.bubbles.length).toBe(1);
    r.advance(0.3);
    expect(r.brain.stateId).toBe('peek');
    r.brain.handlePeek(false);
    r.advance(3);
    expect(r.pose.peek).toBe(0);
    expect(r.brain.stateId).toBe('idle');
  });

  it('pinned note is pushed to the stage on settings change', () => {
    const r = rig();
    r.brain.applySettings({ ...DEFAULT_SETTINGS, pinnedNote: 'ship it' });
    expect(r.log.note).toBe('ship it');
  });
});

/* ------------------------------------------------------------------ efficiency */

describe('Brain: nextDelay drives a low redraw rate', () => {
  /** Simulates the Scheduler: tick, ask for the next delay, jump there (>= 1/12 s). */
  const redrawsPerSecond = (r: ReturnType<typeof rig>, sec: number, keepAwake = false): number => {
    let ticks = 0;
    let t = 0;
    while (t < sec) {
      const nd = r.brain.nextDelay();
      const d = Number.isFinite(nd) ? Math.min(5, Math.max(nd, 1 / 12 - 0.001)) : 5;
      r.tick(d);
      if (keepAwake) r.input({ idleMs: 0 });
      t += d;
      ticks++;
    }
    return ticks / sec;
  };

  it('idle costs <= 2 redraws/s', () => {
    const r = rig();
    r.input({ idleMs: 0 });
    r.advance(1);
    const rate = redrawsPerSecond(r, 90);
    expect(rate).toBeLessThanOrEqual(2);
  });

  it('sleeping costs <= 1 redraw/s', () => {
    const r = rig();
    r.input({ idleMs: 400_000 });
    r.advance(10);
    expect(r.brain.stateId).toBe('sleep');
    const rate = redrawsPerSecond(r, 90);
    expect(rate).toBeLessThanOrEqual(1);
  });

  it('animating states run at ~12 fps', () => {
    const r = rig();
    r.type(0.5);
    expect(r.brain.nextDelay()).toBeCloseTo(1 / 12, 3);
  });
});
