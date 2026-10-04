// All user-facing lines, keyed by character. {name} / {agent} / {agents} are substituted; an empty
// name is removed gracefully ("{name}! Stretch time!" -> "Stretch time!"). Every key has 3+ variants.
import type { AgentId, CharacterId } from '@shared/types';

export type StringKey =
  | 'stretch'
  | 'water'
  | 'message'
  | 'pomodoroFocus'
  | 'pomodoroBreak'
  | 'pomodoroDone'
  | 'done'
  | 'alert'
  | 'error'
  | 'thinking'
  | 'thinkingMany'
  | 'bedtime';

export const STRINGS: Record<CharacterId, Record<StringKey, readonly string[]>> = {
  stitch: {
    stretch: [
      '{name}! Stretch time!',
      'Ohana says stretch, {name}! Ehh-ha!',
      'Hey {name}, reach for the sky!',
      'Stretch with me, {name}! Hehe!',
    ],
    water: [
      '{name}! Water time! Glug glug!',
      'Drink some water, {name}!',
      'Hydrate, {name}! Cheers!',
      'Ohana stays hydrated! Drink up, {name}!',
    ],
    message: ['Hey {name}! Look!', 'Psst, {name}! Reminder!', '{name}! Message for you!'],
    pomodoroFocus: [
      'Focus time, {name}! You got this!',
      "Let's go, {name}! Focus mode!",
      'Locked in! Go go go, {name}!',
    ],
    pomodoroBreak: [
      'Break time, {name}! Relax!',
      'Ahh, break! Take it easy, {name}.',
      'Rest up, {name}. Ohana time!',
    ],
    pomodoroDone: [
      'All done, {name}! So proud!',
      "You did it, {name}! Ohana's proud!",
      'Woohoo! Great job, {name}!',
    ],
    done: ['{agent} finished! Yay {name}!', '{agent} is done! Woohoo!', 'Ta-da! {agent} finished, {name}!'],
    alert: ['{agent} needs you, {name}!', 'Uh oh! {agent} needs you!', '{name}! {agent} is calling!'],
    error: ['{agent} hit an error!', 'Uh oh, {agent} broke something, {name}!', 'Oh no! {agent} had a problem!'],
    thinking: ['{agent} is thinking...', 'Shh, {agent} is thinking...', '{agent} is cooking...'],
    thinkingMany: ['{agents} are thinking...', 'Busy busy! {agents} thinking...', '{agents} are on it...'],
    bedtime: [
      'It is late, {name}... go to bed!',
      'Sleepy... go to bed, {name}!',
      'Ohana needs sleep, {name}. Bed time!',
    ],
  },
  yoda: {
    stretch: [
      'Stretch, {name}, you must.',
      'Stiff your back is, {name}. Stretch!',
      'Hmm, stretch you should, yes.',
      'Reach for the sky, {name}, you will.',
    ],
    water: [
      'Drink water you should, hmm.',
      'Thirsty you are, {name}. Drink!',
      'Hydrate, {name}, you must.',
      'Water, the Force needs. Drink you will.',
    ],
    message: ['A message for you, {name}, there is.', 'Remember this, {name}, you must.', 'Hmm, reminder this is.'],
    pomodoroFocus: [
      'Focus, {name}, you must.',
      'Do or do not. Focus, {name}.',
      'Clear your mind you will. Focus!',
    ],
    pomodoroBreak: [
      'Rest now, {name}, you should.',
      'A break you have earned, hmm.',
      'Relax, {name}. Breathe, you will.',
    ],
    pomodoroDone: [
      'Done, all cycles are. Proud I am, {name}.',
      'Well done, {name}, you have.',
      'Strong with focus you are, {name}.',
    ],
    done: ['Finished, {agent} is. Well done, {name}.', 'Done, {agent} is. Hmm.', 'Complete, {agent} has. Good, yes.'],
    alert: ['Needs you, {agent} does, {name}.', 'Disturbance in the code. {agent} calls.', 'Come, {name}. {agent} needs you.'],
    error: ['Failed, {agent} has. Hmm.', 'An error, {agent} met. Look, {name}, you must.', 'Troubled, {agent} is.'],
    thinking: ['Thinking, {agent} is...', 'Hmm, {agent} ponders...', 'Patience. {agent} thinks...'],
    thinkingMany: ['Thinking, {agents} are...', 'Many minds work: {agents}...', 'Ponder, {agents} do...'],
    bedtime: [
      'Late it is, {name}. Sleep you must.',
      'To bed go, {name}. Rest, you need.',
      'Tired you look, {name}. Hmm. Sleep!',
    ],
  },
};

export const AGENT_LABEL: Record<AgentId, string> = {
  'claude-code': 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  gemini: 'Gemini',
  antigravity: 'Antigravity',
  kiro: 'Kiro',
  copilot: 'Copilot',
  opencode: 'OpenCode',
  devin: 'Devin',
  generic: 'Agent',
};

export function agentLabel(agent: string): string {
  return (AGENT_LABEL as Record<string, string>)[agent] ?? 'Agent';
}

/** Remove the {name} token (and its punctuation) when the user has no name set. */
export function stripName(s: string): string {
  let out = s
    .replace(/^\s*\{name\}[!,.:]?\s*/, '')
    .replace(/,\s*\{name\}/g, '')
    .replace(/\s*\{name\}/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
  if (out.length > 0) out = out[0]!.toUpperCase() + out.slice(1);
  return out;
}

export interface Vars {
  name?: string;
  agent?: string;
  agents?: string;
}

export function format(template: string, v: Vars = {}): string {
  const name = (v.name ?? '').trim();
  let s = name ? template.replace(/\{name\}/g, name) : stripName(template);
  if (v.agent !== undefined) s = s.replace(/\{agent\}/g, v.agent);
  if (v.agents !== undefined) s = s.replace(/\{agents\}/g, v.agents);
  return s;
}

/** Pick a random variant for `key` (never the same index twice in a row when `avoid` is given). */
export function pick(
  character: CharacterId,
  key: StringKey,
  vars: Vars,
  rng: () => number = Math.random,
  avoid = -1,
): { text: string; index: number } {
  const list = STRINGS[character][key];
  let i = Math.floor(rng() * list.length) % list.length;
  if (i === avoid && list.length > 1) i = (i + 1) % list.length;
  return { text: format(list[i]!, vars), index: i };
}

/** Truncate with ASCII dots so the pixel font never needs a fallback glyph. */
export function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, Math.max(1, max - 3)).trimEnd()}...`;
}
