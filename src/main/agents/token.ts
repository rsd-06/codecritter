import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';

/** Directory holding the shared secret + port file: ~/.codecritter */
export function critterDir(home: string = os.homedir()): string {
  return join(home, '.codecritter');
}

export function tokenPath(home: string = os.homedir()): string {
  return join(critterDir(home), 'token');
}

export function portPath(home: string = os.homedir()): string {
  return join(critterDir(home), 'port');
}

async function readTrimmed(path: string): Promise<string | null> {
  try {
    const s = (await readFile(path, 'utf8')).trim();
    return s.length > 0 ? s : null;
  } catch {
    return null;
  }
}

/** Returns the token, creating ~/.codecritter/token (32 random bytes, hex, mode 0600) if missing. */
export async function ensureToken(home: string = os.homedir()): Promise<string> {
  const existing = await readTrimmed(tokenPath(home));
  if (existing) return existing;
  const token = randomBytes(32).toString('hex');
  await mkdir(critterDir(home), { recursive: true });
  await writeFile(tokenPath(home), token + '\n', { mode: 0o600 });
  try {
    await chmod(tokenPath(home), 0o600); // no-op on Windows, fixes umask elsewhere
  } catch {
    /* best effort */
  }
  return token;
}

/** Records the port the server actually bound (it may differ from the default after fallback). */
export async function writePortFile(port: number, home: string = os.homedir()): Promise<void> {
  await mkdir(critterDir(home), { recursive: true });
  await writeFile(portPath(home), String(port) + '\n', { mode: 0o600 });
}

export interface CritterConfig {
  token: string | null;
  port: number | null;
}

export async function readConfig(home: string = os.homedir()): Promise<CritterConfig> {
  const token = await readTrimmed(tokenPath(home));
  const portStr = await readTrimmed(portPath(home));
  const n = portStr ? Number.parseInt(portStr, 10) : NaN;
  return { token, port: Number.isInteger(n) && n > 0 && n < 65536 ? n : null };
}
