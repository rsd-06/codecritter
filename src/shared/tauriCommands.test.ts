// Contract check: every command the Tauri bridge invokes is registered in the Rust invoke_handler and the
// JS argument names match the Rust parameters (snake_case). A missing registration makes the call reject
// at runtime, which is exactly what the Settings > AI Agents buttons depend on.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('tauri-bridge <-> Rust commands', () => {
  it('every invoked command is registered in the Rust invoke_handler, with matching arg names', () => {
    const ts = read('src/renderer/tauri-bridge.ts');
    const lib = read('src-tauri/src/lib.rs');
    const cmds = read('src-tauri/src/commands.rs');
    const handler = /generate_handler!\[([\s\S]*?)\]/.exec(lib)?.[1] ?? '';
    const registered = new Set([...handler.matchAll(/commands::(\w+)/g)].map((m) => m[1]));
    const used = [...ts.matchAll(/(?:invoke(?:<[^>]*>)?|fire)\(\s*'(\w+)'(?:,\s*\{([^}]*)\})?/g)];
    expect(used.length).toBeGreaterThan(10);
    for (const [, name, args] of used) {
      expect(registered.has(name), `command ${name} not registered`).toBe(true);
      const sig = new RegExp(`fn ${name}\\(([^)]*)\\)`).exec(cmds)?.[1] ?? '';
      const argNames = (args ?? '')
        .split(',')
        .map((x) => x.trim().split(':')[0].trim())
        .filter(Boolean);
      for (const a of argNames) {
        // Tauri maps JS camelCase args to Rust snake_case parameters; `on_` is the bridge's renamed `on`
        const js = a === 'on_' ? 'on' : a;
        const rust = js.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
        expect(sig.includes(`${rust}:`), `${name}: arg ${a} vs (${sig})`).toBe(true);
      }
    }
  });
});
