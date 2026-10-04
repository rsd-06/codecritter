import { createHash, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import type { AgentEvent, AgentEventType, AgentId } from '../../shared/types';
import { writePortFile } from './token';

export const AGENT_IDS: readonly AgentId[] = [
  'claude-code',
  'codex',
  'cursor',
  'gemini',
  'antigravity',
  'kiro',
  'copilot',
  'opencode',
  'devin',
  'generic',
];
export const EVENT_TYPES: readonly AgentEventType[] = [
  'thinking',
  'tool',
  'done',
  'error',
  'attention',
  'idle',
];

const MAX_BODY = 16 * 1024;
const MAX_MESSAGE = 200;
const PORT_TRIES = 6; // requested port + next 5
const RATE_PER_SEC = 30;
const SERVER_VERSION = '0.1.0';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export interface AgentServerOptions {
  port: number;
  token: string;
  onEvent: (e: AgentEvent) => void;
  host?: string;
  /** Home dir used to record the actual port (default os.homedir()). */
  home?: string;
}

export interface AgentServerHandle {
  port: number;
  close(): Promise<void>;
}

function isControl(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

export function sanitizeText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = Array.from(v, (ch) => (isControl(ch.charCodeAt(0)) ? ' ' : ch))
    .join('')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, max);
  return s.length > 0 ? s : undefined;
}

/** Validate/normalise a raw JSON payload into an AgentEvent, or null if invalid. */
export function parseEvent(raw: unknown, now: number = Date.now()): AgentEvent | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.type !== 'string' || !EVENT_TYPES.includes(o.type as AgentEventType)) return null;
  const agent: AgentId =
    typeof o.agent === 'string' && AGENT_IDS.includes(o.agent as AgentId)
      ? (o.agent as AgentId)
      : 'generic';
  const ev: AgentEvent = { agent, type: o.type as AgentEventType, ts: now };
  const message = sanitizeText(o.message, MAX_MESSAGE);
  const session = sanitizeText(o.session, 100);
  const cwd = sanitizeText(o.cwd, 400);
  if (message) ev.message = message;
  if (session) ev.session = session;
  if (cwd) ev.cwd = cwd;
  return ev;
}

function sha(s: string): Buffer {
  return createHash('sha256').update(s).digest();
}

function hostnameOf(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const h = hostHeader.toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end === -1 ? null : h.slice(0, end + 1);
  }
  const i = h.lastIndexOf(':');
  return i === -1 ? h : h.slice(0, i);
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(s),
    'Cache-Control': 'no-store',
    Connection: 'close',
  });
  res.end(s);
}

export async function startAgentServer(opts: AgentServerOptions): Promise<AgentServerHandle> {
  if (!opts.token) throw new Error('agent server requires a non-empty token');
  const host = opts.host ?? '127.0.0.1';
  const expected = sha(opts.token);
  let tokens = RATE_PER_SEC;
  let last = Date.now();

  const takeToken = (): boolean => {
    const now = Date.now();
    tokens = Math.min(RATE_PER_SEC, tokens + ((now - last) / 1000) * RATE_PER_SEC);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };

  const handler = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const hostname = hostnameOf(req.headers.host);
    if (!hostname || !LOOPBACK_HOSTS.has(hostname)) return send(res, 403, { error: 'bad host' });
    // Browsers always send Origin on cross-site POSTs; local CLIs never do.
    if (req.headers.origin !== undefined) return send(res, 403, { error: 'origin not allowed' });
    if (!takeToken()) return send(res, 429, { error: 'rate limited' });

    const url = (req.url ?? '').split('?')[0];
    if (url === '/v1/health') {
      if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
      return send(res, 200, { ok: true, version: SERVER_VERSION, name: 'codecritter' });
    }
    if (url !== '/v1/event') return send(res, 404, { error: 'not found' });
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });

    const t = req.headers['x-critter-token'];
    if (typeof t !== 'string' || !timingSafeEqual(sha(t), expected)) {
      return send(res, 401, { error: 'unauthorized' });
    }

    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_BODY) return send(res, 413, { error: 'payload too large' });

    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on('data', (c: Buffer) => {
      if (aborted) return;
      size += c.length;
      if (size > MAX_BODY) {
        aborted = true;
        send(res, 413, { error: 'payload too large' });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return send(res, 400, { error: 'invalid json' });
      }
      const ev = parseEvent(parsed);
      if (!ev) return send(res, 400, { error: 'invalid event' });
      try {
        opts.onEvent(ev);
      } catch {
        /* a failing listener must not break the agent */
      }
      send(res, 200, { ok: true });
    });
    req.on('error', () => {
      /* client went away */
    });
  };

  const tries = opts.port === 0 ? 1 : PORT_TRIES;
  let server: http.Server | null = null;
  let boundPort = 0;
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    const candidate = opts.port === 0 ? 0 : opts.port + i;
    const s = http.createServer(handler);
    s.headersTimeout = 5000;
    s.requestTimeout = 5000;
    try {
      await new Promise<void>((resolve, reject) => {
        s.once('error', reject);
        s.listen(candidate, host, () => {
          s.removeListener('error', reject);
          resolve();
        });
      });
      server = s;
      boundPort = (s.address() as { port: number }).port;
      break;
    } catch (e) {
      lastErr = e;
      s.close();
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
    }
  }
  if (!server) throw lastErr instanceof Error ? lastErr : new Error('no free port');
  const srv = server;
  srv.on('error', () => {
    /* runtime socket errors are non-fatal */
  });

  try {
    await writePortFile(boundPort, opts.home ?? os.homedir());
  } catch {
    /* hook CLI falls back to the default port */
  }

  return {
    port: boundPort,
    close: () =>
      new Promise<void>((resolve) => {
        srv.close(() => resolve());
        srv.closeAllConnections();
      }),
  };
}
