// Stitch: chibi blue alien. Parts are authored procedurally into 64x64 key-grids (see engine/rig.ts).
// Footprint: ~46 px tall (ear tip y~16 to feet y=62) inside the 64x64 box.
import type { Palette } from '@shared/types';
import { GridBuilder, makePart, type Part } from '../engine/rig';
import type { EarPose, MouthName } from '../engine/types';
import { createRigCharacter, defaultPoses, mirrorArm, splitLR, type ArmSpec, type Pt, type RigDef } from './kit';
import { buildCup, buildLaptop, buildNote, buildRoll } from './props';

/* ---------- face geometry (shared by head, eyes and anchors) ---- */
const EYE = { lx: 26.3, rx: 37.7, cy: 35.6, hw: 3.5, hh: 4.8 };
const HEAD_CY = 36;
const MOUTH_Y = 43;

/* ---------- head ---- */
function buildHead(): Part {
  const b = new GridBuilder();
  // koala-like head: wide cranium + puffy cheeks, wider than the body
  b.ellipse(32, HEAD_CY, 13.6, 10.2, 'b').ellipse(32, 41, 12.6, 7, 'b');
  // cheek fluff bumps
  b.both(() => b.ellipse(19.6, 40.5, 1.6, 2.2, 'b'));
  // darker eye patches, slanting down and out
  b.both(() => b.rotEllipse(26.1, 35.9, 4.7, 5.9, 16, 'd', { over: 'b' }));
  // light-blue crown marking running up from between the eyes
  b.poly(
    [
      [30.4, 32.5],
      [29.6, 29],
      [32, 25.6],
      [34.4, 29],
      [33.6, 32.5],
    ],
    'w',
    { over: 'bd' },
  );
  // dark crown stripes
  b.rect(31.5, 25, 1, 3, 's').both(() => b.set(27, 27, 's', { over: 'b' }).set(28, 26, 's', { over: 'b' }));
  b.both(() => b.set(25, 28, 's', { over: 'b' }));
  // big wide dark-navy nose with a glint
  b.ellipse(32, 40.9, 3.6, 2.1, 'o');
  b.set(30, 40, 'n').set(31, 40, 'n');
  b.underShade('b', 's');
  // cheek light
  b.both(() => b.set(19, 38, 'u', { over: 'b' }).set(20, 37, 'u', { over: 'b' }));
  return makePart(b.rows());
}

/* ---------- body / feet ---- */
function buildBody(): Part {
  const b = new GridBuilder();
  b.ellipse(32, 54.6, 8.4, 7, 'b').ellipse(32, 49.5, 6.4, 3.6, 'b');
  // light-blue chest patch
  b.ellipse(32, 55.6, 5.2, 5, 'w', { over: 'b' });
  b.underShade('w', 'l').underShade('b', 's');
  // darker back/sides
  b.both(() => b.rect(23.6, 52, 1, 5, 's', { over: 'b' }));
  return makePart(b.rows());
}

function buildFeet(): Part {
  const b = new GridBuilder();
  b.both(() => b.ellipse(26.6, 60.6, 3.7, 1.9, 'b'));
  b.underShade('b', 's');
  // dark toe claws
  b.both(() => b.set(23, 61, 'n').set(25, 61, 'n').set(27, 61, 'n'));
  return makePart(b.rows());
}

/* ---------- ears ---- */
interface EarGeom {
  /** base (where the ear joins the head) */
  bx: number;
  by: number;
  rx: number;
  ry: number;
  /** clockwise rotation of the base->tip axis from vertical (negative = outward on the left) */
  deg: number;
}
const EAR_GEOM: Record<EarPose, EarGeom> = {
  neutral: { bx: 23.2, by: 30.5, rx: 6.2, ry: 9.4, deg: -45 },
  perk: { bx: 23.6, by: 29.5, rx: 6.2, ry: 10, deg: -38 },
  droop: { bx: 21.6, by: 32.5, rx: 5.4, ry: 8.8, deg: -108 },
  back: { bx: 23.4, by: 30.5, rx: 5, ry: 7.4, deg: -62 },
  flare: { bx: 22.6, by: 31, rx: 6.2, ry: 9.4, deg: -64 },
};

function buildEars(): Record<EarPose, { L: Part; R: Part }> {
  const out = {} as Record<EarPose, { L: Part; R: Part }>;
  (Object.keys(EAR_GEOM) as EarPose[]).forEach((pose) => {
    const g = EAR_GEOM[pose];
    const a = (g.deg * Math.PI) / 180;
    const axis = [Math.sin(a), -Math.cos(a)] as const; // base -> tip
    const nrm = [-Math.cos(a), -Math.sin(a)] as const; // outward (left) normal
    const cx = g.bx + axis[0] * g.ry * 0.74;
    const cy = g.by + axis[1] * g.ry * 0.74;
    const at = (s: number, n: number): Pt => [cx + axis[0] * g.ry * s + nrm[0] * g.rx * n, cy + axis[1] * g.ry * s + nrm[1] * g.rx * n];
    const b = new GridBuilder();
    b.both(() => {
      b.rotEllipse(cx, cy, g.rx, g.ry, g.deg, 'b');
      // dark-navy interior, pink-purple inner area towards the base
      const [nx, ny] = at(-0.06, -0.08);
      b.rotEllipse(nx, ny, g.rx * 0.62, g.ry * 0.8, g.deg, 'n', { over: 'b' });
      const [px, py] = at(-0.2, -0.1);
      b.rotEllipse(px, py, g.rx * 0.36, g.ry * 0.52, g.deg, 'p', { over: 'n' });
    });
    // the signature notch near the tip of the left ear only
    const [qx, qy] = at(0.55, 0.98);
    b.ellipse(qx, qy, 1.5, 1.5, '.');
    out[pose] = splitLR(b);
  });
  return out;
}

/* ---------- mouths (very wide) ---- */
const MOUTH_ROWS: Record<MouthName, string[]> = {
  neutral: ['o............o', '.oooooooooooo.'],
  happy: ['oooooooooooooo', 'oWWWWWWWWWWWWo', '.oRRRRTTRRRRo.', '..oooooooooo..'],
  open: ['.oooooooooooo.', 'oRRRRRRRRRRRRo', 'oRRRTTTTTTRRRo', '.oRTTTTTTTTRo.', '..oooooooooo..'],
  o: ['.ooo.', 'oRRRo', 'oRTRo', '.ooo.'],
  flat: ['oooooooooo'],
  smirk: ['..........oo', '.oooooooooo.', 'oo..........'],
  'cat-smile': ['o....oo....o', '.oooo..oooo.'],
  grin: [
    'oooooooooooooooo',
    'oWWWWWWWWWWWWWWo',
    '.oRRRRRRRRRRRRo.',
    '..oWWWWWWWWWWo..',
    '...oooooooooo...',
  ],
  wobbly: ['.o..o..o..o.', 'o.oo.oo.oo.o'],
  tongue: ['oooooooooooo', '.oooooooooo.', '....oTTo....', '....oTTo....', '.....oo.....'],
  yawn: ['..oooooooo..', '.oRRRRRRRRo.', 'oRRRTTTTRRRo', 'oRRTTTTTTRRo', '.oooooooooo.'],
};

function buildMouths(oy: number): Record<MouthName, Part> {
  const out = {} as Record<MouthName, Part>;
  for (const k of Object.keys(MOUTH_ROWS) as MouthName[]) {
    const rows = MOUTH_ROWS[k];
    out[k] = { rows, ox: Math.round(32 - rows[0]!.length / 2), oy };
  }
  return out;
}

/* ---------- arms (short and stubby, dark claws) ---- */
const S_L: Pt = [25, 50];
const arm = (h: Pt, s: Pt = S_L): [Pt, Pt] => [s, h];
const pair = (l: [Pt, Pt]): { L: [Pt, Pt]; R: [Pt, Pt] } => ({ L: l, R: mirrorArm(l) });

const ARMS: ArmSpec = {
  hand: 'b',
  r: 1.7,
  hr: 2.2,
  claw: 'n',
  clawAt: -0.5,
  clawSpread: 1.2,
  poses: {
    down: pair(arm([22.5, 56])),
    'knead-L': { L: arm([26.5, 59]), R: mirrorArm(arm([24, 53])) },
    'knead-R': { L: arm([24, 53]), R: mirrorArm(arm([26.5, 59])) },
    up: pair(arm([18, 24], [24.5, 49])),
    'hold-cup': pair(arm([27.5, 53.5])),
    'hold-paper': pair(arm([25.5, 53.5])),
    chin: { L: arm([22.5, 56]), R: [[39, 50], [36.5, 46.5]] },
    wave0: { L: arm([22.5, 56]), R: [[39, 50], [46, 40]] },
    wave1: { L: arm([22.5, 56]), R: [[39, 50], [47.5, 42]] },
  },
};

export function createStitchRig(): RigDef {
  return {
    id: 'stitch',
    head: buildHead(),
    body: buildBody(),
    feet: buildFeet(),
    ears: buildEars(),
    mouths: buildMouths(MOUTH_Y),
    eye: { style: 'solid', ...EYE, tilt: 14, baseLid: 0, browDy: 2, browKey: 'u', browW: 4, travel: [1.2, 1] },
    arms: ARMS,
    poses: defaultPoses(),
    props: { cup: buildCup(), laptop: buildLaptop(), note: buildNote(), roll: buildRoll() },
    sheet: { x: 26, y: 55, w: 12 },
    face: { blushY: 40, blushDx: 4, sweat: [43, 30], vein: [37, 26], tearY: 39, steam: [16, 16] },
    headCy: HEAD_CY,
    shadowW: 13,
  };
}

export const createStitch = (palette: Palette) => createRigCharacter(createStitchRig(), palette);
