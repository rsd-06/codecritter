// Expression gallery: every preset, both characters, side by side.
import { DEFAULT_PALETTES } from '@shared/defaults';
import type { CharacterId } from '@shared/types';
import { createCharacter } from '../overlay/characters';
import { EXPRESSION_NAMES } from '../overlay/engine/expression';
import { defaultPoseState, type PawPose, type PoseName } from '../overlay/engine/types';

const only = new URLSearchParams(location.search).get('only') as CharacterId | null;
const IDS: CharacterId[] = only ? [only] : ['stitch', 'yoda'];
const POSES: PoseName[] = ['sit', 'crouch', 'pounce', 'sleep', 'stretch', 'alert'];
const PAWS: PawPose[] = ['down', 'knead-L', 'knead-R', 'up', 'hold-cup', 'hold-paper', 'chin', 'wave'];

const grid = document.getElementById('grid')!;
const scaleSel = document.getElementById('gscale') as HTMLSelectElement;
const poseSel = document.getElementById('gpose') as HTMLSelectElement;
const pawsSel = document.getElementById('gpaws') as HTMLSelectElement;
POSES.forEach((p) => poseSel.add(new Option(p)));
PAWS.forEach((p) => pawsSel.add(new Option(p)));
const params = new URLSearchParams(location.search);
if (params.get('pose')) poseSel.value = params.get('pose')!;
if (params.get('paws')) pawsSel.value = params.get('paws')!;
if (params.get('scale')) scaleSel.value = params.get('scale')!;

const chars = Object.fromEntries(IDS.map((id) => [id, createCharacter(id, DEFAULT_PALETTES[id])])) as Record<
  CharacterId,
  ReturnType<typeof createCharacter>
>;

function render(): void {
  const scale = Number(scaleSel.value);
  grid.replaceChildren();
  for (const name of EXPRESSION_NAMES) {
    const card = document.createElement('figure');
    card.className = 'card';
    const row = document.createElement('div');
    row.className = 'pair';
    for (const id of IDS) {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      c.style.width = `${64 * scale}px`;
      c.style.height = `${64 * scale}px`;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      const st = defaultPoseState();
      st.expression = name;
      st.pose = poseSel.value as PoseName;
      st.paws = pawsSel.value as PawPose;
      chars[id].draw(ctx, st, 0);
      row.append(c);
    }
    const cap = document.createElement('figcaption');
    cap.textContent = name;
    card.append(row, cap);
    grid.append(card);
  }
}
[scaleSel, poseSel, pawsSel].forEach((s) => s.addEventListener('change', render));
render();
(window as unknown as { __gallery: unknown }).__gallery = { render };
