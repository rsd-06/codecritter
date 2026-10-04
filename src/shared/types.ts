export type CharacterId = 'stitch' | 'yoda';
export type AgentId =
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'gemini'
  | 'antigravity'
  | 'kiro'
  | 'copilot'
  | 'opencode'
  | 'devin'
  | 'generic';
export type AgentEventType = 'thinking' | 'tool' | 'done' | 'error' | 'attention' | 'idle';
export interface AgentEvent {
  agent: AgentId;
  type: AgentEventType;
  session?: string;
  message?: string;
  cwd?: string;
  ts: number;
}

export interface InputSample {
  // emitted ~10 Hz by main, aggregated
  keysPerSec: number;
  keyBurst: boolean; // keyBurst=true if any key in last 150ms
  scrollDelta: number; // sum of wheel rotation since last sample (+down)
  mouseSpeed: number; // px/s, global
  idleMs: number; // ms since last any input
}
export interface CursorSample {
  x: number;
  y: number;
  winX: number;
  winY: number;
  winW: number;
  winH: number;
} // screen coords + overlay bounds

export type ReminderKind =
  'stretch' | 'water' | 'message' | 'pomodoro-focus' | 'pomodoro-break' | 'pomodoro-done';
export interface ReminderEvent {
  kind: ReminderKind;
  text: string;
  durationMs: number;
}

export interface Palette {
  outline: string;
  body: string;
  bodyShade: string;
  belly: string;
  earInner: string;
  eye: string;
  pupil: string;
  accent: string;
}
export interface CustomMessage {
  id: string;
  time: string /*HH:MM*/;
  text: string;
  repeat: 'once' | 'daily' | 'weekdays';
  enabled: boolean;
}

export interface Settings {
  version: 1;
  character: CharacterId;
  userName: string;
  palettes: Record<CharacterId, Palette>;
  scale: 1 | 2 | 3 | 4;
  opacity: number;
  position: { displayId: number; x: number; y: number } | null;
  sound: { enabled: boolean; volume: number };
  reactions: {
    eyeFollow: boolean;
    hunt: boolean;
    purr: boolean;
    knead: boolean;
    overheat: boolean;
    paper: boolean;
    drag: boolean;
    sleep: boolean;
  };
  overheatKps: number; // default 8 keys/sec sustained 3 s
  reminders: {
    stretch: { enabled: boolean; everyMin: number };
    water: { enabled: boolean; everyMin: number };
  };
  pomodoro: {
    focusMin: number;
    breakMin: number;
    longBreakMin: number;
    cyclesBeforeLong: number;
  };
  messages: CustomMessage[];
  pinnedNote: string;
  dnd: { enabled: boolean; from: string; to: string };
  peek: { auto: boolean; edge: 'left' | 'right' | 'bottom' };
  agents: { enabled: boolean; port: number; token: string };
  autostart: boolean;
  syncFolder: string | null;
}
export interface PomodoroState {
  phase: 'idle' | 'focus' | 'break' | 'longBreak';
  endsAt: number | null;
  cycle: number;
  paused: boolean;
  remainingMs: number;
}

// window.critter (overlay preload)
export interface OverlayBridge {
  onInput(cb: (s: InputSample) => void): () => void;
  onCursor(cb: (s: CursorSample) => void): () => void;
  onAgent(cb: (e: AgentEvent) => void): () => void;
  onReminder(cb: (e: ReminderEvent) => void): () => void;
  onPomodoro(cb: (s: PomodoroState) => void): () => void;
  onSettings(cb: (s: Settings) => void): () => void;
  onPeek(cb: (peeking: boolean) => void): () => void;
  getSettings(): Promise<Settings>;
  setInteractive(on: boolean): void;
  dragStart(): void;
  dragMove(dx: number, dy: number): void;
  dragEnd(): void;
  openSettings(): void;
  showContextMenu(): void;
}
// window.critterSettings (settings preload)
export interface SettingsBridge {
  get(): Promise<Settings>;
  set(patch: Partial<Settings>): Promise<Settings>;
  pomodoro(cmd: 'start' | 'pause' | 'resume' | 'skip' | 'stop'): Promise<PomodoroState>;
  /** Current pomodoro state (for tray-started sessions). */
  pomodoroState(): Promise<PomodoroState>;
  /** Subscribe to pomodoro state pushes; returns an unsubscribe function. */
  onPomodoro(cb: (s: PomodoroState) => void): () => void;
  agentStatus(): Promise<Record<string, { installed: boolean; path: string }>>;
  installAgent(id: AgentId): Promise<{ ok: boolean; message: string }>;
  uninstallAgent(id: AgentId): Promise<{ ok: boolean; message: string }>;
  testEvent(type: AgentEventType): Promise<void>;
  testReminder(kind: ReminderKind): Promise<void>;
  exportSettings(): Promise<string | null>;
  importSettings(): Promise<boolean>;
}
