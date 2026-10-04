/**
 * Runtime state + plug points shared between main-process modules.
 * Agent E (scheduler/peek) and agent C (agents) register implementations here.
 */
import type { AgentId, PomodoroState } from '../shared/types';
import { IPC } from '../shared/ipc';
import { broadcast } from './windows/overlay';

/* ---- Pomodoro (TODO agent E: call registerPomodoro with the real engine) ---- */
export interface PomodoroApi {
  start(): void;
  pause(): void;
  resume(): void;
  skip(): void;
  stop(): void;
  getState(): PomodoroState;
}
const IDLE_POMO: PomodoroState = {
  phase: 'idle',
  endsAt: null,
  cycle: 0,
  paused: false,
  remainingMs: 0,
};
let pomo: PomodoroApi = {
  start: () => undefined,
  pause: () => undefined,
  resume: () => undefined,
  skip: () => undefined,
  stop: () => undefined,
  getState: () => IDLE_POMO,
};
export function registerPomodoro(api: PomodoroApi): void {
  pomo = api;
}
export function pomodoroCommand(
  cmd: 'start' | 'pause' | 'resume' | 'skip' | 'stop',
): PomodoroState {
  pomo[cmd]();
  return pomo.getState();
}
export function getPomodoroState(): PomodoroState {
  return pomo.getState();
}

/* ---- Agent installers (TODO agent C: registerAgentApi) ---- */
export interface AgentApi {
  status(): Promise<Record<string, { installed: boolean; path: string }>>;
  install(id: AgentId): Promise<{ ok: boolean; message: string }>;
  uninstall(id: AgentId): Promise<{ ok: boolean; message: string }>;
}
let agentApi: AgentApi = {
  status: async () => ({}),
  install: async () => ({ ok: false, message: 'Agent installers not available yet' }),
  uninstall: async () => ({ ok: false, message: 'Agent installers not available yet' }),
};
export function registerAgentApi(api: AgentApi): void {
  agentApi = api;
}
export function getAgentApi(): AgentApi {
  return agentApi;
}

/* ---- Peek (manual toggle; agent E may add auto detection and call setPeek) ---- */
let peeking = false;
const stateListeners = new Set<() => void>();
export function onStateChange(fn: () => void): () => void {
  stateListeners.add(fn);
  return () => stateListeners.delete(fn);
}
const notify = (): void => stateListeners.forEach((f) => f());

export function isPeeking(): boolean {
  return peeking;
}
export function setPeek(v: boolean): void {
  if (peeking === v) return;
  peeking = v;
  broadcast(IPC.peek, v);
  notify();
}
export function togglePeek(): void {
  setPeek(!peeking);
}

/* ---- Pause reactions: stops input + cursor streams to the overlay ---- */
let paused = false;
export function isReactionsPaused(): boolean {
  return paused;
}
export function setReactionsPaused(v: boolean): void {
  paused = v;
  notify();
}
export function toggleReactionsPaused(): void {
  setReactionsPaused(!paused);
}
