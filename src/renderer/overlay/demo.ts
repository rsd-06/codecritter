// TEMPORARY demo driver: makes the overlay look alive before the behaviour layer (P2-D) exists.
// It maps bridge events -> pose/expression/bubbles/particles/sounds on a Stage. The behaviour layer
// will replace this file; everything it needs from the engine is on Stage / ExpressionBlender.
import type {
  AgentEvent,
  CursorSample,
  InputSample,
  PomodoroState,
  ReminderEvent,
  Settings,
} from '@shared/types';
import { ExpressionBlender } from './engine/expression';
import { timeToBreathChange } from './engine/breath';
import { FPS, type Tickable } from './engine/scheduler';
import type { SoundEngine } from './engine/sound';
import { Spring } from './engine/spring';
import type { Stage } from './engine/stage';
import type { ExpressionName, PawPose, PoseName, PropName } from './engine/types';
import { formatMMSS } from './engine/widgets';

const STEP = 1 / FPS;
const AGENT_LABEL: Record<string, string> = {
  'claude-code': 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  gemini: 'Gemini',
  antigravity: 'Antigravity',
  kiro: 'Kiro',
  copilot: 'Copilot',
  opencode: 'OpenCode',
  devin: 'Devin',
  generic: 'Agent',
};

const q = (v: number, step: number): number => Math.round(v / step) * step;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export class DemoDriver implements Tickable {
  readonly blender = new ExpressionBlender();
  private t = 0;
  private settings: Settings | null = null;
  private wakeFn: () => void = () => undefined;

  // inputs
  private kps = 0;
  private keyBurstUntil = 0;
  private lastKeyAt = -99;
  private overheatFor = 0;
  private idleMs = 0;
  private mouseSpeed = 0;
  private scrollUntil = 0;
  private paper = 0;
  private cursorAt = -99;
  private cursorNear = false;
  private surprisedUntil = 0;

  // reactions
  private agentThinkingUntil = 0;
  private doneUntil = 0;
  private alertUntil = 0;
  private reminder: { kind: ReminderEvent['kind']; until: number } | null = null;
  private forced: { name: ExpressionName; until: number } | null = null;
  private peeking = false;
  private pomo: PomodoroState | null = null;
  private pomoTotalMs = 0;
  private lastPomoSecond = -1;

  // physics
  private hopT = -1;
  private hopCount = 0;
  private landed = false;
  private readonly sqx = new Spring(1, 260, 11);
  private readonly sqy = new Spring(1, 260, 11);
  private readonly lean = new Spring(0, 200, 12);
  private readonly grow = new Spring(1, 120, 12);
  private readonly lookX = new Spring(0, 220, 26);
  private readonly lookY = new Spring(0, 220, 26);
  private lookTx = 0;
  private lookTy = 0;
  private glanceIn = 6;
  private glanceFor = 0;

  // drag
  private dragging = false;
  private dragVx = 0;
  private dragVy = 0;
  private lastDragDx = 0;
  private reversals: number[] = [];
  private dragDizzyUntil = 0;

  private emitTimer = 0;
  private kneadFlip = false;
  private kneadFlipAt = 0;

  constructor(
    private readonly stage: Stage,
    private readonly sound: SoundEngine,
  ) {}

  setWake(fn: () => void): void {
    this.wakeFn = fn;
  }

  /* ------------------------------------------------------------ inputs ---- */

  applySettings(s: Settings): void {
    this.settings = s;
    this.stage.note = s.pinnedNote;
    this.wakeFn();
  }

  handleCursor(c: CursorSample): void {
    const sc = this.stage.scale;
    const head = this.stage.head;
    const hx = c.winX + (head.x / 128) * c.winW;
    const hy = c.winY + (head.y / 112) * c.winH;
    const dx = c.x - hx;
    const dy = c.y - hy;
    this.cursorAt = this.t;
    const dist = Math.hypot(dx, dy);
    this.cursorNear = dist < 150 * sc;
    if (this.settings && !this.settings.reactions.eyeFollow) {
      this.lookTx = this.lookTy = 0;
    } else {
      this.lookTx = Math.tanh(dx / (110 * sc));
      this.lookTy = Math.tanh(dy / (110 * sc));
    }
    this.glanceFor = 0;
    this.updateLookQuantised();
  }

  private updateLookQuantised(): void {
    this.lookX.target = this.lookTx;
    this.lookY.target = this.lookTy;
    this.wakeFn();
  }

  handleInput(s: InputSample): void {
    this.kps = s.keysPerSec;
    if (s.keyBurst) {
      this.keyBurstUntil = this.t + 0.5;
      this.lastKeyAt = this.t;
    }
    this.idleMs = s.idleMs;
    this.mouseSpeed = s.mouseSpeed;
    if (s.mouseSpeed > 2500) this.surprisedUntil = this.t + 1.3;
    if (s.scrollDelta !== 0 && (!this.settings || this.settings.reactions.paper)) {
      this.scrollUntil = this.t + 1.6;
      this.paper = (this.paper + Math.abs(s.scrollDelta) * 0.01) % 1.0001;
    }
    this.wakeFn();
  }

  handleAgent(e: AgentEvent): void {
    const label = AGENT_LABEL[e.agent] ?? 'Agent';
    const yoda = this.stage.char.id === 'yoda';
    const name = this.settings?.userName || '';
    switch (e.type) {
      case 'thinking':
      case 'tool':
        this.agentThinkingUntil = this.t + (e.type === 'thinking' ? 20 : 8);
        if (e.type === 'thinking') {
          this.stage.bubble.show('thought', yoda ? `${label}, thinking is...` : `${label} is thinking...`, 4000);
          this.stage.particles.emit('question', this.stage.head.x + 18, this.stage.head.y - 24);
        }
        break;
      case 'done':
        this.agentThinkingUntil = 0;
        this.doneUntil = this.t + 2.4;
        this.startHop(2);
        this.sound.jingle();
        this.stage.bubble.show(
          'speech',
          yoda ? `Done, ${label} is.${name ? ` Well done, ${name}.` : ''}` : `${label} finished!${name ? ` Yay ${name}!` : ''}`,
          4200,
        );
        this.burst('sparkle', 6);
        break;
      case 'error':
      case 'attention':
        this.agentThinkingUntil = 0;
        this.alertUntil = this.t + 4;
        this.sound.alert();
        this.stage.particles.emit('exclaim', this.stage.head.x + 20, this.stage.head.y - 26);
        this.stage.bubble.show(
          'speech',
          e.message || (e.type === 'error' ? `${label} hit an error!` : `${label} needs you!`),
          5000,
        );
        break;
      case 'idle':
        this.agentThinkingUntil = 0;
        break;
    }
    this.wakeFn();
  }

  handleReminder(r: ReminderEvent): void {
    this.reminder = { kind: r.kind, until: this.t + Math.max(2, r.durationMs / 1000) };
    const text = r.text || DEFAULT_TEXT[r.kind];
    this.stage.bubble.show('speech', text, Math.max(2500, r.durationMs));
    this.sound.speak(text.length);
    if (r.kind === 'pomodoro-done') this.sound.jingle();
    if (r.kind === 'message' || r.kind === 'pomodoro-done') this.startHop(1);
    this.wakeFn();
  }

  handlePomodoro(p: PomodoroState): void {
    this.pomo = p.phase === 'idle' ? null : p;
    if (this.settings && this.pomo) {
      const pm = this.settings.pomodoro;
      const min = p.phase === 'focus' ? pm.focusMin : p.phase === 'break' ? pm.breakMin : pm.longBreakMin;
      this.pomoTotalMs = min * 60_000;
    }
    this.refreshPomodoroView();
    this.wakeFn();
  }

  handlePeek(on: boolean): void {
    this.peeking = on;
    this.wakeFn();
  }

  /** Playground helper: hold an expression for a while. */
  force(name: ExpressionName, ms = 4000): void {
    this.forced = { name, until: this.t + ms / 1000 };
    this.wakeFn();
  }

  /* ------------------------------------------------------------ drag ---- */

  dragStart(): void {
    this.dragging = true;
    this.dragVx = this.dragVy = 0;
    this.reversals = [];
    this.lastDragDx = 0;
    this.sqy.vel += 1.5; // pick-up stretch
    this.wakeFn();
  }

  dragMove(dx: number, dy: number): void {
    this.dragVx = this.dragVx * 0.6 + dx * 0.4;
    this.dragVy = this.dragVy * 0.6 + dy * 0.4;
    if (Math.abs(dx) > 3 && Math.sign(dx) !== Math.sign(this.lastDragDx) && this.lastDragDx !== 0) {
      this.reversals.push(this.t);
    }
    if (dx !== 0) this.lastDragDx = dx;
    this.reversals = this.reversals.filter((r) => this.t - r < 1.2);
    // mochi: stretch along the motion, lean opposite
    this.sqy.vel += clamp(-dy * 0.35, -3, 3);
    this.sqx.vel += clamp(dy * 0.2, -2, 2);
    this.lean.vel += clamp(-dx * 0.9, -14, 14);
    this.wakeFn();
  }

  dragEnd(): void {
    this.dragging = false;
    if (this.shake >= 6) this.dragDizzyUntil = this.t + 2.5;
    this.sqy.vel -= 3; // plop
    this.sqx.vel += 2;
    this.wakeFn();
  }

  private get shake(): number {
    return this.reversals.length;
  }

  /* ------------------------------------------------------------ helpers ---- */

  private startHop(n: number): void {
    this.hopT = 0;
    this.hopCount = n;
  }

  private burst(kind: 'sparkle' | 'heart' | 'steam', n: number): void {
    const h = this.stage.head;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.stage.particles.emit(kind, h.x + Math.cos(a) * 26, h.y - 4 + Math.sin(a) * 22, {
        vy: kind === 'sparkle' ? -4 : undefined,
        variant: i,
      });
    }
  }

  private refreshPomodoroView(): void {
    const p = this.pomo;
    if (!p) {
      this.stage.pomodoro = null;
      return;
    }
    const remaining = p.paused || p.endsAt === null ? p.remainingMs : Math.max(0, p.endsAt - Date.now());
    const total = this.pomoTotalMs || Math.max(remaining, 1);
    this.stage.pomodoro = {
      text: formatMMSS(remaining),
      progress: 1 - remaining / total,
      color: p.phase === 'focus' ? '#e0485c' : '#4fbf7a',
      paused: p.paused,
    };
    this.lastPomoSecond = Math.floor(remaining / 1000);
  }

  private get typing(): boolean {
    return this.t - this.lastKeyAt < 1.2;
  }

  /** What should the face say right now? (priority list, first match wins) */
  private chooseExpression(): ExpressionName {
    const s = this.settings;
    if (this.forced && this.t < this.forced.until) return this.forced.name;
    if (this.peeking) return 'sneaky';
    if (this.dragging) return this.shake >= 6 ? 'dizzy' : this.shake >= 3 ? 'annoyed' : 'excited';
    if (this.t < this.dragDizzyUntil) return 'dizzy';
    if (this.reminder && this.t < this.reminder.until) {
      return this.reminder.kind === 'pomodoro-break' ? 'relaxed' : this.reminder.kind === 'pomodoro-focus' ? 'determined' : 'happy';
    }
    if (this.t < this.doneUntil) return 'proud';
    if (this.t < this.alertUntil) return 'worried';
    if (this.t < this.surprisedUntil) return 'surprised';
    if (this.overheatFor > 3) return 'stressed';
    if (this.cursorNear && this.t - this.cursorAt < 2 && this.mouseSpeed > 30) return 'curious';
    if (this.t < this.agentThinkingUntil) return 'thinking';
    if (this.typing || this.t < this.scrollUntil) return 'focused';
    if (this.pomo?.phase === 'focus') return 'determined';
    if (this.pomo) return 'relaxed';
    if (s?.reactions.sleep !== false) {
      if (this.idleMs > 300_000) return 'sleepy';
      if (this.idleMs > 120_000) return 'bored';
    }
    return 'neutral';
  }

  /* ------------------------------------------------------------ sim step ---- */

  update(dt: number): void {
    this.t += dt;
    const t = this.t;
    const st = this.stage;
    const p = st.pose;
    const s = this.settings;

    // overheat accumulator
    const hot = this.kps > (s?.overheatKps ?? 8) && (!s || s.reactions.overheat);
    this.overheatFor = hot ? this.overheatFor + dt : Math.max(0, this.overheatFor - dt * 2);
    if (this.t - this.lastKeyAt > 3) this.kps = 0;

    // glance around when the cursor is not around
    if (t - this.cursorAt > 3) {
      this.glanceIn -= dt;
      if (this.glanceFor > 0) {
        this.glanceFor -= dt;
        if (this.glanceFor <= 0) {
          this.lookTx = this.lookTy = 0;
          this.updateLookQuantised();
        }
      } else if (this.glanceIn <= 0) {
        this.glanceIn = 5 + Math.random() * 7;
        this.glanceFor = 0.9;
        this.lookTx = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5);
        this.lookTy = (Math.random() - 0.5) * 0.6;
        this.updateLookQuantised();
      }
    }

    // expression
    this.blender.set(this.chooseExpression());
    this.blender.update(dt);

    // pose / paws / prop
    let pose: PoseName = 'sit';
    let paws: PawPose = 'down';
    let prop: PropName | undefined;
    let growTarget = 1;
    const expr = this.blender.current;
    const rem = this.reminder && t < this.reminder.until ? this.reminder.kind : null;
    if (!rem) this.reminder = null;

    if (expr === 'sleepy' && this.idleMs > 300_000) pose = 'sleep';
    if (this.t < this.alertUntil || expr === 'surprised') pose = 'alert';
    if (this.peeking) pose = 'crouch';
    if (rem === 'stretch') {
      pose = 'stretch';
      paws = 'up';
      growTarget = 1.38;
    } else if (rem === 'water') {
      paws = 'hold-cup';
      prop = 'cup';
    } else if (rem === 'message' || rem === 'pomodoro-done') {
      paws = 'wave';
    } else if (this.t < this.agentThinkingUntil && !this.typing && !this.dragging) {
      paws = 'chin';
    }
    if (this.dragging) paws = 'up';
    if (this.t < this.doneUntil) paws = 'up';
    if (this.typing && !rem) {
      paws = this.kneadFlip ? 'knead-L' : 'knead-R';
      if (t - this.kneadFlipAt > 0.18) {
        this.kneadFlip = !this.kneadFlip;
        this.kneadFlipAt = t;
      }
      if (s && !s.reactions.knead) paws = 'down';
    }
    if (t < this.scrollUntil && !rem) {
      prop = 'paper';
      paws = 'hold-paper';
    } else if (this.paper > 0) {
      this.paper = Math.max(0, this.paper - dt * 0.5);
    }

    // hop (done / message)
    let offsetY = 0;
    if (this.hopT >= 0) {
      this.hopT += dt;
      const dur = 0.5;
      const u = (this.hopT % dur) / dur;
      const idx = Math.floor(this.hopT / dur);
      if (idx >= this.hopCount) {
        this.hopT = -1;
        this.sqy.vel -= 3;
        this.sqx.vel += 2;
      } else {
        offsetY = -Math.round(14 * 4 * u * (1 - u));
        if (u > 0.93 && !this.landed) {
          this.landed = true;
          this.sqy.vel -= 2.5;
          this.sqx.vel += 1.5;
        }
        if (u < 0.2) this.landed = false;
        if (u < 0.45) pose = 'pounce';
      }
    }

    // springs
    this.grow.target = growTarget;
    for (const sp of [this.sqx, this.sqy, this.lean, this.grow, this.lookX, this.lookY]) sp.step(dt);
    this.sqx.target = this.sqy.target = 1;
    this.lean.target = 0;

    // particles
    this.emitTimer -= dt;
    if (this.emitTimer <= 0) {
      const h = st.head;
      if (expr === 'love') {
        st.particles.emit('heart', h.x + (Math.random() - 0.5) * 24, h.y - 20, { variant: Math.floor(Math.random() * 4) });
        this.emitTimer = 0.55;
        this.sound.purr(true);
      } else if (expr === 'stressed') {
        for (const side of [-1, 1]) st.particles.emit('steam', h.x + side * 22, h.y - 12);
        this.emitTimer = 0.4;
      } else if (pose === 'sleep') {
        st.particles.emit('zzz', h.x + 14, h.y - 14, { variant: Math.floor(t) % 2 });
        this.emitTimer = 1.6;
      } else if (expr === 'dizzy' && Math.random() < 0.5) {
        st.particles.emit('sweat', h.x + 20, h.y - 14);
        this.emitTimer = 0.6;
      } else {
        this.emitTimer = 0.2;
      }
    }
    if (expr !== 'love') this.sound.purr(false);
    st.particles.update(dt);
    st.bubble.update(dt);

    // pomodoro widget refresh once per second
    if (this.pomo) {
      const rm = this.pomo.paused || this.pomo.endsAt === null ? this.pomo.remainingMs : this.pomo.endsAt - Date.now();
      if (Math.floor(Math.max(0, rm) / 1000) !== this.lastPomoSecond) this.refreshPomodoroView();
    }

    // write pose state (quantised so unchanged frames can be skipped)
    p.pose = pose;
    p.paws = paws;
    p.prop = prop;
    p.propProgress = this.paper;
    p.expression = expr;
    p.mouth = undefined;
    p.eyes.open = this.blender.eyeOpen;
    p.eyes.lookX = q(this.lookX.value, 0.25);
    p.eyes.lookY = q(this.lookY.value, 0.25);
    p.squashX = q(this.sqx.value, 0.04);
    p.squashY = q(this.sqy.value, 0.04);
    p.scale = q(this.grow.value, 0.05);
    p.offsetX = Math.round(this.lean.value * 0.4);
    p.offsetY = offsetY;
    p.tint =
      this.overheatFor > 3
        ? { color: '#ff3b30', amount: 0.28 + 0.12 * (Math.floor(t * 4) % 2) }
        : undefined;
  }

  /* ------------------------------------------------------------ Tickable ---- */

  private get animating(): boolean {
    const st = this.stage;
    return (
      st.particles.activeCount > 0 ||
      st.bubble.animating ||
      this.hopT >= 0 ||
      this.dragging ||
      this.blender.blinking ||
      !this.sqx.settled ||
      !this.sqy.settled ||
      !this.lean.settled ||
      !this.grow.settled ||
      !this.lookX.settled ||
      !this.lookY.settled ||
      st.pose.paws === 'wave' ||
      this.typing ||
      this.t < this.scrollUntil ||
      this.overheatFor > 3
    );
  }

  nextDelay(): number {
    if (this.animating) return STEP;
    const p = this.stage.pose;
    let d = Math.min(this.blender.nextChangeIn, timeToBreathChange(p.pose, this.t), this.stage.bubble.timeToChange);
    if (this.glanceFor > 0) d = Math.min(d, this.glanceFor);
    else if (this.t - this.cursorAt > 3) d = Math.min(d, this.glanceIn);
    for (const e of [this.forced?.until, this.reminder?.until, this.doneUntil, this.alertUntil, this.agentThinkingUntil, this.surprisedUntil]) {
      if (e !== undefined && e > this.t) d = Math.min(d, e - this.t);
    }
    if (this.pomo && !this.pomo.paused) d = Math.min(d, 1);
    // idle -> bored -> sleepy thresholds are driven by idleMs samples (events wake us)
    return Math.max(STEP, d);
  }

  render(): void {
    this.stage.render(this.t);
  }

  /** Debug snapshot for tests. */
  debug(): Record<string, unknown> {
    return {
      t: this.t,
      expression: this.blender.current,
      animating: this.animating,
      shake: this.shake,
      overheatFor: this.overheatFor,
      pose: { ...this.stage.pose },
    };
  }
}

const DEFAULT_TEXT: Record<ReminderEvent['kind'], string> = {
  stretch: 'Time to stretch!',
  water: 'Drink some water!',
  message: 'Hello!',
  'pomodoro-focus': 'Focus time. You can do it!',
  'pomodoro-break': 'Break time. Relax a little.',
  'pomodoro-done': 'All cycles done. Great job!',
};
