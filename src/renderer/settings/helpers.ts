// Pure helpers for the settings UI: validation, presets, patch builders. No DOM.
import { DEFAULT_PALETTES } from '@shared/defaults';
import type { AgentId, CharacterId, CustomMessage, Palette, Settings } from '@shared/types';

export const NOTE_MAX = 80;
export const MESSAGE_MAX = 120;
export const PALETTE_KEYS: readonly (keyof Palette)[] = [
  'outline',
  'body',
  'bodyShade',
  'belly',
  'earInner',
  'eye',
  'pupil',
  'accent',
];
export const PALETTE_LABELS: Record<keyof Palette, string> = {
  outline: 'Outline',
  body: 'Body',
  bodyShade: 'Body shade',
  belly: 'Belly',
  earInner: 'Inner ear',
  eye: 'Eyes',
  pupil: 'Eye glint',
  accent: 'Accent',
};

export interface PalettePreset {
  name: string;
  palette: Palette;
}

export const PRESETS: Record<CharacterId, PalettePreset[]> = {
  stitch: [
    { name: 'Classic', palette: DEFAULT_PALETTES.stitch },
    {
      name: 'Angel pink',
      palette: {
        outline: '#5c1b45',
        body: '#f08bc4',
        bodyShade: '#d063a3',
        belly: '#ffd6ee',
        earInner: '#a02e78',
        eye: '#2a1022',
        pupil: '#ffffff',
        accent: '#c04a95',
      },
    },
    {
      name: 'Experiment 625',
      palette: {
        outline: '#5a4308',
        body: '#f2c53a',
        bodyShade: '#cf9f1c',
        belly: '#fff0a8',
        earInner: '#c9742a',
        eye: '#231a08',
        pupil: '#ffffff',
        accent: '#b8791a',
      },
    },
  ],
  yoda: [
    { name: 'Classic', palette: DEFAULT_PALETTES.yoda },
    {
      name: 'Grogu',
      palette: {
        outline: '#3b2f1c',
        body: '#b7c47a',
        bodyShade: '#98a85c',
        belly: '#e2e6b4',
        earInner: '#d2ab86',
        eye: '#2a1d10',
        pupil: '#ffffff',
        accent: '#b08a5a',
      },
    },
    {
      name: 'Force ghost',
      palette: {
        outline: '#1c3a66',
        body: '#7fb6ff',
        bodyShade: '#5b94e0',
        belly: '#cfe6ff',
        earInner: '#a9c8f0',
        eye: '#10203a',
        pupil: '#ffffff',
        accent: '#4a7ac8',
      },
    },
  ],
};

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;
export const isHex = (s: string): boolean => HEX_RE.test(s);
export const isHHMM = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Parse an integer text field; null when blank, non-integer or out of range. */
export function parseIntIn(text: string, min: number, max: number): number | null {
  const t = text.trim();
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

export const PORT_MIN = 1024;
export const PORT_MAX = 65535;
export const validPort = (n: number): boolean => Number.isInteger(n) && n >= PORT_MIN && n <= PORT_MAX;

export type MessageError = 'time' | 'text-empty' | 'text-long';
export function validateMessage(m: Pick<CustomMessage, 'time' | 'text'>): MessageError | null {
  if (!isHHMM(m.time)) return 'time';
  if (m.text.trim().length === 0) return 'text-empty';
  if (m.text.length > MESSAGE_MAX) return 'text-long';
  return null;
}

export function newMessage(id: string): CustomMessage {
  return { id, time: '12:00', text: '', repeat: 'daily', enabled: true };
}
export function makeId(now = Date.now(), rnd = Math.random()): string {
  return `m${now.toString(36)}${Math.floor(rnd * 1e6).toString(36)}`;
}

export function trimNote(s: string): string {
  return s.slice(0, NOTE_MAX);
}

// ---- patch builders (always send complete top-level values; never rely on deep merge) ----
export type Patch = Partial<Settings>;

export function paletteEdit(s: Settings, id: CharacterId, key: keyof Palette, value: string): Patch {
  return { palettes: { ...s.palettes, [id]: { ...s.palettes[id], [key]: value } } };
}
export function paletteSet(s: Settings, id: CharacterId, palette: Palette): Patch {
  return { palettes: { ...s.palettes, [id]: { ...palette } } };
}
export function paletteReset(s: Settings, id: CharacterId): Patch {
  return paletteSet(s, id, DEFAULT_PALETTES[id]);
}
export function matchPreset(id: CharacterId, p: Palette): string | null {
  const hit = PRESETS[id].find((pr) =>
    PALETTE_KEYS.every((k) => pr.palette[k].toLowerCase() === p[k].toLowerCase()),
  );
  return hit ? hit.name : null;
}
export function reactionPatch(s: Settings, key: keyof Settings['reactions'], on: boolean): Patch {
  return { reactions: { ...s.reactions, [key]: on } };
}
export function reminderPatch(
  s: Settings,
  kind: 'stretch' | 'water',
  change: Partial<Settings['reminders']['stretch']>,
): Patch {
  return { reminders: { ...s.reminders, [kind]: { ...s.reminders[kind], ...change } } };
}
export function pomodoroPatch(s: Settings, change: Partial<Settings['pomodoro']>): Patch {
  return { pomodoro: { ...s.pomodoro, ...change } };
}
export function upsertMessage(list: CustomMessage[], m: CustomMessage): CustomMessage[] {
  return list.some((x) => x.id === m.id) ? list.map((x) => (x.id === m.id ? m : x)) : [...list, m];
}
export function removeMessage(list: CustomMessage[], id: string): CustomMessage[] {
  return list.filter((x) => x.id !== id);
}
/** Only persist messages that validate; invalid drafts stay local. */
export function savableMessages(list: CustomMessage[]): CustomMessage[] {
  return list.filter((m) => validateMessage(m) === null);
}

// ---- formatting / agents ----
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const AGENTS: { id: AgentId; name: string; file: string }[] = [
  { id: 'claude-code', name: 'Claude Code', file: '~/.claude/settings.json' },
  { id: 'codex', name: 'Codex', file: '~/.codex/config.toml' },
  { id: 'cursor', name: 'Cursor', file: '~/.cursor/hooks.json' },
  { id: 'gemini', name: 'Gemini CLI', file: '~/.gemini/settings.json' },
  { id: 'antigravity', name: 'Antigravity', file: '~/.gemini/settings.json (shared with Gemini CLI)' },
  { id: 'kiro', name: 'Kiro', file: '~/.kiro/hooks/codecritter-*.kiro.hook' },
  { id: 'copilot', name: 'Copilot', file: '~/.copilot/hooks/codecritter.json' },
  { id: 'opencode', name: 'OpenCode', file: 'the OpenCode plugin folder (a codecritter plugin file)' },
  { id: 'devin', name: 'Devin', file: 'the Devin hook config in your home folder' },
  { id: 'generic', name: 'Generic', file: '(nothing to install: use the manual snippet below)' },
];

export function curlSnippet(port: number): string {
  return [
    `curl -X POST http://127.0.0.1:${port}/v1/event \\`,
    '  -H "Content-Type: application/json" \\',
    '  -H "X-Critter-Token: $(cat ~/.codecritter/token)" \\',
    `  -d '{"agent":"generic","type":"done"}'`,
  ].join('\n');
}
export function powershellSnippet(port: number): string {
  return [
    '$t = (Get-Content "$HOME\\.codecritter\\token" -Raw).Trim()',
    `Invoke-RestMethod -Method Post -Uri http://127.0.0.1:${port}/v1/event \``,
    '  -Headers @{ "X-Critter-Token" = $t } -ContentType "application/json" `',
    `  -Body '{"agent":"generic","type":"done"}'`,
  ].join('\n');
}
