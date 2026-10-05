// Yoda: chibi green jedi master: wide bald head, long horizontal ears, heavy brow, half-lidded eyes,
// cream tunic under a brown cloak, three-fingered hands and a gnarled gimer stick.
// Footprint: ~44 px tall (hair y~19 to feet y=62), ears span almost the full 64 px box.
import type { Palette } from '@shared/types';
import { GridBuilder, makePart, type Part } from '../engine/rig';
import type { EarPose, MouthName } from '../engine/types';
import { createRigCharacter, defaultPoses, mirrorArm, splitLR, type ArmSpec, type Pt, type RigDef } from './kit';
import { buildCup, buildLaptop, buildNote, buildRoll } from './props';

const EYE = { lx: 26.5, rx: 37.5, cy: 34.5, hw: 3.2, hh: 2.6 };
const HEAD_CY = 33;
const MOUTH_Y = 40;

function buildHead(): Part {
  const b = new GridBuilder();
  // wide domed cranium tapering to a smaller chin
  b.ellipse(32, HEAD_CY, 11.8, 9.2, 'b').ellipse(32, 37.6, 9.6, 5.6, 'b');
  b.underShade('b', 's');
  b.topLight('b', 'u');
  // heavy brow ridge (shadow underneath, highlight on top)
  b.both(() => b.rotEllipse(26.4, 31.2, 4.6, 1.3, -6, 's', { over: 'b' }));
  // forehead wrinkles
  b.rect(29, 26, 6, 1, 's', { over: 'b' });
  b.both(() => b.set(28, 25, 's', { over: 'b' }).rect(25, 28, 4, 1, 's', { over: 'b' }));
  // small nose: bridge highlight + nostril shadow
  b.set(31, 37, 'u').set(32, 37, 'u').rect(31, 38, 2, 1, 's');
  // cheek wrinkles / jowls
  b.both(() => b.set(23, 38, 's', { over: 'b' }).set(24, 39, 's', { over: 'b' }));
  return makePart(b.rows());
}

function buildHair(): Part {
  const b = new GridBuilder();
  const strand = (pts: Pt[]) => pts.forEach(([x, y]) => b.set(x, y, 'H'));
  // a few wispy white strands on the crown and behind the ears
  strand([
    [28, 24],
    [27, 23],
    [27, 22],
    [26, 21],
  ]);
  strand([
    [32, 24],
    [32, 23],
    [33, 22],
    [33, 21],
    [34, 20],
  ]);
  strand([
    [36, 24],
    [37, 23],
    [38, 22],
  ]);
  strand([
    [22, 28],
    [21, 27],
    [20, 27],
  ]);
  strand([
    [42, 28],
    [43, 27],
    [44, 27],
  ]);
  return makePart(b.rows(), { outline: false });
}

function buildBody(): Part {
  const b = new GridBuilder();
  // brown outer cloak
  b.poly(
    [
      [25, 41],
      [39, 41],
      [44, 61.5],
      [20, 61.5],
    ],
    'a',
  );
  b.ellipse(32, 43.5, 8.6, 3.4, 'a');
  // cream inner robe showing down the front, crossing at the chest
  b.poly(
    [
      [27.6, 41],
      [36.4, 41],
      [35.6, 61.5],
      [28.4, 61.5],
    ],
    'F',
    { over: 'a' },
  );
  // crossing lapels (left over right) and the V neckline
  for (let i = 0; i < 6; i++) b.set(28 + i, 41 + i, 'f');
  for (let i = 0; i < 4; i++) b.set(36 - i, 41 + i, 'f');
  b.rect(31, 41, 2, 1, 'f');
  // cloak edges + folds + hem
  b.both(() => b.poly([[27.2, 41], [28.2, 41], [29, 61.5], [27.9, 61.5]], 'z', { over: 'aF' }));
  b.both(() => b.rect(23, 52, 1, 9, 'z', { over: 'a' }));
  b.underShade('a', 'z').underShade('F', 'f');
  // sash
  b.rect(27, 51, 10, 1, 'D', { over: 'Ffz' });
  return makePart(b.rows());
}

function buildFeet(): Part {
  const b = new GridBuilder();
  b.both(() => b.ellipse(27.4, 61.6, 2.7, 1.2, 'b'));
  return makePart(b.rows());
}

/* ears: long, horizontal, slightly drooping, wider than the head; tips per pose */
const EAR_TIP: Record<EarPose, Pt> = {
  neutral: [2, 37],
  perk: [3, 27],
  droop: [6.5, 46],
  back: [9.5, 38],
  flare: [1, 32],
};

function buildEars(): Record<EarPose, { L: Part; R: Part }> {
  const out = {} as Record<EarPose, { L: Part; R: Part }>;
  (Object.keys(EAR_TIP) as EarPose[]).forEach((pose) => {
    const T = EAR_TIP[pose];
    const B1: Pt = [22, 29.5];
    const B2: Pt = [22, 37.5];
    const lerp = (a: Pt, c: Pt, t: number): Pt => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
    const off = (p: Pt, dy: number): Pt => [p[0], p[1] + dy];
    const outer: Pt[] = [
      B1,
      off(lerp(B1, T, 0.25), -1.6),
      off(lerp(B1, T, 0.55), -1.7),
      off(lerp(B1, T, 0.85), -0.6),
      T,
      off(lerp(B2, T, 0.85), 0.8),
      off(lerp(B2, T, 0.55), 1.6),
      off(lerp(B2, T, 0.25), 1.6),
      B2,
    ];
    // inner ear: the outer outline pulled towards the ear's centre line
    const mid = (x: number): number => {
      const k = (22 - x) / (22 - T[0]);
      return 33.5 + (T[1] - 33.5) * k;
    };
    const inner: Pt[] = outer.slice(1, -1).map(([x, y]) => {
      const c = mid(x);
      return [x + (x < 10 ? 1.6 : 0), c + (y - c) * 0.5] as Pt;
    });
    const b = new GridBuilder();
    b.both(() => {
      b.poly(outer, 'b');
      b.poly([[22, 31.2], ...inner, [22, 35.8]], 'i', { over: 'b' });
      // shading along the lower edge of the ear
      for (const f of [0.3, 0.55]) {
        const p = lerp(B2, T, f);
        b.set(Math.round(p[0]), Math.round(p[1] + 0.6), 's', { over: 'b' });
      }
    });
    out[pose] = splitLR(b);
  });
  return out;
}

/* thin, wide mouth */
const MOUTH_ROWS: Record<MouthName, string[]> = {
  neutral: ['..ooooo..', '.o.....o.'],
  happy: ['o.......o', '.ooooooo.'],
  open: ['.ooooo.', 'oRRRRRo', 'oRTTTRo', '.ooooo.'],
  o: ['.ooo.', 'oRRRo', '.ooo.'],
  flat: ['ooooooo'],
  smirk: ['......oo', '.ooooo..', 'oo......'],
  'cat-smile': ['o..oo..o', '.oo..oo.'],
  grin: ['o.......o', 'oWWWWWWWo', '.ooooooo.'],
  wobbly: ['.o..o..o', 'o.oo.oo.'],
  tongue: ['.ooooo.', '..oTTo.', '..oTTo.', '...oo..'],
  yawn: ['.ooooo.', 'oRRRRRo', 'oRTTTRo', '.ooooo.'],
};

function buildMouths(oy: number): Record<MouthName, Part> {
  const out = {} as Record<MouthName, Part>;
  for (const k of Object.keys(MOUTH_ROWS) as MouthName[]) {
    const rows = MOUTH_ROWS[k];
    out[k] = { rows, ox: Math.round(32 - rows[0]!.length / 2), oy };
  }
  return out;
}

const S_L: Pt = [26, 46];
const arm = (h: Pt, s: Pt = S_L): [Pt, Pt] => [s, h];
const pair = (l: [Pt, Pt]): { L: [Pt, Pt]; R: [Pt, Pt] } => ({ L: l, R: mirrorArm(l) });
const CANE_HAND: Pt = [45, 50];

const ARMS: ArmSpec = {
  sleeve: 'a',
  hand: 'b',
  r: 1.8,
  hr: 1.8,
  // three little fingers
  claw: 'b',
  clawAt: 0.4,
  clawSpread: 1.3,
  poses: {
    down: { L: arm([23.5, 53]), R: [[38, 46], CANE_HAND] },
    'knead-L': { L: arm([27, 57.5]), R: mirrorArm(arm([25, 51.5])) },
    'knead-R': { L: arm([25, 51.5]), R: mirrorArm(arm([27, 57.5])) },
    up: pair(arm([10.5, 40], [25.5, 45])),
    'hold-cup': pair(arm([27.5, 51.5])),
    'hold-paper': pair(arm([26, 52.5])),
    chin: { L: arm([23.5, 53]), R: [[38, 46], [35.5, 42]] },
    wave0: { L: arm([23.5, 53]), R: [[38, 46], [45, 38]] },
    wave1: { L: arm([23.5, 53]), R: [[38, 46], [46.5, 40]] },
  },
};

/* gnarled gimer stick */
function buildCane(): Part {
  const b = new GridBuilder();
  b.capsule(45.5, 61.5, 45, 50, 0.8, 'B').capsule(45, 50, 46, 40, 0.8, 'B');
  b.ellipse(46, 39.4, 1.9, 1.5, 'B');
  b.set(44, 38, 'B').set(48, 38, 'B'); // twigs
  b.set(46, 44, 'D').set(45, 53, 'D').set(46, 57, 'D').set(46, 39, 'D'); // knots
  return makePart(b.rows(), { outlineCh: 'D' });
}

export function createYodaRig(): RigDef {
  return {
    id: 'yoda',
    head: buildHead(),
    hair: buildHair(),
    body: buildBody(),
    feet: buildFeet(),
    ears: buildEars(),
    mouths: buildMouths(MOUTH_Y),
    eye: { style: 'sclera', ...EYE, irisR: 1.9, baseLid: 2, browDy: 2, browW: 5 },
    arms: ARMS,
    poses: defaultPoses(),
    props: { cup: buildCup(29, 47), laptop: buildLaptop(), note: buildNote(47), cane: buildCane(), roll: buildRoll(50) },
    sheet: { x: 26, y: 54, w: 12 },
    autoProp: 'cane',
    face: { blushY: 37, blushDx: 3, sweat: [41, 27], vein: [36, 24], tearY: 37, steam: [14, 22] },
    headCy: HEAD_CY,
    shadowW: 13,
  };
}

export const createYoda = (palette: Palette) => createRigCharacter(createYodaRig(), palette);
