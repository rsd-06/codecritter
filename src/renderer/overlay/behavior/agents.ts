// Tracks concurrent agent sessions. "thinking" stays until done / idle / error or a 30-minute timeout.
import type { AgentEventType } from '@shared/types';
import { agentLabel } from './strings';

export const SESSION_TIMEOUT_S = 30 * 60;
const MAX_SESSIONS = 24;

export interface AgentSession {
  active: boolean;
  key: string;
  agent: string;
  since: number;
  lastEvent: number;
  thinking: boolean;
}

export class AgentTracker {
  private readonly pool: AgentSession[] = Array.from({ length: MAX_SESSIONS }, () => ({
    active: false,
    key: '',
    agent: '',
    since: 0,
    lastEvent: 0,
    thinking: false,
  }));
  /** bumps whenever the set of thinking sessions changes (label cache key) */
  version = 0;

  private find(key: string): AgentSession | undefined {
    for (const s of this.pool) if (s.active && s.key === key) return s;
    return undefined;
  }

  private alloc(): AgentSession {
    let oldest = this.pool[0]!;
    for (const s of this.pool) {
      if (!s.active) return s;
      if (s.lastEvent < oldest.lastEvent) oldest = s;
    }
    return oldest; // pool full: recycle the stalest session
  }

  /** Apply an event at time `now` (seconds). */
  event(agent: string, type: AgentEventType, session: string | undefined, now: number): void {
    const key = `${agent}|${session ?? ''}`;
    switch (type) {
      case 'thinking':
      case 'tool': {
        let s = this.find(key);
        if (!s) {
          s = this.alloc();
          s.active = true;
          s.key = key;
          s.agent = agent;
          s.since = now;
          s.thinking = false;
        }
        s.lastEvent = now;
        if (!s.thinking) {
          s.thinking = true;
          this.version++;
        }
        break;
      }
      case 'attention': {
        // waiting for the user: no longer "thinking", but the session is alive
        const s = this.find(key);
        if (s) {
          s.lastEvent = now;
          if (s.thinking) {
            s.thinking = false;
            this.version++;
          }
        }
        break;
      }
      case 'done':
      case 'idle':
      case 'error': {
        if (session) this.drop(key);
        else this.dropAgent(agent); // session-less end event closes every session of that agent
        break;
      }
    }
  }

  private drop(key: string): void {
    const s = this.find(key);
    if (!s) return;
    if (s.thinking) this.version++;
    s.active = false;
  }

  private dropAgent(agent: string): void {
    for (const s of this.pool) {
      if (s.active && s.agent === agent) {
        if (s.thinking) this.version++;
        s.active = false;
      }
    }
  }

  /** Expire sessions with no event for 30 minutes. */
  prune(now: number): void {
    for (const s of this.pool) {
      if (s.active && now - s.lastEvent > SESSION_TIMEOUT_S) {
        if (s.thinking) this.version++;
        s.active = false;
      }
    }
  }

  get thinkingCount(): number {
    let n = 0;
    for (const s of this.pool) if (s.active && s.thinking) n++;
    return n;
  }

  get sessionCount(): number {
    let n = 0;
    for (const s of this.pool) if (s.active) n++;
    return n;
  }

  /** Seconds until the next session would time out (Infinity when none are thinking). */
  timeToExpiry(now: number): number {
    let d = Infinity;
    for (const s of this.pool) if (s.active && s.thinking) d = Math.min(d, s.lastEvent + SESSION_TIMEOUT_S - now);
    return Math.max(0, d);
  }

  /** "Claude", "Claude x2 + Codex", ... for the thought bubble. Called only when `version` changed. */
  thinkingLabel(): { text: string; many: boolean } {
    const names: string[] = [];
    const counts: number[] = [];
    const ordered = this.pool.filter((s) => s.active && s.thinking).sort((a, b) => a.since - b.since);
    for (const s of ordered) {
      const label = agentLabel(s.agent);
      const i = names.indexOf(label);
      if (i >= 0) counts[i] = counts[i]! + 1;
      else {
        names.push(label);
        counts.push(1);
      }
    }
    const parts = names.map((n, i) => (counts[i]! > 1 ? `${n} x${counts[i]}` : n));
    const shown = parts.slice(0, 2).join(' + ');
    const extra = parts.length > 2 ? ` +${parts.length - 2}` : '';
    return { text: (shown || 'Agent') + extra, many: ordered.length > 1 };
  }
}
