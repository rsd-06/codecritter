import type { AgentId } from '../../../shared/types';
import { claudeCodeInstaller } from './claude-code';
import { codexInstaller } from './codex';
import { cursorInstaller } from './cursor';
import { copilotInstaller, kiroInstaller, opencodeInstaller } from './files';
import { antigravityInstaller, geminiInstaller } from './gemini';
import type { Installer } from './util';

export type { Installer } from './util';

function manual(id: AgentId, label: string): Installer {
  return {
    id,
    label,
    detect: async () => false,
    status: async () => ({ installed: false, path: '' }),
    install: async () => ({
      ok: true,
      message: `${label} has no hook file we can edit. Call the local API from your agent: see docs/agents.md ("Devin and other tools").`,
    }),
    uninstall: async () => ({ ok: true, message: 'Nothing to remove (manual setup)' }),
  };
}

export const AGENT_INSTALLERS: Record<AgentId, Installer> = {
  'claude-code': claudeCodeInstaller,
  codex: codexInstaller,
  cursor: cursorInstaller,
  gemini: geminiInstaller,
  antigravity: antigravityInstaller,
  kiro: kiroInstaller,
  copilot: copilotInstaller,
  opencode: opencodeInstaller,
  devin: manual('devin', 'Devin'),
  generic: manual('generic', 'Generic / other tools'),
};

export async function agentStatusAll(
  home: string,
): Promise<Record<AgentId, { installed: boolean; path: string }>> {
  const out = {} as Record<AgentId, { installed: boolean; path: string }>;
  for (const [id, inst] of Object.entries(AGENT_INSTALLERS) as [AgentId, Installer][]) {
    try {
      out[id] = await inst.status(home);
    } catch {
      out[id] = { installed: false, path: '' };
    }
  }
  return out;
}
