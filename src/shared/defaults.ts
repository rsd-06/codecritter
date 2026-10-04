import { AGENT_PORT } from './constants';
import type { CharacterId, Palette, Settings } from './types';

export const DEFAULT_PALETTES: Record<CharacterId, Palette> = {
  stitch: {
    outline: '#1b2a5c',
    body: '#3f7fd9',
    bodyShade: '#2f62b0',
    belly: '#a9d3f5',
    earInner: '#b0468f',
    eye: '#151521', // dark eye patches
    pupil: '#ffffff',
    accent: '#6a3fa0',
  },
  yoda: {
    outline: '#2b3a17',
    body: '#8db85a',
    bodyShade: '#6d9640',
    belly: '#c8dc9a',
    earInner: '#c9a07a',
    eye: '#2a1d10',
    pupil: '#ffffff',
    accent: '#8a5a2b', // robe
  },
};

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  character: 'stitch',
  userName: '',
  palettes: DEFAULT_PALETTES,
  scale: 2,
  opacity: 1,
  position: null,
  sound: { enabled: true, volume: 0.5 },
  reactions: {
    eyeFollow: true,
    hunt: true,
    purr: true,
    knead: true,
    overheat: true,
    paper: true,
    drag: true,
    sleep: true,
  },
  overheatKps: 8,
  reminders: {
    stretch: { enabled: true, everyMin: 50 },
    water: { enabled: true, everyMin: 40 },
  },
  pomodoro: { focusMin: 25, breakMin: 5, longBreakMin: 15, cyclesBeforeLong: 4 },
  messages: [],
  pinnedNote: '',
  dnd: { enabled: false, from: '22:00', to: '08:00' },
  peek: { auto: true, edge: 'bottom' },
  agents: { enabled: true, port: AGENT_PORT, token: '' },
  autostart: false,
  syncFolder: null,
};
