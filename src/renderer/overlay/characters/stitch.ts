// Stitch: chibi blue alien. Parts are authored procedurally into 64x64 key-grids (see engine/rig.ts).
import type { Palette } from '@shared/types';
import { GridBuilder, makePart, type Part } from '../engine/rig';
import type { EarPose, MouthName } from '../engine/types';
import { createRigCharacter, defaultPoses, mirrorArm, splitLR, type ArmSpec, type Pt, type RigDef } from './kit';

/* ---------- head ---- */
function buildHead(): Part {
  const b = new GridBuilder();
  b.ellipse(32, 29, 17.5, 14, 'b').ellipse(32, 35, 14.5, 8.5, 'b');
  // darker eye patches, slanting down and out
  b.both(() => b.rotEllipse(24.6, 29, 6.4, 8.2, 14, 'd', { over: 'b' }));
  // forehead tufts (light blue)
  b.poly(
    [
      [30, 24],
      [32, 15.5],
      [34, 24],
    ],
    'w',
    { over: 'b' },
  );
  b.both(() =>
    b.poly(
      [
        [24.2, 22.5],
        [26.8, 16.8],
        [29, 22.5],
      ],
      'w',
      { over: 'b' },
    ),
  );
  // nose
  b.ellipse(32, 33.4, 3.2, 2.1, 'N');
  b.set(30, 32, 'W').set(31, 32, 'W');
  b.underShade('b', 's');
  // cheek light
  b.both(() => b.set(17, 33, 'u', { over: 'b' }).set(18, 34, 'u', { over: 'b' }));
  return makePart(b.rows());
}

/* ---------- body / feet ---- */
function buildBody(): Part {
  const b = new GridBuilder();
  b.ellipse(32, 52, 10.5, 9, 'b').ellipse(32, 46.5, 8, 5.5, 'b');
  b.ellipse(32, 53, 6.6, 6.4, 'w', { over: 'b' });
  b.underShade('w', 'l').underShade('b', 's');
  return makePart(b.rows());
}

function buildFeet(): Part {
  const b = new GridBuilder();
  b.both(() => {
    b.ellipse(25, 59.4, 5.4, 2.6, 'b');
  });
  b.underShade('b', 's');
  b.both(() => {
    b.set(21, 61, 'W').set(23, 61, 'W').set(25, 61, 'W');
  });
  return makePart(b.rows());
}

/* ---------- ears ---- */
interface EarGeom {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  deg: number;
}
const EAR_GEOM: Record<EarPose, EarGeom> = {
  neutral: { cx: 12.5, cy: 15.5, rx: 6.6, ry: 12.5, deg: -28 },
  perk: { cx: 15, cy: 12.5, rx: 6.2, ry: 13.5, deg: -13 },
  droop: { cx: 9.5, cy: 25, rx: 6.6, ry: 12, deg: -72 },
  back: { cx: 14, cy: 22.5, rx: 6, ry: 11, deg: -60 },
  flare: { cx: 8.5, cy: 15, rx: 6.8, ry: 12.5, deg: -50 },
};

function buildEars(): Record<EarPose, { L: Part; R: Part }> {
  const out = {} as Record<EarPose, { L: Part; R: Part }>;
  (Object.keys(EAR_GEOM) as EarPose[]).forEach((pose) => {
    const g = EAR_GEOM[pose];
    const a = (g.deg * Math.PI) / 180;
    const axis = [Math.sin(a), -Math.cos(a)] as const; // base -> tip
    const nrm = [-Math.cos(a), -Math.sin(a)] as const; // outward (left) normal
    const b = new GridBuilder();
    b.both(() => {
      b.rotEllipse(g.cx, g.cy, g.rx, g.ry, g.deg, 'b');
      // pink inner, slightly toward the base
      b.rotEllipse(g.cx - axis[0] * 1.4, g.cy - axis[1] * 1.4, g.rx * 0.58, g.ry * 0.72, g.deg, 'p', {
        over: 'b',
      });
      b.rotEllipse(g.cx - axis[0] * 5, g.cy - axis[1] * 5, g.rx * 0.38, g.ry * 0.3, g.deg, 'q', { over: 'p' });
      // notches on the outer edge
      for (const s of [0.1, 0.46]) {
        const nx = g.cx + axis[0] * g.ry * s + nrm[0] * g.rx * 0.96;
        const ny = g.cy + axis[1] * g.ry * s + nrm[1] * g.rx * 0.96;
        b.ellipse(nx, ny, 1.25, 1.25, '.');
      }
    });
    out[pose] = splitLR(b);
  });
  return out;
}

/* ---------- mouths ---- */
const MOUTH_ROWS: Record<MouthName, string[]> = {
  neutral: ['o.........o', '.ooooooooo.'],
  happy: ['oooooooooooo', 'oWWWWWWWWWWo', '.oRRRRRRRRo.', '..oRRTTRRo..', '...oooooo...'],
  open: ['.oooooooooo.', 'oRRRRRRRRRRo', 'oRRRRRRRRRRo', 'oRRRTTTTRRRo', '.oRTTTTTTRo.', '..oooooooo..'],
  o: ['.oooo.', 'oRRRRo', 'oRRRRo', '.oooo.'],
  flat: ['oooooooo'],
  smirk: ['.......oo.', '.oooooo...', 'oo........'],
  'cat-smile': ['.oo....oo.', 'o..o..o..o', '...oooo...'],
  grin: [
    'oooooooooooooo',
    'oWWWWWWWWWWWWo',
    'oWWWWWWWWWWWWo',
    '.oRRRRRRRRRRo.',
    '..ooRRTTRRoo..',
    '....oooooo....',
  ],
  wobbly: ['.o..o..o.', 'o.oo.oo.o'],
  tongue: ['ooooooooooo', '.ooooooooo.', '...oTTTo...', '...oTTTo...', '....ooo....'],
  yawn: ['.oooooooo.', 'oRRRRRRRRo', 'oRRTTTTRRo', 'oRRTTTTRRo', 'oRRRRRRRRo', '.oooooooo.'],
};

function buildMouths(oy: number): Record<MouthName, Part> {
  const out = {} as Record<MouthName, Part>;
  for (const k of Object.keys(MOUTH_ROWS) as MouthName[]) {
    const rows = MOUTH_ROWS[k];
    out[k] = { rows, ox: Math.round(32 - rows[0]!.length / 2), oy };
  }
  return out;
}

/* ---------- arms ---- */
const S_L: Pt = [23, 47];
const arm = (h: Pt, s: Pt = S_L): [Pt, Pt] => [s, h];
const pair = (l: [Pt, Pt]): { L: [Pt, Pt]; R: [Pt, Pt] } => ({ L: l, R: mirrorArm(l) });

const ARMS: ArmSpec = {
  hand: 'b',
  r: 2.1,
  hr: 2.7,
  claw: 'W',
  poses: {
    down: pair(arm([20, 54])),
    'knead-L': { L: arm([25, 58]), R: mirrorArm(arm([22, 50])) },
    'knead-R': { L: arm([22, 50]), R: mirrorArm(arm([25, 58])) },
    up: pair(arm([15, 13], [22, 46])),
    'hold-cup': pair(arm([27, 50])),
    'hold-paper': pair(arm([24, 51])),
    chin: { L: arm([20, 54]), R: [[41, 47], [37, 43]] },
    wave0: { L: arm([20, 54]), R: [[41, 47], [50, 35]] },
    wave1: { L: arm([20, 54]), R: [[41, 47], [52, 37]] },
  },
};

/* ---------- props ---- */
function buildCup(): Part {
  const b = new GridBuilder();
  b.stamp(['CCCCCCCC', 'CWCCCCCC', 'CWccccCC', 'CWccccCC', 'CCccccCC', 'CCccccCC', '.CccccC.', '.CCCCCC.'], 28, 43);
  return makePart(b.rows());
}
function buildLaptop(): Part {
  const b = new GridBuilder();
  b.rect(24, 49, 16, 9, 'G').rect(22, 58, 20, 2, 'g');
  b.rect(31, 52, 2, 2, 'W').underShade('G', 'g');
  return makePart(b.rows());
}
function buildNote(): Part {
  const b = new GridBuilder();
  b.rect(27, 44, 10, 10, 'Y').rect(29, 47, 6, 1, 'y').rect(29, 49, 5, 1, 'y').rect(29, 51, 6, 1, 'y');
  return makePart(b.rows());
}
function buildRoll(): Part {
  const b = new GridBuilder();
  b.rect(23, 46, 18, 5, 'P').rect(23, 50, 18, 1, 'Q');
  b.both(() => {
    b.ellipse(23, 48.5, 2.8, 2.8, 'P').ellipse(23, 48.5, 1.5, 1.5, 'Q').set(23, 48, 'P');
  });
  return makePart(b.rows());
}

export function createStitchRig(): RigDef {
  return {
    id: 'stitch',
    head: buildHead(),
    body: buildBody(),
    feet: buildFeet(),
    ears: buildEars(),
    mouths: buildMouths(36),
    eye: { style: 'solid', lx: 25, rx: 39, cy: 28, hw: 4, hh: 5, baseLid: 0, browDy: 4 },
    arms: ARMS,
    poses: defaultPoses(),
    props: { cup: buildCup(), laptop: buildLaptop(), note: buildNote(), roll: buildRoll() },
    face: { blushY: 34, blushDx: 5, sweat: [46, 15], vein: [45, 14], tearY: 33 },
  };
}

export const createStitch = (palette: Palette) => createRigCharacter(createStitchRig(), palette);
