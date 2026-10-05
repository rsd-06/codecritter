import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => undefined) }));

import { TauriBridge } from './tauri-bridge';

describe('TauriBridge command mapping', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({ ok: true, message: 'x' });
  });

  it('installAgent / uninstallAgent pass { id } to the snake_case commands', async () => {
    const b = new TauriBridge();
    await b.installAgent('claude-code');
    await b.uninstallAgent('codex');
    expect(invoke).toHaveBeenNthCalledWith(1, 'install_agent', { id: 'claude-code' });
    expect(invoke).toHaveBeenNthCalledWith(2, 'uninstall_agent', { id: 'codex' });
  });

  it('propagates a string rejection from the Rust command', async () => {
    invoke.mockRejectedValue('command install_agent not found');
    await expect(new TauriBridge().installAgent('claude-code')).rejects.toBe('command install_agent not found');
  });
});
