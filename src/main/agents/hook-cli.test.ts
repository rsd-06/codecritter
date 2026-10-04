import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../shared/types';
import { startAgentServer } from './server';
import { ensureToken } from './token';

const HOOK = resolve(__dirname, '../../../bin/critter-hook.mjs');
let home: string;
let events: AgentEvent[];
let close: () => Promise<void>;
let port: number;

beforeEach(async () => {
  home = await mkdtemp(join(os.tmpdir(), 'critter-e2e-'));
  events = [];
  const token = await ensureToken(home);
  const s = await startAgentServer({ port: 0, token, onEvent: (e) => events.push(e), home });
  close = s.close;
  port = s.port;
});
afterEach(async () => {
  await close();
  await rm(home, { recursive: true, force: true });
});

function run(
  args: string[],
  opts: { stdin?: string; env?: Record<string, string>; keepStdinOpen?: boolean } = {},
): Promise<{ code: number | null; stdout: string; stderr: string; ms: number }> {
  return new Promise((res) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [HOOK, ...args], {
      env: { ...process.env, CRITTER_HOME: home, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (c) => (stdout += c));
    p.stderr.on('data', (c) => (stderr += c));
    p.on('close', (code) => res({ code, stdout, stderr, ms: Date.now() - t0 }));
    if (!opts.keepStdinOpen) p.stdin.end(opts.stdin ?? '');
  });
}

describe('critter-hook CLI (end to end)', () => {
  it('sends an event using token and port from CRITTER_HOME, silently, exit 0', async () => {
    const r = await run(['generic', 'done', '--message', 'hello']);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ agent: 'generic', type: 'done', message: 'hello' });
  });

  it('derives message/cwd/session from Claude stdin JSON', async () => {
    const r = await run(['claude-code', 'thinking'], {
      stdin: JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        prompt: 'fix the bug',
        cwd: '/proj',
        session_id: 's1',
      }),
    });
    expect(r.code).toBe(0);
    expect(events[0]).toMatchObject({
      agent: 'claude-code',
      type: 'thinking',
      message: 'fix the bug',
      cwd: '/proj',
      session: 's1',
    });
  });

  it('maps hook_event_name when type is auto', async () => {
    await run(['claude-code', 'auto'], {
      stdin: JSON.stringify({ hook_event_name: 'Notification', message: 'needs permission' }),
    });
    expect(events[0]).toMatchObject({ type: 'attention', message: 'needs permission' });
    await run(['claude-code', 'auto'], {
      stdin: JSON.stringify({ hook_event_name: 'Stop', last_assistant_message: 'all done' }),
    });
    expect(events[1]).toMatchObject({ type: 'done', message: 'all done' });
  });

  it('reads the Codex JSON payload from the last argv', async () => {
    const payload = JSON.stringify({
      type: 'agent-turn-complete',
      'thread-id': 't9',
      cwd: '/w',
      'last-assistant-message': 'finished',
    });
    await run(['codex', 'done', payload]);
    expect(events[0]).toMatchObject({
      agent: 'codex',
      type: 'done',
      session: 't9',
      cwd: '/w',
      message: 'finished',
    });
  });

  it('exits 0 silently when the server is down or token missing', async () => {
    const r = await run(['generic', 'done'], { env: { CRITTER_PORT: '1' } });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(events).toHaveLength(0);
    const empty = await mkdtemp(join(os.tmpdir(), 'critter-e2e-empty-'));
    try {
      const r2 = await run(['generic', 'done'], { env: { CRITTER_HOME: empty } });
      expect(r2.code).toBe(0);
      expect(r2.stdout).toBe('');
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('exits 0 on garbage args and invalid types, stderr only with CRITTER_DEBUG', async () => {
    const quiet = await run(['generic', 'bogus-type']);
    expect(quiet.code).toBe(0);
    expect(quiet.stdout + quiet.stderr).toBe('');
    const dbg = await run(['generic', 'bogus-type'], { env: { CRITTER_DEBUG: '1' } });
    expect(dbg.code).toBe(0);
    expect(dbg.stdout).toBe('');
    expect(dbg.stderr).not.toBe('');
    expect(events).toHaveLength(0);
  });

  it('does not hang when stdin stays open (200ms cap)', async () => {
    const r = await run(['generic', 'tool'], { keepStdinOpen: true });
    expect(r.code).toBe(0);
    expect(r.ms).toBeLessThan(3000);
    expect(events[0]).toMatchObject({ type: 'tool' });
  });

  it('honours CRITTER_PORT / CRITTER_TOKEN overrides', async () => {
    const empty = await mkdtemp(join(os.tmpdir(), 'critter-e2e-env-'));
    try {
      const token = await ensureToken(home);
      await run(['generic', 'idle'], {
        env: { CRITTER_HOME: empty, CRITTER_PORT: String(port), CRITTER_TOKEN: token },
      });
      expect(events[0]).toMatchObject({ type: 'idle' });
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
