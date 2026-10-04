// Glue between the pure Brain and the DOM-side Stage + SoundEngine. Implements the scheduler's Tickable.
import type { AgentEvent, CursorSample, InputSample, PomodoroState, ReminderEvent, Settings } from '@shared/types';
import type { Tickable } from '../engine/scheduler';
import type { SoundEngine } from '../engine/sound';
import type { Stage } from '../engine/stage';
import type { ExpressionName } from '../engine/types';
import { Brain, type BrainOptions, type DebugSnapshot } from './brain';

export class OverlayDriver implements Tickable {
  readonly brain: Brain;

  constructor(
    private readonly stage: Stage,
    sound: SoundEngine,
    opts: BrainOptions = {},
  ) {
    this.brain = new Brain(
      {
        pose: stage.pose,
        head: () => stage.head,
        bubble: stage.bubble,
        particles: stage.particles,
        sound,
        setPomodoro: (v) => {
          stage.pomodoro = v;
        },
        setNote: (t) => {
          stage.note = t;
        },
      },
      opts,
    );
  }

  setWake(fn: () => void): void {
    this.brain.setWake(fn);
  }
  applySettings(s: Settings): void {
    this.brain.applySettings(s);
  }
  handleCursor(c: CursorSample): void {
    this.brain.handleCursor(c);
  }
  handleInput(s: InputSample): void {
    this.brain.handleInput(s);
  }
  handleAgent(e: AgentEvent): void {
    this.brain.handleAgent(e);
  }
  handleReminder(r: ReminderEvent): void {
    this.brain.handleReminder(r);
  }
  handlePomodoro(p: PomodoroState): void {
    this.brain.handlePomodoro(p);
  }
  handlePeek(on: boolean): void {
    this.brain.handlePeek(on);
  }
  dragStart(): void {
    this.brain.dragStart();
  }
  dragMove(dx: number, dy: number): void {
    this.brain.dragMove(dx, dy);
  }
  dragEnd(): void {
    this.brain.dragEnd();
  }
  force(name: ExpressionName, ms = 4000): void {
    this.brain.force(name, ms);
  }
  debug(): DebugSnapshot {
    return this.brain.debug();
  }

  update(dt: number): void {
    this.brain.update(dt);
  }
  render(): void {
    this.stage.render(this.brain.t());
  }
  nextDelay(): number {
    return this.brain.nextDelay();
  }
}
