// The behaviour brain: pure TS (no DOM). Consumes bridge events, runs the priority state machine and
// writes a PoseState + effect requests (bubble, particles, sound) through `Sinks`.
// All time is read from an injectable clock so tests can drive it with a fake one.
import { DEFAULT_SETTINGS } from '@shared/defaults';
import type {
  AgentEvent,
  CharacterId,
  CursorSample,
  InputSample,
  PomodoroState,
  ReminderEvent,
  ReminderKind,
  Settings,
} from '@shared/types';
import { timeToBreathChange } from '../engine/breath';
import { ExpressionBlender } from '../engine/expression';
import type { BubbleKind } from '../engine/bubble';
import type { ParticleKind } from '../engine/particles';
import { Spring } from '../engine/spring';
import {
  type ExpressionName,
  type MouthName,
  type PawPose,
  type PoseName,
  type PoseState,
  type PropName,
  STAGE_H,
  STAGE_W,
} from '../engine/types';
import { formatMMSS, type PomodoroView } from '../engine/widgets';
import { AgentTracker } from './agents';
import { PettingDetector, ShakeDetector } from './detectors';
import { pick, truncate } from './strings';
import { STATE_ORDER, PENDING_TTL_S, createStates, type BState, type StateId } from './states';

const STEP = 1 / 12;
const SESSION_PRUNE_S = 5;

/** Cursor tuning (logical stage px unless noted). */
export const NEAR_LOGICAL = 75; // "curious" radius (= 150 screen px at 2x)
export const HUNT_SPEED_LOGICAL = 600; // cursor speed (logical px/s)
export const HUNT_NEAR_LOGICAL = 110;
export const FAST_MOUSE_PX_S = 2500; // global mouse speed -> surprised
export const KEY_ACTIVE_S = 1.2;
export const PEEK_OFFSET_Y = 24;
const STALE_KPS_S = 2.5;

/** Effects the brain asks the host to perform. Stage + SoundEngine satisfy this structurally. */
export interface Sinks {
  pose: PoseState;
  head(): { x: number; y: number };
  bubble: {
    show(kind: BubbleKind, text: string, ttlMs: number): void;
    update(dt: number): void;
    readonly animating: boolean;
    readonly timeToChange: number;
    readonly active: boolean;
  };
  particles: {
    emit(
      kind: ParticleKind,
      x: number,
      y: number,
      opts?: { vx?: number; vy?: number; life?: number; variant?: number },
    ): void;
    update(dt: number): void;
    /** active particles that need frames (everything except slow Zzz) */
    readonly fastCount: number;
  };
  sound: {
    speak(len?: number): void;
    jingle(): void;
    alert(): void;
    purr(on: boolean): void;
    blip(): void;
  };
  setPomodoro(v: PomodoroView | null): void;
  setNote(text: string): void;
}

export interface BrainOptions {
  /** monotonic seconds */
  now?: () => number;
  /** wall-clock epoch milliseconds (pomodoro, late-night key) */
  epoch?: () => number;
  /** local hour 0-23 */
  hour?: () => number;
  rng?: () => number;
  settings?: Settings;
}

/** What the active state wants this frame; reset every tick. */
export interface Intent {
  expression: ExpressionName;
  pose: PoseName;
  paws: PawPose;
  prop: PropName | undefined;
  grow: number;
  /** extra vertical px (hunt pounce arc) */
  offY: number;
  /** horizontal wiggle px */
  wiggleX: number;
  /** spring target for horizontal slide (hunt pounce) */
  slideX: number;
  mouth: MouthName | undefined;
  /** glance interval multiplier (<1 = look around more) */
  glance: number;
}

const resetIntent = (i: Intent): void => {
  i.expression = 'neutral';
  i.pose = 'sit';
  i.paws = 'down';
  i.prop = undefined;
  i.grow = 1;
  i.offY = 0;
  i.wiggleX = 0;
  i.slideX = 0;
  i.mouth = undefined;
  i.glance = 1;
};

const q = (v: number, step: number): number => Math.round(v / step) * step;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export interface DebugSnapshot {
  state: StateId;
  expression: ExpressionName;
  animating: boolean;
  heat: number;
  shake: number;
  paper: number;
  thinking: number;
  sessions: number;
  idleMs: number;
  pose: PoseState;
}

export class Brain {
  readonly intent: Intent = {
    expression: 'neutral',
    pose: 'sit',
    paws: 'down',
    prop: undefined,
    grow: 1,
    offY: 0,
    wiggleX: 0,
    slideX: 0,
    mouth: undefined,
    glance: 1,
  };
  readonly i = this.intent;
  readonly blender: ExpressionBlender;
  readonly agents = new AgentTracker();
  readonly shake = new ShakeDetector();
  private readonly petting = new PettingDetector();
  private readonly states: BState[] = createStates();
  private readonly byId = new Map<StateId, BState>(this.states.map((s) => [s.id, s]));
  private readonly rank = new Map<StateId, number>(STATE_ORDER.map((id, n) => [id, n]));
  private readonly knead = this.rankOf('knead');
  state: BState;
  stateSince = 0;
  readonly rng: () => number;
  private readonly nowFn: () => number;
  private readonly epochFn: () => number;
  private readonly hourFn: () => number;
  private wakeFn: () => void = () => undefined;

  settings: Settings;
  character: CharacterId;

  /* ---- input */
  private lastInput: InputSample | null = null;
  private lastInputAt: number;
  lastKeyAt = -1e9;
  lastScrollAt = -1e9;
  paper = 0;
  heat = 0;
  private fastMouseSeen = 0;

  /* ---- cursor */
  private cursorAt = -1e9;
  private cursorMovedAt = -1e9;
  private cursorX = 0;
  private cursorY = 0;
  private cursorHave = false;
  private cursorDist = Infinity;
  private cursorSpeed = 0;
  private lookTx = 0;
  private lookTy = 0;
  private glanceIn = 6;
  private glanceFor = 0;
  private pxPerLogical = 2;

  /* ---- requests / timers read by states */
  peeking = false;
  dragging = false;
  dizzyUntil = 0;
  nextSweatAt = 0;
  purrUntil = 0;
  huntActiveUntil = 0;
  huntReadyAt = 0;
  huntReq = { pending: false, until: 0, dir: 1 };
  doneUntil = 0;
  doneReq = { pending: false, until: 0, agent: 'generic', message: '' };
  alertUntil = 0;
  alertReq = { pending: false, until: 0, agent: 'generic', message: '', error: false };
  reminder: { kind: ReminderKind | null; until: number } = { kind: null, until: 0 };
  pomo: PomodoroState | null = null;
  private pomoTotalMs = 0;
  private lastPomoSecond = -1;
  private surprisedUntil = 0;
  private nudgeUntil = 0;
  private nextNudgeCheck = 0;
  private lastNudgeKey = -1;
  private hourOverride: number | null = null;
  private forced: { name: ExpressionName; until: number } | null = null;
  private nextPrune = SESSION_PRUNE_S;

  /* ---- physics */
  readonly sqx = new Spring(1, 260, 11);
  readonly sqy = new Spring(1, 260, 11);
  readonly lean = new Spring(0, 200, 12);
  readonly growSpring = new Spring(1, 120, 12);
  readonly peekSpring = new Spring(0, 110, 18);
  private readonly lookX = new Spring(0, 220, 26);
  private readonly lookY = new Spring(0, 220, 26);
  private hopT = -1;
  private hopCount = 0;
  private landed = false;
  private kneadFlip = false;
  private kneadFlipAt = 0;
  private lastUpdate: number;
  private readonly tint = { color: '#ff3b30', amount: 0 };

  constructor(
    readonly sinks: Sinks,
    opts: BrainOptions = {},
  ) {
    this.nowFn = opts.now ?? ((): number => performance.now() / 1000);
    this.epochFn = opts.epoch ?? ((): number => Date.now());
    this.hourFn = opts.hour ?? ((): number => new Date().getHours());
    this.rng = opts.rng ?? Math.random;
    this.settings = opts.settings ?? DEFAULT_SETTINGS;
    this.character = this.settings.character;
    this.blender = new ExpressionBlender(this.rng);
    const t = this.nowFn();
    this.lastUpdate = t;
    this.lastInputAt = t;
    this.state = this.byId.get('idle')!;
    this.stateSince = t;
    this.glanceIn = 4 + this.rng() * 6;
    this.shake.reset();
    this.petting.reset();
  }

  private rankOf(id: StateId): number {
    return STATE_ORDER.indexOf(id);
  }

  /** Monotonic seconds (the brain's clock). */
  t(): number {
    return this.nowFn();
  }

  get name(): string {
    return this.settings.userName.trim();
  }

  setWake(fn: () => void): void {
    this.wakeFn = fn;
  }

  /** Extrapolated: main goes quiet when idle, so idleMs keeps growing between samples. */
  get idleMs(): number {
    const s = this.lastInput;
    const base = s ? s.idleMs : 0;
    return base + (this.t() - this.lastInputAt) * 1000;
  }

  get kps(): number {
    const s = this.lastInput;
    return s && this.t() - this.lastInputAt <= STALE_KPS_S ? s.keysPerSec : 0;
  }

  get typing(): boolean {
    return this.t() - this.lastKeyAt < KEY_ACTIVE_S;
  }

  bubbleActive(): boolean {
    return this.sinks.bubble.active;
  }

  epochNowS(): number {
    return this.epochFn() / 1000;
  }

  /* ------------------------------------------------------------ settings ---- */

  applySettings(s: Settings): void {
    this.settings = s;
    this.character = s.character;
    this.sinks.setNote(s.pinnedNote);
    if (!s.reactions.eyeFollow) {
      this.lookTx = this.lookTy = 0;
      this.pushLook();
    }
    this.wakeFn();
  }

  /* ------------------------------------------------------------ cursor ---- */

  handleCursor(c: CursorSample): void {
    const t = this.t();
    const ppl = c.winW > 0 ? c.winW / STAGE_W : 2;
    this.pxPerLogical = ppl;
    const head = this.sinks.head();
    const hx = c.winX + head.x * ppl;
    const hy = c.winY + head.y * (c.winH > 0 ? c.winH / STAGE_H : ppl);
    const dx = c.x - hx;
    const dy = c.y - hy;
    const dist = Math.hypot(dx, dy) / ppl;
    this.cursorDist = dist;

    // cursor speed (logical px/s), smoothed
    if (this.cursorHave) {
      const dtS = t - this.cursorAt;
      const moved = Math.hypot(c.x - this.cursorX, c.y - this.cursorY);
      if (moved > 2) this.cursorMovedAt = t;
      if (dtS > 0.005) {
        const inst = moved / ppl / dtS;
        this.cursorSpeed = dtS > 0.5 ? inst : this.cursorSpeed * 0.4 + inst * 0.6;
      }
    }
    this.cursorHave = true;
    this.cursorX = c.x;
    this.cursorY = c.y;
    this.cursorAt = t;

    // eye follow
    if (this.settings.reactions.eyeFollow) {
      this.lookTx = Math.tanh(dx / (55 * ppl));
      this.lookTy = Math.tanh(dy / (55 * ppl));
    } else {
      this.lookTx = this.lookTy = 0;
    }
    this.glanceFor = 0;
    this.pushLook();

    // petting: cursor rubbing back and forth over the head
    if (this.settings.reactions.purr && this.petting.push(dx / ppl, dy / ppl, t)) this.purrUntil = t + 1.5;

    // hunt: fast cursor near the character
    if (
      this.settings.reactions.hunt &&
      !this.peeking &&
      !this.dragging &&
      t >= this.huntReadyAt &&
      this.cursorSpeed > HUNT_SPEED_LOGICAL &&
      dist < HUNT_NEAR_LOGICAL &&
      !(this.state.id === 'hunt')
    ) {
      this.huntReq.pending = true;
      this.huntReq.until = t + 1;
      this.huntReq.dir = dx >= 0 ? 1 : -1;
    }
    this.wakeFn();
  }

  private pushLook(): void {
    this.lookX.target = this.lookTx;
    this.lookY.target = this.lookTy;
  }

  /** Cursor close to the character and moving: "curious". */
  cursorCurious(): boolean {
    const t = this.t();
    return this.cursorHave && this.cursorDist < NEAR_LOGICAL && t - this.cursorMovedAt < 2 && t - this.cursorAt < 2;
  }

  /* ------------------------------------------------------------ input ---- */

  handleInput(s: InputSample): void {
    const t = this.t();
    this.lastInput = s;
    this.lastInputAt = t;
    if (s.keyBurst) this.lastKeyAt = t;
    if (s.mouseSpeed > FAST_MOUSE_PX_S) this.surprise(1.3);
    if (s.scrollDelta !== 0 && this.settings.reactions.paper) {
      this.lastScrollAt = t;
      this.paper = clamp(this.paper + Math.abs(s.scrollDelta) * 0.03, 0, 1);
    }
    this.wakeFn();
  }

  surprise(sec: number): void {
    this.surprisedUntil = Math.max(this.surprisedUntil, this.t() + sec);
  }

  /* ------------------------------------------------------------ agents ---- */

  handleAgent(e: AgentEvent): void {
    const t = this.t();
    this.agents.event(e.agent, e.type, e.session, t);
    if (this.peeking) {
      this.wakeFn();
      return; // peek mode: reminders only
    }
    if (e.type === 'done') {
      const r = this.doneReq;
      r.pending = true;
      r.until = t + PENDING_TTL_S;
      r.agent = e.agent;
      r.message = e.message ?? '';
    } else if (e.type === 'error' || e.type === 'attention') {
      const r = this.alertReq;
      r.pending = true;
      r.until = t + PENDING_TTL_S;
      r.agent = e.agent;
      r.message = e.message ?? '';
      r.error = e.type === 'error';
    }
    this.wakeFn();
  }

  donePending(t: number): boolean {
    return this.doneReq.pending && t < this.doneReq.until;
  }

  alertPending(t: number): boolean {
    return this.alertReq.pending && t < this.alertReq.until;
  }

  /* ------------------------------------------------------------ reminders / pomodoro / peek ---- */

  handleReminder(r: ReminderEvent): void {
    const t = this.t();
    let text: string;
    switch (r.kind) {
      case 'message':
        text = r.text ? truncate(r.text, 80) : pick(this.character, 'message', { name: this.name }, this.rng).text;
        break;
      case 'stretch':
      case 'water':
        text = pick(this.character, r.kind, { name: this.name }, this.rng).text;
        break;
      case 'pomodoro-focus':
        text = pick(this.character, 'pomodoroFocus', { name: this.name }, this.rng).text;
        break;
      case 'pomodoro-break':
        text = pick(this.character, 'pomodoroBreak', { name: this.name }, this.rng).text;
        break;
      default:
        text = pick(this.character, 'pomodoroDone', { name: this.name }, this.rng).text;
    }
    // reminders always show a bubble, even while peeking
    this.say('speech', text, Math.max(2500, r.durationMs));
    if (r.kind === 'pomodoro-done') this.sinks.sound.jingle();
    if (!this.peeking) {
      this.reminder.kind = r.kind;
      this.reminder.until = t + Math.max(2.5, r.durationMs / 1000);
      if (r.kind === 'message' || r.kind === 'pomodoro-done') this.hop(1);
    }
    this.wakeFn();
  }

  handlePomodoro(p: PomodoroState): void {
    this.pomo = p.phase === 'idle' ? null : p;
    if (this.pomo) {
      const pm = this.settings.pomodoro;
      const min = p.phase === 'focus' ? pm.focusMin : p.phase === 'break' ? pm.breakMin : pm.longBreakMin;
      this.pomoTotalMs = min * 60_000;
    }
    this.refreshPomodoroView();
    this.wakeFn();
  }

  handlePeek(on: boolean): void {
    this.peeking = on;
    if (on) {
      this.reminder.kind = null;
      this.dragging = false;
    }
    this.peekSpring.target = on ? PEEK_OFFSET_Y : 0;
    this.wakeFn();
  }

  /** Playground helper: hold an expression for a while. */
  force(name: ExpressionName, ms = 4000): void {
    this.forced = { name, until: this.t() + ms / 1000 };
    this.wakeFn();
  }

  /** Playground / tests: pretend it is `hour` o'clock (null = real clock). */
  forceHour(hour: number | null): void {
    this.hourOverride = hour;
    this.lastNudgeKey = -1;
    this.nextNudgeCheck = 0;
  }

  /* ------------------------------------------------------------ drag ---- */

  dragStart(): void {
    this.dragging = true;
    this.shake.reset();
    this.dizzyUntil = 0;
    this.sqy.vel += 1.5; // pick-up stretch
    this.wakeFn();
  }

  dragMove(dx: number, dy: number): void {
    this.shake.move(dx, dy, this.t());
    // mochi: stretch along the motion, lean opposite
    this.sqy.vel += clamp(-dy * 0.35, -3, 3);
    this.sqx.vel += clamp(dy * 0.2, -2, 2);
    this.lean.vel += clamp(-dx * 0.9, -14, 14);
    this.wakeFn();
  }

  dragEnd(): void {
    const t = this.t();
    if (this.shake.dizzy(t)) this.dizzyUntil = t + 2.5;
    this.dragging = false;
    this.sqy.vel -= 3; // plop
    this.sqx.vel += 2;
    this.wakeFn();
  }

  /* ------------------------------------------------------------ effects used by states ---- */

  say(kind: BubbleKind, text: string, ms: number, voice = true): void {
    this.sinks.bubble.show(kind, text, ms);
    if (voice) this.sinks.sound.speak(text.length);
  }

  emitAtHead(
    kind: ParticleKind,
    ox: number,
    oy: number,
    opts?: { vx?: number; vy?: number; life?: number; variant?: number },
  ): void {
    const h = this.sinks.head();
    this.sinks.particles.emit(kind, h.x + ox, h.y + oy, opts);
  }

  burst(kind: 'sparkle' | 'heart', n: number): void {
    const h = this.sinks.head();
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      this.sinks.particles.emit(kind, h.x + Math.cos(a) * 26, h.y - 4 + Math.sin(a) * 22, {
        vy: kind === 'sparkle' ? -4 : undefined,
        variant: k,
      });
    }
  }

  hop(n: number): void {
    this.hopT = 0;
    this.hopCount = n;
  }

  /** Alternate knead paws at a cadence that follows typing speed. */
  kneadPaws(): void {
    const t = this.t();
    const kps = Math.max(this.kps, 2);
    const interval = clamp(1 / (kps * 1.2), 0.14, 0.4);
    if (t - this.kneadFlipAt >= interval) {
      this.kneadFlip = !this.kneadFlip;
      this.kneadFlipAt = t;
    }
    this.i.paws = this.kneadFlip ? 'knead-L' : 'knead-R';
  }

  /* ------------------------------------------------------------ state machine ---- */

  private select(t: number): void {
    let cand: BState = this.state;
    for (const s of this.states) {
      if (s.wants(this)) {
        cand = s;
        break;
      }
    }
    const cur = this.state;
    if (cand === cur) return;
    const elapsed = t - this.stateSince;
    const candRank = this.rank.get(cand.id)!;
    const curRank = this.rank.get(cur.id)!;
    let ok: boolean;
    if (candRank < curRank) ok = cur.interruptible || elapsed >= cur.minDuration;
    else ok = !cur.wants(this) && elapsed >= cur.minDuration;
    if (!ok) return;
    cur.exit(this);
    this.state = cand;
    this.stateSince = t;
    cand.enter(this);
  }

  /** current state id */
  get stateId(): StateId {
    return this.state.id;
  }

  /* ------------------------------------------------------------ simulation ---- */

  update(dt: number): void {
    const t = this.t();
    const rt = clamp(t - this.lastUpdate, 0, 2);
    this.lastUpdate = t;
    const s = this.settings;
    const sp = this.sinks.pose;

    // heat accumulates while keys/sec stay at/above the threshold
    const hot = s.reactions.overheat && this.kps >= s.overheatKps && this.typing;
    this.heat = hot ? Math.min(5, this.heat + dt) : Math.max(0, this.heat - dt * 1.5);

    if (t >= this.nextPrune) {
      this.agents.prune(t);
      this.nextPrune = t + SESSION_PRUNE_S;
    }
    if (!this.dragging) this.shake.tick(t);

    this.select(t);
    resetIntent(this.i);
    this.state.update(dt, this);
    const i = this.i;
    const rk = this.rank.get(this.state.id)!;
    const low = rk >= this.knead;

    // late-night nudge (typing between 23:00 and 05:00, once per hour)
    this.lateNight(t);
    if (low && t < this.nudgeUntil) i.expression = 'sleepy';
    // surprise (very fast mouse, waking up): short alert blink for calm states
    if (low && this.state.id !== 'sleep' && t < this.surprisedUntil) {
      i.expression = 'surprised';
      if (this.state.id === 'idle' || this.state.id === 'bored') i.pose = 'alert';
    }
    if (this.forced) {
      if (t < this.forced.until) i.expression = this.forced.name;
      else this.forced = null;
    }

    this.blender.set(i.expression);
    const asleep = i.pose === 'sleep';
    this.blender.update(dt, !asleep);

    // glance around when the cursor is not around (or far/still)
    if (!asleep && (t - this.cursorAt > 3 || !this.settings.reactions.eyeFollow)) {
      this.glanceIn -= dt;
      if (this.glanceFor > 0) {
        this.glanceFor -= dt;
        if (this.glanceFor <= 0) {
          this.lookTx = this.lookTy = 0;
          this.pushLook();
        }
      } else if (this.glanceIn <= 0) {
        this.glanceIn = (5 + this.rng() * 7) * i.glance;
        this.glanceFor = 0.9;
        this.lookTx = (this.rng() < 0.5 ? -1 : 1) * (0.5 + this.rng() * 0.5);
        this.lookTy = (this.rng() - 0.5) * 0.6;
        this.pushLook();
      }
    }

    // hop (done / message / pounce landing)
    let hopY = 0;
    if (this.hopT >= 0) {
      this.hopT += dt;
      const dur = 0.5;
      const u = (this.hopT % dur) / dur;
      if (Math.floor(this.hopT / dur) >= this.hopCount) {
        this.hopT = -1;
        this.sqy.vel -= 3;
        this.sqx.vel += 2;
      } else {
        hopY = -Math.round(14 * 4 * u * (1 - u));
        if (u > 0.93 && !this.landed) {
          this.landed = true;
          this.sqy.vel -= 2.5;
          this.sqx.vel += 1.5;
        }
        if (u < 0.2) this.landed = false;
        if (u < 0.45 && i.pose === 'sit') i.pose = 'pounce';
      }
    }

    // springs
    this.growSpring.target = i.grow;
    this.lean.target = i.slideX;
    this.peekSpring.target = this.peeking ? PEEK_OFFSET_Y : 0;
    this.sqx.step(dt);
    this.sqy.step(dt);
    this.lean.step(dt);
    this.growSpring.step(dt);
    this.peekSpring.step(dt);
    this.lookX.step(dt);
    this.lookY.step(dt);
    this.sqx.target = this.sqy.target = 1;

    // purr loop must stop whenever we are not purring
    // (Purr.exit handles it; this guards against forced state changes)
    this.sinks.particles.update(rt);
    this.sinks.bubble.update(rt);

    // pomodoro widget refresh once per second
    if (this.pomo) {
      const rm = this.pomodoroRemaining();
      if (Math.floor(Math.max(0, rm) / 1000) !== this.lastPomoSecond) this.refreshPomodoroView();
    }

    // tint ramps with heat (starts before the overheat state kicks in)
    const tintAmount = this.heat > 1 ? q(Math.min(0.4, ((this.heat - 1) / 4) * 0.4), 0.04) : 0;
    this.tint.amount = tintAmount + (this.heat >= 3 ? 0.08 * (Math.floor(t * 4) % 2) : 0);

    // write the PoseState (quantised so unchanged frames compare equal)
    sp.pose = i.pose;
    sp.paws = i.paws;
    sp.prop = i.prop;
    sp.propProgress = this.paper;
    sp.expression = this.blender.current;
    sp.mouth = i.mouth;
    sp.eyes.open = this.blender.eyeOpen;
    sp.eyes.lookX = q(this.lookX.value, 0.25);
    sp.eyes.lookY = q(this.lookY.value, 0.25);
    sp.squashX = q(this.sqx.value, 1 / 32);
    sp.squashY = q(this.sqy.value, 1 / 32);
    sp.scale = q(this.growSpring.value, 1 / 32);
    sp.offsetX = Math.round(this.lean.value + i.wiggleX);
    sp.offsetY = hopY + i.offY + Math.round(this.peekSpring.value);
    sp.tint = this.tint.amount > 0 ? this.tint : undefined;
  }

  private lateNight(t: number): void {
    if (!this.typing || t < this.nextNudgeCheck) return;
    this.nextNudgeCheck = t + 5;
    const h = this.hourOverride ?? this.hourFn();
    if (h < 23 && h >= 5) return;
    const key = Math.floor(this.epochFn() / 3_600_000);
    if (key === this.lastNudgeKey || this.peeking) return;
    this.lastNudgeKey = key;
    this.nudgeUntil = t + 4;
    const text = pick(this.character, 'bedtime', { name: this.name }, this.rng).text;
    this.say('speech', text, 4500);
  }

  private pomodoroRemaining(): number {
    const p = this.pomo!;
    return p.paused || p.endsAt === null ? p.remainingMs : Math.max(0, p.endsAt - this.epochFn());
  }

  private refreshPomodoroView(): void {
    const p = this.pomo;
    if (!p) {
      this.sinks.setPomodoro(null);
      return;
    }
    const remaining = this.pomodoroRemaining();
    const total = this.pomoTotalMs || Math.max(remaining, 1);
    this.sinks.setPomodoro({
      text: formatMMSS(remaining),
      progress: clamp(1 - remaining / total, 0, 1),
      color: p.phase === 'focus' ? '#e0485c' : '#4fbf7a',
      paused: p.paused,
    });
    this.lastPomoSecond = Math.floor(remaining / 1000);
  }

  /* ------------------------------------------------------------ Tickable ---- */

  /** Needs ~12 fps right now. */
  get animating(): boolean {
    const sk = this.sinks;
    return (
      this.dragging ||
      this.hopT >= 0 ||
      this.blender.blinking ||
      sk.bubble.animating ||
      sk.particles.fastCount > 0 ||
      !this.sqx.settled ||
      !this.sqy.settled ||
      !this.lean.settled ||
      !this.growSpring.settled ||
      !this.peekSpring.settled ||
      !this.lookX.settled ||
      !this.lookY.settled ||
      this.heat > 0.3 ||
      this.state.animates(this)
    );
  }

  /** Seconds until the next tick is needed (STEP while animating). */
  nextDelay(): number {
    if (this.animating) return STEP;
    const t = this.t();
    const p = this.sinks.pose;
    let d = Math.min(this.blender.nextChangeIn, timeToBreathChange(p.pose, t) + 0.015, this.sinks.bubble.timeToChange);
    if (p.pose === 'sleep') {
      // eyes shut: no glances
    } else if (this.glanceFor > 0) d = Math.min(d, this.glanceFor);
    else if (t - this.cursorAt > 3 || !this.settings.reactions.eyeFollow) d = Math.min(d, this.glanceIn);
    else d = Math.min(d, 3 - (t - this.cursorAt) + 0.05); // cursor goes stale -> glances start
    for (const e of [
      this.forced?.until,
      this.reminder.kind ? this.reminder.until : undefined,
      this.surprisedUntil,
      this.nudgeUntil,
      this.dizzyUntil,
      this.doneUntil,
      this.alertUntil,
      this.purrUntil,
      this.huntActiveUntil,
    ]) {
      if (e !== undefined && e > t) d = Math.min(d, e - t);
    }
    // pending requests that a busy higher state is holding back
    if (this.doneReq.pending || this.alertReq.pending || this.huntReq.pending) d = Math.min(d, 0.25);
    d = Math.min(d, this.state.nextEvent(this));
    if (this.pomo && !this.pomo.paused) d = Math.min(d, 1);
    if (this.settings.reactions.sleep) {
      const idle = this.idleMs;
      if (idle < 120_000) d = Math.min(d, (120_000 - idle) / 1000 + 0.05);
      else if (idle < 300_000) d = Math.min(d, (300_000 - idle) / 1000 + 0.05);
    }
    return Math.max(STEP, d);
  }

  debug(): DebugSnapshot {
    return {
      state: this.state.id,
      expression: this.blender.current,
      animating: this.animating,
      heat: this.heat,
      shake: this.shake.count(this.t()),
      paper: this.paper,
      thinking: this.agents.thinkingCount,
      sessions: this.agents.sessionCount,
      idleMs: Math.round(this.idleMs),
      pose: { ...this.sinks.pose },
    };
  }
}
