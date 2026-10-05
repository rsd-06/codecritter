// Real bridge (window.critter from the preload) or a MockBridge for the browser playground.
import { DEFAULT_SETTINGS } from '@shared/defaults';
import type {
  AgentEvent,
  CursorSample,
  InputSample,
  OverlayBridge,
  PomodoroState,
  ReminderEvent,
  Settings,
} from '@shared/types';
import { TauriBridge, isTauriRuntime } from '../tauri-bridge';

type Handler<T> = (v: T) => void;

export interface MockLog {
  interactive: boolean[];
  dragStart: number;
  dragMoves: [number, number][];
  dragEnd: number;
  openSettings: number;
  contextMenu: number;
}

/** EventTarget-based fake of the preload bridge with emit helpers for the playground / tests. */
export class MockBridge implements OverlayBridge {
  private bus = new EventTarget();
  settings: Settings = structuredClone(DEFAULT_SETTINGS);
  readonly log: MockLog = {
    interactive: [],
    dragStart: 0,
    dragMoves: [],
    dragEnd: 0,
    openSettings: 0,
    contextMenu: 0,
  };
  /** hooks so the playground can move its fake overlay window */
  onDragMove: ((dx: number, dy: number) => void) | null = null;
  onInteractive: ((on: boolean) => void) | null = null;

  private on<T>(type: string, cb: Handler<T>): () => void {
    const h = (e: Event) => cb((e as CustomEvent<T>).detail);
    this.bus.addEventListener(type, h);
    return () => this.bus.removeEventListener(type, h);
  }
  private emit<T>(type: string, detail: T): void {
    this.bus.dispatchEvent(new CustomEvent(type, { detail }));
  }

  onInput = (cb: Handler<InputSample>) => this.on('input', cb);
  onCursor = (cb: Handler<CursorSample>) => this.on('cursor', cb);
  onAgent = (cb: Handler<AgentEvent>) => this.on('agent', cb);
  onReminder = (cb: Handler<ReminderEvent>) => this.on('reminder', cb);
  onPomodoro = (cb: Handler<PomodoroState>) => this.on('pomodoro', cb);
  onSettings = (cb: Handler<Settings>) => this.on('settings', cb);
  onPeek = (cb: Handler<boolean>) => this.on('peek', cb);

  getSettings = (): Promise<Settings> => Promise.resolve(structuredClone(this.settings));
  setInteractive = (on: boolean): void => {
    this.log.interactive.push(on);
    if (this.log.interactive.length > 50) this.log.interactive.shift();
    this.onInteractive?.(on);
  };
  dragStart = (): void => {
    this.log.dragStart++;
    this.log.dragMoves = [];
  };
  dragMove = (dx: number, dy: number): void => {
    this.log.dragMoves.push([dx, dy]);
    if (this.log.dragMoves.length > 200) this.log.dragMoves.shift();
    this.onDragMove?.(dx, dy);
  };
  dragEnd = (): void => {
    this.log.dragEnd++;
  };
  openSettings = (): void => {
    this.log.openSettings++;
  };
  showContextMenu = (): void => {
    this.log.contextMenu++;
  };

  // ---- emit helpers
  emitInput(s: Partial<InputSample> = {}): void {
    this.emit<InputSample>('input', {
      keysPerSec: 0,
      keyBurst: false,
      scrollDelta: 0,
      mouseSpeed: 0,
      idleMs: 0,
      ...s,
    });
  }
  emitCursor(s: Partial<CursorSample> & { x: number; y: number }): void {
    this.emit<CursorSample>('cursor', { winX: 0, winY: 0, winW: 256, winH: 224, ...s });
  }
  emitAgent(e: Partial<AgentEvent> & { type: AgentEvent['type'] }): void {
    this.emit<AgentEvent>('agent', { agent: 'claude-code', ts: Date.now(), ...e });
  }
  emitReminder(e: Partial<ReminderEvent> & { kind: ReminderEvent['kind'] }): void {
    this.emit<ReminderEvent>('reminder', { text: '', durationMs: 6000, ...e });
  }
  emitPomodoro(s: Partial<PomodoroState>): void {
    this.emit<PomodoroState>('pomodoro', {
      phase: 'idle',
      endsAt: null,
      cycle: 0,
      paused: false,
      remainingMs: 0,
      ...s,
    });
  }
  emitPeek(on: boolean): void {
    this.emit('peek', on);
  }
  /** Merge a patch into the mock settings and broadcast. */
  emitSettings(patch: Partial<Settings> = {}): Settings {
    this.settings = { ...this.settings, ...patch };
    this.emit<Settings>('settings', structuredClone(this.settings));
    return this.settings;
  }
}

export type AnyBridge = OverlayBridge & { mock?: MockBridge };

export function getBridge(): AnyBridge {
  if (isTauriRuntime()) return new TauriBridge();
  if (typeof window !== 'undefined' && window.critter) return window.critter;
  const m = new MockBridge();
  return Object.assign(m, { mock: m });
}
