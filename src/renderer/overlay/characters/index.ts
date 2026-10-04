import type { CharacterId, Palette } from '@shared/types';
import type { Character } from '../engine/types';
import { createStitch } from './stitch';
import { createYoda } from './yoda';

export function createCharacter(id: CharacterId, palette: Palette): Character {
  return id === 'yoda' ? createYoda(palette) : createStitch(palette);
}

export { createStitchRig } from './stitch';
export { createYodaRig } from './yoda';
