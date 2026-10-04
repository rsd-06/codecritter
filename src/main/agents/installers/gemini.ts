import { join } from 'node:path';
import type { Installer } from './util';
import { exists, makeNestedInstaller } from './util';

// Gemini CLI: ~/.gemini/settings.json, same nested schema as Claude Code.
export const geminiInstaller = makeNestedInstaller({
  id: 'gemini',
  label: 'Gemini CLI',
  dirName: '.gemini',
  fileName: 'settings.json',
  agentName: 'gemini',
  named: true,
  events: {
    BeforeAgent: 'thinking',
    AfterAgent: 'done',
    Notification: 'attention',
  },
});

/**
 * Antigravity shares Gemini's settings file, so this is an alias: it reads and
 * writes the very same hooks (reported as agent "gemini"). Uninstalling either
 * one removes both.
 */
export const antigravityInstaller: Installer = {
  ...geminiInstaller,
  id: 'antigravity',
  label: 'Antigravity',
  detect: async (home) =>
    (await geminiInstaller.detect(home)) || (await exists(join(home, '.antigravity'))),
};
