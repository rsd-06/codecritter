// Behaviour states (pure). Each state: wants() / enter / update / exit, minDuration, interruptible.
// States only write intent (face, pose, paws, props) and request effects through the Brain; the Brain
// owns springs, particles, bubbles and the PoseState.
import type { ReminderKind } from '@shared/types';
import type { Brain } from './brain';
import { agentLabel, pick, truncate } from './strings';

export type StateId =
  | 'peek'
  | 'drag'
  | 'reminder'
  | 'agentDone'
  | 'agentAlert'
  | 'hunt'
  | 'purr'
  | 'overheat'
  | 'knead'
  | 'paper'
  | 'thinking'
  | 'idle'
  | 'bored'
  | 'sleep';

/** Priority order, highest first (PLAN §3). */
export const STATE_ORDER: readonly StateId[] = [
  'peek',
  'drag',
  'reminder',
  'agentDone',
  'agentAlert',
  'hunt',
  'purr',
  'overheat',
  'knead',
  'paper',
  'thinking',
  'idle',
  'bored',
  'sleep',
];

export const BORED_AFTER_MS = 120_000;
export const SLEEP_AFTER_MS = 300_000;
export const OVERHEAT_AFTER_S = 3;
export const PAPER_ROLLBACK_AFTER_S = 4;
export const AGENT_DONE_S = 2.4;
export const AGENT_ALERT_S = 4.5;
export const PENDING_TTL_S = 8;

export interface BState {
  readonly id: StateId;
  /** seconds the state must run before something of LOWER priority (or, if not interruptible, higher) may replace it */
  readonly minDuration: number;
  readonly interruptible: boolean;
  wants(b: Brain): boolean;
  enter(b: Brain): void;
  update(dt: number, b: Brain): void;
  exit(b: Brain): void;
  /** needs ~12 fps while active */
  animates(b: Brain): boolean;
  /** seconds until the state needs a tick on its own (Infinity = nothing pending) */
  nextEvent(b: Brain): number;
}

abstract class Base implements BState {
  abstract readonly id: StateId;
  readonly minDuration: number = 0;
  readonly interruptible: boolean = true;
  abstract wants(b: Brain): boolean;
  enter(_b: Brain): void {}
  update(_dt: number, _b: Brain): void {}
  exit(_b: Brain): void {}
  animates(_b: Brain): boolean {
    return false;
  }
  nextEvent(_b: Brain): number {
    return Infinity;
  }
}

/* ---------------------------------------------------------------- peek ---- */

class Peek extends Base {
  readonly id = 'peek';
  wants(b: Brain): boolean {
    return b.peeking;
  }
  update(_dt: number, b: Brain): void {
    b.i.expression = 'sneaky';
    b.i.glance = 0.5; // peek around
  }
}

/* ---------------------------------------------------------------- drag ---- */

class Drag extends Base {
  readonly id = 'drag';
  readonly minDuration = 0.15;
  wants(b: Brain): boolean {
    return b.settings.reactions.drag && (b.dragging || b.t() < b.dizzyUntil);
  }
  update(_dt: number, b: Brain): void {
    const t = b.t();
    b.i.paws = b.dragging ? 'up' : 'down';
    if (b.dragging) {
      b.shake.tick(t);
      if (b.shake.dizzy(t)) {
        b.dizzyUntil = t + 2.5;
        b.i.expression = 'dizzy';
      } else b.i.expression = b.shake.shaking(t) ? 'annoyed' : 'excited';
    } else {
      b.i.expression = 'dizzy';
    }
    if (b.i.expression === 'dizzy' && t >= b.nextSweatAt) {
      b.emitAtHead('sweat', 20, -14);
      b.nextSweatAt = t + 0.6;
    }
  }
  animates(b: Brain): boolean {
    return b.dragging || b.i.expression === 'dizzy';
  }
  nextEvent(b: Brain): number {
    const left = b.dizzyUntil - b.t();
    return left > 0 ? Math.max(0.05, left) : Infinity;
  }
}

/* ---------------------------------------------------------------- reminder ---- */

class Reminder extends Base {
  readonly id = 'reminder';
  readonly minDuration = 1.5;
  wants(b: Brain): boolean {
    return b.reminder.kind !== null && b.t() < b.reminder.until;
  }
  update(_dt: number, b: Brain): void {
    const k: ReminderKind | null = b.reminder.kind;
    const i = b.i;
    switch (k) {
      case 'stretch':
        i.pose = 'stretch';
        i.paws = 'up';
        i.grow = 1.4;
        i.expression = 'happy';
        break;
      case 'water':
        i.paws = 'hold-cup';
        i.prop = 'cup';
        i.expression = 'happy';
        break;
      case 'message':
        i.paws = 'wave';
        i.expression = 'happy';
        break;
      case 'pomodoro-focus':
        i.expression = 'determined';
        break;
      case 'pomodoro-break':
        i.expression = 'relaxed';
        break;
      case 'pomodoro-done':
        i.paws = 'up';
        i.expression = 'proud';
        break;
      default:
        i.expression = 'happy';
    }
  }
  exit(b: Brain): void {
    b.reminder.kind = null;
  }
  animates(b: Brain): boolean {
    return b.reminder.kind === 'message';
  }
  nextEvent(b: Brain): number {
    return Math.max(0.05, b.reminder.until - b.t());
  }
}

/* ---------------------------------------------------------------- agent done / alert ---- */

class AgentDone extends Base {
  readonly id = 'agentDone';
  readonly minDuration = AGENT_DONE_S;
  readonly interruptible = false;
  wants(b: Brain): boolean {
    const t = b.t();
    return t < b.doneUntil || b.donePending(t);
  }
  enter(b: Brain): void {
    const t = b.t();
    const req = b.doneReq;
    req.pending = false;
    b.doneUntil = t + AGENT_DONE_S;
    const label = agentLabel(req.agent);
    const text = req.message
      ? truncate(req.message, 44)
      : pick(b.character, 'done', { name: b.name, agent: label }, b.rng).text;
    b.say('speech', text, 4200);
    b.hop(2);
    b.sinks.sound.jingle();
    b.burst('sparkle', 6);
  }
  update(_dt: number, b: Brain): void {
    if (b.doneReq.pending) this.enter(b); // another "done" while celebrating: celebrate again
    b.i.expression = 'proud';
    b.i.paws = 'up';
  }
  animates(b: Brain): boolean {
    return b.t() < b.doneUntil;
  }
  nextEvent(b: Brain): number {
    return Math.max(0.05, b.doneUntil - b.t());
  }
}

class AgentAlert extends Base {
  readonly id = 'agentAlert';
  readonly minDuration = 2.5;
  readonly interruptible = false;
  wants(b: Brain): boolean {
    const t = b.t();
    return t < b.alertUntil || b.alertPending(t);
  }
  enter(b: Brain): void {
    const t = b.t();
    const req = b.alertReq;
    req.pending = false;
    b.alertUntil = t + AGENT_ALERT_S;
    const label = agentLabel(req.agent);
    const text = req.message
      ? truncate(req.message, 44)
      : pick(b.character, req.error ? 'error' : 'alert', { name: b.name, agent: label }, b.rng).text;
    b.say('speech', text, 5000);
    b.sinks.sound.alert();
    b.emitAtHead('exclaim', 20, -26);
  }
  update(_dt: number, b: Brain): void {
    if (b.alertReq.pending) this.enter(b);
    b.i.expression = 'worried';
    b.i.pose = 'alert';
  }
  nextEvent(b: Brain): number {
    return Math.max(0.05, b.alertUntil - b.t());
  }
}

/* ---------------------------------------------------------------- hunt ---- */

const HUNT_CROUCH_S = 0.55;
const HUNT_POUNCE_S = 0.4;
const HUNT_END_S = 1.2;
export const HUNT_COOLDOWN_S = 6;

class Hunt extends Base {
  readonly id = 'hunt';
  readonly minDuration = HUNT_END_S;
  readonly interruptible = false;
  private dir = 1;
  private lastPhase = 0;
  wants(b: Brain): boolean {
    if (!b.settings.reactions.hunt) return false;
    return b.t() < b.huntActiveUntil || (b.huntReq.pending && b.t() < b.huntReq.until);
  }
  enter(b: Brain): void {
    b.huntReq.pending = false;
    this.dir = b.huntReq.dir || 1;
    this.lastPhase = 0;
    b.huntActiveUntil = b.t() + HUNT_END_S;
    b.sinks.sound.blip();
  }
  update(_dt: number, b: Brain): void {
    const e = b.t() - b.stateSince;
    const i = b.i;
    if (e < HUNT_CROUCH_S) {
      i.pose = 'crouch';
      i.expression = e < 0.2 ? 'surprised' : 'sneaky';
      i.wiggleX = Math.floor(e * 14) % 2 === 0 ? -1 : 1; // butt wiggle
    } else if (e < HUNT_CROUCH_S + HUNT_POUNCE_S) {
      const u = (e - HUNT_CROUCH_S) / HUNT_POUNCE_S;
      if (this.lastPhase === 0) {
        this.lastPhase = 1;
        b.sqy.vel += 2;
        b.sinks.sound.blip();
      }
      i.pose = 'pounce';
      i.expression = 'excited';
      i.slideX = this.dir * 16;
      i.offY = -Math.round(Math.sin(u * Math.PI) * 12);
    } else {
      if (this.lastPhase === 1) {
        this.lastPhase = 2;
        b.sqy.vel -= 3;
        b.sqx.vel += 2;
        b.huntReadyAt = b.t() + HUNT_COOLDOWN_S;
      }
      i.expression = 'happy';
      i.slideX = 0;
    }
  }
  exit(b: Brain): void {
    b.huntActiveUntil = 0;
    b.huntReadyAt = Math.max(b.huntReadyAt, b.t() + HUNT_COOLDOWN_S);
  }
  animates(): boolean {
    return true;
  }
}

/* ---------------------------------------------------------------- purr ---- */

class Purr extends Base {
  readonly id = 'purr';
  readonly minDuration = 2.5;
  readonly interruptible = false;
  private nextHeart = 0;
  wants(b: Brain): boolean {
    return b.settings.reactions.purr && b.t() < b.purrUntil;
  }
  enter(b: Brain): void {
    this.nextHeart = 0;
    b.sinks.sound.purr(true);
  }
  update(_dt: number, b: Brain): void {
    const t = b.t();
    b.i.expression = 'love';
    b.i.paws = 'down';
    if (t >= this.nextHeart) {
      b.emitAtHead('heart', (b.rng() - 0.5) * 24, -20, { variant: Math.floor(b.rng() * 4) });
      this.nextHeart = t + 0.55;
    }
  }
  exit(b: Brain): void {
    b.sinks.sound.purr(false);
  }
  animates(): boolean {
    return true;
  }
}

/* ---------------------------------------------------------------- overheat ---- */

class Overheat extends Base {
  readonly id = 'overheat';
  readonly minDuration = 1.5;
  private nextSteam = 0;
  wants(b: Brain): boolean {
    if (!b.settings.reactions.overheat) return false;
    // hysteresis: starts at 3 s of sustained heat, stays until the heat has drained
    return b.state === this ? b.heat > 0.05 : b.heat >= OVERHEAT_AFTER_S;
  }
  enter(): void {
    this.nextSteam = 0;
  }
  update(_dt: number, b: Brain): void {
    const t = b.t();
    b.i.expression = b.heat > 1.2 ? 'stressed' : 'worried';
    if (b.typing) b.kneadPaws();
    if (b.heat > 1.2 && t >= this.nextSteam) {
      b.emitAtHead('steam', -22, -12);
      b.emitAtHead('steam', 22, -12);
      this.nextSteam = t + 0.4;
    }
  }
  animates(): boolean {
    return true;
  }
}

/* ---------------------------------------------------------------- knead (typing) ---- */

class Knead extends Base {
  readonly id = 'knead';
  readonly minDuration = 0.4;
  wants(b: Brain): boolean {
    return b.settings.reactions.knead && b.typing;
  }
  update(_dt: number, b: Brain): void {
    b.i.expression = 'focused';
    b.kneadPaws();
  }
  animates(b: Brain): boolean {
    return b.typing;
  }
  nextEvent(b: Brain): number {
    return Math.max(0.05, b.lastKeyAt + 1.2 - b.t());
  }
}

/* ---------------------------------------------------------------- paper (scroll) ---- */

class Paper extends Base {
  readonly id = 'paper';
  readonly minDuration = 1;
  wants(b: Brain): boolean {
    return b.settings.reactions.paper && b.paper > 0.001;
  }
  update(dt: number, b: Brain): void {
    const t = b.t();
    b.i.paws = 'hold-paper';
    b.i.prop = 'paper';
    b.i.expression = 'focused';
    if (t - b.lastScrollAt > PAPER_ROLLBACK_AFTER_S) b.paper = Math.max(0, b.paper - dt * 0.5); // roll back up
  }
  animates(b: Brain): boolean {
    return b.t() - b.lastScrollAt <= PAPER_ROLLBACK_AFTER_S ? b.t() - b.lastScrollAt < 1.2 : true;
  }
  nextEvent(b: Brain): number {
    return Math.max(0.05, b.lastScrollAt + PAPER_ROLLBACK_AFTER_S - b.t());
  }
}

/* ---------------------------------------------------------------- thinking (agents) ---- */

class Thinking extends Base {
  readonly id = 'thinking';
  readonly minDuration = 1;
  private shownVersion = -1;
  private lastShown = -1e9;
  wants(b: Brain): boolean {
    return b.agents.thinkingCount > 0;
  }
  enter(): void {
    this.shownVersion = -1;
    this.lastShown = -1e9;
  }
  update(_dt: number, b: Brain): void {
    const t = b.t();
    b.i.expression = 'thinking';
    b.i.paws = 'chin';
    if (this.shownVersion !== b.agents.version || (!b.bubbleActive() && t - this.lastShown > 10)) {
      const first = this.shownVersion < 0;
      this.shownVersion = b.agents.version;
      this.lastShown = t;
      const label = b.agents.thinkingLabel();
      const text = pick(
        b.character,
        label.many ? 'thinkingMany' : 'thinking',
        label.many ? { agents: label.text } : { agent: label.text },
        b.rng,
      ).text;
      b.say('thought', text, 5000, false);
      if (first) b.emitAtHead('question', 18, -24);
    }
  }
  nextEvent(b: Brain): number {
    return Math.max(0.05, Math.min(this.lastShown + 10 - b.t(), b.agents.timeToExpiry(b.t())));
  }
}

/* ---------------------------------------------------------------- idle / bored / sleep ---- */

class Idle extends Base {
  readonly id = 'idle';
  wants(b: Brain): boolean {
    const sleepy = b.settings.reactions.sleep;
    return !(sleepy && b.idleMs >= BORED_AFTER_MS);
  }
  update(_dt: number, b: Brain): void {
    const i = b.i;
    if (b.cursorCurious()) i.expression = 'curious';
    else if (b.pomo?.phase === 'focus') i.expression = 'determined';
    else if (b.pomo) i.expression = 'relaxed';
    else i.expression = 'neutral';
  }
}

class Bored extends Base {
  readonly id = 'bored';
  readonly minDuration = 1;
  private nextYawn = 0;
  private yawnUntil = 0;
  wants(b: Brain): boolean {
    return b.settings.reactions.sleep && b.idleMs >= BORED_AFTER_MS && b.idleMs < SLEEP_AFTER_MS;
  }
  enter(b: Brain): void {
    this.nextYawn = b.t() + 2;
    this.yawnUntil = 0;
  }
  update(_dt: number, b: Brain): void {
    const t = b.t();
    if (t >= this.nextYawn) {
      this.yawnUntil = t + 1.8;
      this.nextYawn = t + 10 + b.rng() * 8;
    }
    const yawning = t < this.yawnUntil;
    b.i.expression = yawning ? 'sleepy' : 'bored';
    b.i.glance = 0.4;
  }
  exit(b: Brain): void {
    b.surprise(1);
  }
  animates(b: Brain): boolean {
    return b.t() < this.yawnUntil;
  }
  nextEvent(b: Brain): number {
    const t = b.t();
    return Math.max(0.05, t < this.yawnUntil ? this.yawnUntil - t : this.nextYawn - t);
  }
}

class Sleep extends Base {
  readonly id = 'sleep';
  readonly minDuration = 0.5;
  private nextZ = 0;
  private flip = 0;
  wants(b: Brain): boolean {
    return b.settings.reactions.sleep && b.idleMs >= SLEEP_AFTER_MS;
  }
  enter(b: Brain): void {
    this.nextZ = b.t() + 5;
  }
  update(_dt: number, b: Brain): void {
    const t = b.t();
    const e = t - b.stateSince;
    b.i.expression = 'sleepy';
    if (e > 4) {
      b.i.pose = 'sleep';
      b.i.mouth = 'neutral'; // no yawning while asleep
      // Zzz rides on breath ticks (no dedicated wake-ups) so sleeping stays <= ~1 redraw/s
      if (t >= this.nextZ) {
        b.emitAtHead('zzz', 14, -14, { variant: this.flip++ % 2 });
        this.nextZ = t + 2.4;
      }
    }
  }
  exit(b: Brain): void {
    b.surprise(1);
  }
  nextEvent(b: Brain): number {
    const e = b.t() - b.stateSince;
    return e < 4 ? 4 - e : Infinity;
  }
}

export function createStates(): BState[] {
  const all: Record<StateId, BState> = {
    peek: new Peek(),
    drag: new Drag(),
    reminder: new Reminder(),
    agentDone: new AgentDone(),
    agentAlert: new AgentAlert(),
    hunt: new Hunt(),
    purr: new Purr(),
    overheat: new Overheat(),
    knead: new Knead(),
    paper: new Paper(),
    thinking: new Thinking(),
    idle: new Idle(),
    bored: new Bored(),
    sleep: new Sleep(),
  };
  return STATE_ORDER.map((id) => all[id]);
}
