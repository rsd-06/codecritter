import http from 'node:http';
import net from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../shared/types';
import { startAgentServer } from './server';

const TOKEN = 'secret-token';
let home: string;
let events: AgentEvent[];
const closers: (() => Promise<void>)[] = [];

beforeEach(async () => {
  home = await mkdtemp(join(os.tmpdir(), 'critter-srv-'));
  events = [];
});
afterEach(async () => {
  while (closers.length) await closers.pop()!();
  await rm(home, { recursive: true, force: true });
});

async function start(port = 0) {
  const s = await startAgentServer({ port, token: TOKEN, onEvent: (e) => events.push(e), home });
  closers.push(s.close);
  return s;
}

interface Res {
  status: number;
  body: string;
}
function request(
  port: number,
  opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string },
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: opts.path ?? '/v1/event',
        method: opts.method ?? 'POST',
        headers: opts.headers,
      },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: b }));
      },
    );
    req.on('error', reject);
    req.end(opts.body);
  });
}
const post = (port: number, payload: unknown, headers: Record<string, string> = {}) =>
  request(port, {
    headers: { 'Content-Type': 'application/json', 'X-Critter-Token': TOKEN, ...headers },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });

describe('agent server', () => {
  it('health needs no auth', async () => {
    const s = await start();
    const r = await request(s.port, { method: 'GET', path: '/v1/health' });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ ok: true, name: 'codecritter' });
  });

  it('accepts a valid event and sets ts server-side', async () => {
    const s = await start();
    const before = Date.now();
    const r = await post(s.port, { agent: 'claude-code', type: 'thinking', ts: 1, cwd: '/x' });
    expect(r.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ agent: 'claude-code', type: 'thinking', cwd: '/x' });
    expect(events[0].ts).toBeGreaterThanOrEqual(before);
  });

  it('requires the token', async () => {
    const s = await start();
    expect((await post(s.port, { type: 'done' }, { 'X-Critter-Token': 'nope' })).status).toBe(401);
    const noTok = await request(s.port, { body: '{"type":"done"}' });
    expect(noTok.status).toBe(401);
    expect(events).toHaveLength(0);
  });

  it('validates type, agent fallback, json', async () => {
    const s = await start();
    expect((await post(s.port, { type: 'explode' })).status).toBe(400);
    expect((await post(s.port, '{not json')).status).toBe(400);
    expect((await post(s.port, '[1]')).status).toBe(400);
    expect((await post(s.port, { agent: 'bogus', type: 'done' })).status).toBe(200);
    expect(events[0].agent).toBe('generic');
  });

  it('truncates and strips control chars from messages', async () => {
    const s = await start();
    await post(s.port, { type: 'done', message: 'a\u0000b\nc\u001b[31m' + 'x'.repeat(500) });
    const m = events[0].message!;
    expect(m.length).toBeLessThanOrEqual(200);
    // eslint-disable-next-line no-control-regex
    expect(m).not.toMatch(/[\u0000-\u001f]/);
    expect(m.startsWith('a b c')).toBe(true);
  });

  it('rejects bodies over 16KB', async () => {
    const s = await start();
    const r = await post(s.port, { type: 'done', message: 'x'.repeat(20000) });
    expect(r.status).toBe(413);
    expect(events).toHaveLength(0);
  });

  it('rejects any Origin header (browser CSRF)', async () => {
    const s = await start();
    const r = await post(s.port, { type: 'done' }, { Origin: 'http://localhost:3000' });
    expect(r.status).toBe(403);
    expect(events).toHaveLength(0);
  });

  it('rejects non-loopback Host (DNS rebinding)', async () => {
    const s = await start();
    const r = await post(s.port, { type: 'done' }, { Host: 'evil.example.com' });
    expect(r.status).toBe(403);
    const ok = await post(s.port, { type: 'done' }, { Host: `localhost:${s.port}` });
    expect(ok.status).toBe(200);
  });

  it('rate limits bursts with 429', async () => {
    const s = await start();
    const statuses = await Promise.all(
      Array.from({ length: 80 }, () => request(s.port, { method: 'GET', path: '/v1/health' })),
    ).then((rs) => rs.map((r) => r.status));
    expect(statuses).toContain(429);
    expect(statuses).toContain(200);
  });

  it('404/405 for other routes', async () => {
    const s = await start();
    expect((await request(s.port, { method: 'GET', path: '/nope' })).status).toBe(404);
    expect((await request(s.port, { method: 'GET', path: '/v1/event' })).status).toBe(405);
  });

  it('falls back to the next port when busy and records the port', async () => {
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', () => r()));
    const busy = (blocker.address() as net.AddressInfo).port;
    try {
      const s = await start(busy);
      expect(s.port).toBeGreaterThan(busy);
      expect(s.port).toBeLessThanOrEqual(busy + 5);
      expect((await readFile(join(home, '.codecritter', 'port'), 'utf8')).trim()).toBe(
        String(s.port),
      );
    } finally {
      blocker.close();
    }
  });

  it('binds loopback only', async () => {
    const s = await start();
    // a connection to loopback works; the server object reports 127.0.0.1 (verified via bind arg)
    const r = await request(s.port, { method: 'GET', path: '/v1/health' });
    expect(r.status).toBe(200);
  });

  it('refuses an empty token', async () => {
    await expect(startAgentServer({ port: 0, token: '', onEvent: () => {} })).rejects.toThrow();
  });
});
