// Yoda: chibi green jedi master with long pointed ears, sparse hair, robe and a wooden cane.
import type { Palette } from '@shared/types';
import { GridBuilder, makePart, type Part } from '../engine/rig';
import type { EarPose, MouthName } from '../engine/types';
import { createRigCharacter, defaultPoses, mirrorArm, splitLR, type ArmSpec, type Pt, type RigDef } from './kit';

function buildHead(): Part {
  const b = new GridBuilder();
  b.ellipse(32, 25.5, 13.8, 12.2, 'b').ellipse(32, 30.5, 11.8, 8, 'b');
  // forehead wrinkles
  b.rect(26, 16, 5, 1, 's', { over: 'b' }).rect(33, 16, 5, 1, 's', { over: 'b' });
  b.both(() => b.rect(24, 18, 4, 1, 's', { over: 'b' }));
  b.rect(30, 18, 4, 1, 's', { over: 'b' });
  // brow ridges
  b.both(() => b.rect(21, 20, 7, 1, 's', { over: 'b' }));
  // nose + cheek wrinkles
  b.rect(31, 27, 2, 2, 's');
  b.both(() => {
    b.set(23, 32, 's', { over: 'b' }).set(22, 31, 's', { over: 'b' }).set(23, 34, 's', { over: 'b' });
  });
  b.underShade('b', 's');
  b.topLight('b', 'u');
  return makePart(b.rows());
}

function buildHair(): Part {
  const b = new GridBuilder();
  const strand = (pts: Pt[]) => pts.forEach(([x, y]) => b.set(x, y, 'H'));
  strand([
    [28, 13],
    [28, 12],
    [27, 11],
    [27, 10],
    [26, 9],
  ]);
  strand([
    [32, 12],
    [32, 11],
    [33, 10],
    [33, 9],
    [34, 8],
  ]);
  strand([
    [36, 13],
    [36, 12],
    [37, 11],
    [38, 10],
  ]);
  strand([
    [23, 16],
    [22, 15],
    [21, 15],
  ]);
  strand([
    [41, 16],
    [42, 15],
    [43, 15],
  ]);
  return makePart(b.rows(), { outline: false });
}

function buildBody(): Part {
  const b = new GridBuilder();
  // robe
  b.poly(
    [
      [25.5, 38],
      [38.5, 38],
      [43.5, 61],
      [20.5, 61],
    ],
    'a',
  );
  b.ellipse(32, 41.5, 9.5, 4, 'a');
  // tunic V + belt
  b.poly(
    [
      [28.5, 38],
      [35.5, 38],
      [32, 48],
    ],
    'A',
    { over: 'a' },
  );
  b.rect(22, 51, 20, 2, 'D', { over: 'a' });
  b.rect(31, 51, 2, 2, 'y');
  // folds and hem
  b.rect(27, 54, 1, 7, 'z', { over: 'a' }).rect(36, 54, 1, 7, 'z', { over: 'a' });
  b.rect(21, 60, 22, 1, 'z', { over: 'a' });
  b.underShade('a', 'z');
  return makePart(b.rows());
}

function buildFeet(): Part {
  const b = new GridBuilder();
  b.both(() => b.ellipse(27, 61, 3.4, 1.4, 'b'));
  return makePart(b.rows());
}

/* ears: long leaves pointing outwards, tips set per pose */
const EAR_TIP: Record<EarPose, Pt> = {
  neutral: [3, 28],
  perk: [3, 15],
  droop: [7, 41],
  back: [10, 31],
  flare: [1, 22],
};

function buildEars(): Record<EarPose, { L: Part; R: Part }> {
  const out = {} as Record<EarPose, { L: Part; R: Part }>;
  (Object.keys(EAR_TIP) as EarPose[]).forEach((pose) => {
    const T = EAR_TIP[pose];
    const B1: Pt = [21, 20];
    const B2: Pt = [21, 30];
    const lerp = (a: Pt, c: Pt, t: number): Pt => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
    const off = (p: Pt, dy: number): Pt => [p[0], p[1] + dy];
    const outer: Pt[] = [
      B1,
      off(lerp(B1, T, 0.25), -2.5),
      off(lerp(B1, T, 0.55), -2.8),
      off(lerp(B1, T, 0.85), -1.2),
      T,
      off(lerp(B2, T, 0.85), 1.2),
      off(lerp(B2, T, 0.55), 2.4),
      off(lerp(B2, T, 0.25), 2.4),
      B2,
    ];
    const cl = (x: number): number => 25 + (T[1] - 25) * ((21 - x) / (21 - T[0]));
    const inner: Pt[] = outer.slice(1, -1).map(([x, y]) => {
      const c = cl(x);
      return [x + (x < 12 ? 1.5 : 0), c + (y - c) * 0.52] as Pt;
    });
    const b = new GridBuilder();
    b.both(() => {
      b.poly(outer, 'b');
      b.poly([[21, 22], ...inner, [21, 28.5]], 'p', { over: 'b' });
      // wrinkle lines
      for (const f of [0.3, 0.5, 0.7]) {
        const p = lerp(B1, T, f);
        b.set(Math.round(p[0]), Math.round(p[1] - 1), 's', { over: 'b' });
      }
    });
    out[pose] = splitLR(b);
  });
  return out;
}

const MOUTH_ROWS: Record<MouthName, string[]> = {
  neutral: ['.ooooo.', 'o.....o'],
  happy: ['o.......o', '.ooooooo.'],
  open: ['.ooooo.', 'oRRRRRo', 'oRTTTRo', '.ooooo.'],
  o: ['.ooo.', 'oRRRo', '.ooo.'],
  flat: ['ooooooo'],
  smirk: ['.....oo.', '.oooo...', 'oo......'],
  'cat-smile': ['.oo..oo.', 'o..oo..o'],
  grin: ['o.......o', 'oWWWWWWWo', '.ooooooo.'],
  wobbly: ['.o..o..o', 'o.oo.oo.'],
  tongue: ['.ooooo.', '..oTTo.', '..oTTo.', '...oo..'],
  yawn: ['.ooooo.', 'oRRRRRo', 'oRTTTRo', 'oRTTTRo', '.ooooo.'],
};

function buildMouths(oy: number): Record<MouthName, Part> {
  const out = {} as Record<MouthName, Part>;
  for (const k of Object.keys(MOUTH_ROWS) as MouthName[]) {
    const rows = MOUTH_ROWS[k];
    out[k] = { rows, ox: Math.round(32 - rows[0]!.length / 2), oy };
  }
  return out;
}

const S_L: Pt = [25, 45];
const arm = (h: Pt, s: Pt = S_L): [Pt, Pt] => [s, h];
const pair = (l: [Pt, Pt]): { L: [Pt, Pt]; R: [Pt, Pt] } => ({ L: l, R: mirrorArm(l) });
const CANE_HAND: Pt = [48, 48];

const ARMS: ArmSpec = {
  sleeve: 'a',
  hand: 'b',
  r: 2.2,
  hr: 2.4,
  claw: null,
  poses: {
    down: { L: arm([22, 53]), R: [[39, 45], CANE_HAND] },
    'knead-L': { L: arm([26, 57]), R: mirrorArm(arm([24, 50])) },
    'knead-R': { L: arm([24, 50]), R: mirrorArm(arm([26, 57])) },
    up: pair(arm([16, 15], [23, 44])),
    'hold-cup': pair(arm([27, 49])),
    'hold-paper': pair(arm([24, 50])),
    chin: { L: arm([22, 53]), R: [[39, 45], [36, 40]] },
    wave0: { L: arm([22, 53]), R: [[39, 45], [48, 34]] },
    wave1: { L: arm([22, 53]), R: [[39, 45], [50, 36]] },
  },
};

function buildCane(): Part {
  const b = new GridBuilder();
  b.rect(48, 36, 2, 26, 'B').rect(49, 36, 1, 26, 'D');
  b.ellipse(49, 35, 3, 2.6, 'B').set(50, 36, 'D');
  return makePart(b.rows(), { outlineCh: 'D' });
}
function buildCup(): Part {
  const b = new GridBuilder();
  b.stamp(['CCCCCCCC', 'CWCCCCCC', 'CWccccCC', 'CWccccCC', 'CCccccCC', 'CCccccCC', '.CccccC.', '.CCCCCC.'], 28, 42);
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
  b.rect(27, 43, 10, 10, 'Y').rect(29, 46, 6, 1, 'y').rect(29, 48, 5, 1, 'y').rect(29, 50, 6, 1, 'y');
  return makePart(b.rows());
}
function buildRoll(): Part {
  const b = new GridBuilder();
  b.rect(23, 45, 18, 5, 'P').rect(23, 49, 18, 1, 'Q');
  b.both(() => {
    b.ellipse(23, 47.5, 2.8, 2.8, 'P').ellipse(23, 47.5, 1.5, 1.5, 'Q').set(23, 47, 'P');
  });
  return makePart(b.rows());
}

export function createYodaRig(): RigDef {
  const poses = defaultPoses();
  return {
    id: 'yoda',
    head: buildHead(),
    hair: buildHair(),
    body: buildBody(),
    feet: buildFeet(),
    ears: buildEars(),
    mouths: buildMouths(33),
    eye: { style: 'sclera', lx: 26, rx: 38, cy: 26, hw: 4, hh: 3, baseLid: 2, browDy: 3 },
    arms: ARMS,
    poses,
    props: { cup: buildCup(), laptop: buildLaptop(), note: buildNote(), cane: buildCane(), roll: buildRoll() },
    autoProp: 'cane',
    face: { blushY: 31, blushDx: 4, sweat: [44, 14], vein: [43, 13], tearY: 30 },
  };
}

export const createYoda = (palette: Palette) => createRigCharacter(createYodaRig(), palette);
