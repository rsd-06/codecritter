#!/usr/bin/env node
// critter-hook <agent> <type|auto> [--message text] [json-payload]
// Zero-dependency hook CLI: forwards an agent event to the local CodeCritter server.
// Contract: ALWAYS exits 0 and never writes to stdout (agents may interpret it).
// Env: CRITTER_HOME (replaces the home dir), CRITTER_PORT, CRITTER_TOKEN, CRITTER_DEBUG=1 (stderr logging).
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { clearTimeout, setTimeout } from 'node:timers';

const DEFAULT_PORT = 47626;
const TYPES = ['thinking', 'tool', 'done', 'error', 'attention', 'idle'];
const debug = process.env.CRITTER_DEBUG === '1';
const log = (...a) => {
  if (debug) process.stderr.write(a.join(' ') + '\n');
};

const AUTO = {
  userpromptsubmit: 'thinking',
  beforeagent: 'thinking',
  beforesubmitprompt: 'thinking',
  userpromptsubmitted: 'thinking',
  promptsubmit: 'thinking',
  pretooluse: 'tool',
  posttooluse: 'tool',
  subagentstop: 'tool',
  afterfileedit: 'tool',
  stop: 'done',
  afteragent: 'done',
  agentstop: 'done',
  sessionend: 'done',
  'agent-turn-complete': 'done',
  notification: 'attention',
  sessionstart: 'idle',
};

function readStdin(capMs) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(data);
    };
    const timer = setTimeout(finish, capMs);
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => {
        data += c;
        if (data.length > 1_000_000) finish();
      });
      process.stdin.on('end', finish);
      process.stdin.on('error', finish);
    } catch {
      finish();
    }
  });
}

function parseJson(s) {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function str(v) {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function readFileTrim(p) {
  try {
    return readFileSync(p, 'utf8').trim();
  } catch {
    return '';
  }
}

function parseArgs(argv) {
  const positional = [];
  let message;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--message' || a === '-m') message = argv[++i];
    else if (a.startsWith('--message=')) message = a.slice('--message='.length);
    else positional.push(a);
  }
  return { positional, message };
}

function deriveMessage(type, p) {
  if (!p) return undefined;
  if (type === 'thinking') return str(p.prompt) ?? str(p.message);
  if (type === 'done' || type === 'idle') {
    return str(p.last_assistant_message) ?? str(p['last-assistant-message']) ?? str(p.message);
  }
  if (type === 'tool') return str(p.tool_name) ?? str(p.message);
  return str(p.message) ?? str(p.last_assistant_message) ?? str(p['last-assistant-message']);
}

function post(port, token, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/v1/event',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'X-Critter-Token': token,
        },
        timeout: 300,
      },
      (res) => {
        res.resume();
        res.on('end', () => {
          log('critter-hook: status', res.statusCode);
          resolve();
        });
      },
    );
    req.on('timeout', () => {
      log('critter-hook: timeout');
      req.destroy();
      resolve();
    });
    req.on('error', (e) => {
      log('critter-hook: error', e.message);
      resolve();
    });
    req.end(data);
  });
}

async function main() {
  const { positional, message: flagMessage } = parseArgs(process.argv.slice(2));
  const agent = positional[0] || 'generic';
  let type = (positional[1] || 'auto').toLowerCase();

  // Codex passes its JSON payload as the last argv; Claude/Gemini/Cursor pipe it on stdin.
  let payload = null;
  for (let i = positional.length - 1; i >= 2; i--) {
    if (positional[i].trim().startsWith('{')) {
      payload = parseJson(positional[i]);
      if (payload) break;
    }
  }
  if (!payload) payload = parseJson((await readStdin(200)).trim());

  if (type === 'auto') {
    const ev = payload && (payload.hook_event_name ?? payload.hookEventName ?? payload.type);
    type = (typeof ev === 'string' && AUTO[ev.toLowerCase()]) || '';
  }
  if (!TYPES.includes(type)) {
    log('critter-hook: unknown type', type);
    return;
  }

  const home = process.env.CRITTER_HOME || homedir();
  const dir = join(home, '.codecritter');
  const token = process.env.CRITTER_TOKEN || readFileTrim(join(dir, 'token'));
  if (!token) {
    log('critter-hook: no token (is CodeCritter installed/running?)');
    return;
  }
  const portNum = Number.parseInt(process.env.CRITTER_PORT || readFileTrim(join(dir, 'port')), 10);
  const port = Number.isInteger(portNum) && portNum > 0 ? portNum : DEFAULT_PORT;

  const body = { agent, type };
  const message = flagMessage ?? deriveMessage(type, payload);
  const session =
    str(payload?.session_id) ??
    str(payload?.sessionId) ??
    str(payload?.conversation_id) ??
    str(payload?.['thread-id']);
  const cwd =
    str(payload?.cwd) ??
    str(Array.isArray(payload?.workspace_roots) ? payload.workspace_roots[0] : undefined);
  if (message) body.message = message.slice(0, 200);
  if (session) body.session = session;
  if (cwd) body.cwd = cwd;

  await post(port, token, body);
}

try {
  await main();
} catch (e) {
  log('critter-hook: fatal', e && e.message);
}
process.exit(0);
