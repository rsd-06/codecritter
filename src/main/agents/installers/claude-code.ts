import { makeNestedInstaller } from './util';

// Claude Code: ~/.claude/settings.json
// { "hooks": { "<Event>": [ { "matcher": "", "hooks": [ { "type": "command", "command": "..." } ] } ] } }
export const claudeCodeInstaller = makeNestedInstaller({
  id: 'claude-code',
  label: 'Claude Code',
  dirName: '.claude',
  fileName: 'settings.json',
  agentName: 'claude-code',
  events: {
    UserPromptSubmit: 'thinking',
    PreToolUse: 'tool',
    Stop: 'done',
    SubagentStop: 'tool',
    Notification: 'attention',
  },
});
