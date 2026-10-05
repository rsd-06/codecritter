import type { CharacterId, Palette } from '@shared/types';

export type PoseName = 'sit' | 'crouch' | 'pounce' | 'sleep' | 'stretch' | 'alert';
export type MouthName =
  | 'neutral'
  | 'happy'
  | 'open'
  | 'o'
  | 'flat'
  | 'smirk'
  | 'cat-smile'
  | 'grin'
  | 'wobbly'
  | 'tongue'
  | 'yawn';
export type PawPose =
  | 'down'
  | 'knead-L'
  | 'knead-R'
  | 'up'
  | 'hold-cup'
  | 'hold-paper'
  | 'chin'
  | 'wave';
export type PropName = 'cup' | 'paper' | 'laptop' | 'cane' | 'note';

export type EyeKind =
  | 'open'
  | 'half'
  | 'closed'
  | 'happy'
  | 'wide'
  | 'squint'
  | 'dizzy'
  | 'spiral'
  | 'hearts'
  | 'sparkle'
  | 'sleepy'
  | 'side-eye';
export type BrowKind = 'none' | 'raised' | 'furrowed' | 'worried' | 'angry';
export type EarPose = 'neutral' | 'perk' | 'droop' | 'back' | 'flare';
export type ExtraName = 'blush' | 'sweat' | 'tear' | 'vein' | 'steam';

export type ExpressionName =
  | 'neutral'
  | 'happy'
  | 'focused'
  | 'excited'
  | 'curious'
  | 'surprised'
  | 'love'
  | 'annoyed'
  | 'dizzy'
  | 'stressed'
  | 'sleepy'
  | 'bored'
  | 'thinking'
  | 'proud'
  | 'worried'
  | 'determined'
  | 'relaxed'
  | 'sneaky';

/** A fully composed expression (eyes x brows x mouth x ears x extras). */
export interface Expression {
  eyes: EyeKind;
  brows: BrowKind;
  mouth: MouthName;
  ears: EarPose;
  extras: ExtraName[];
}

export interface EyeState {
  /** blink multiplier 0 (closed) .. 1 (fully open) */
  open: number;
  /** pupil offset -1..1 (mean of both eyes, character-local frame) */
  lookX: number;
  lookY: number;
  /**
   * Convergence -1..1: the left eye uses lookX + conv, the right eye lookX - conv (positive =
   * cross-eyed towards a point between the eyes). Optional; 0 when absent.
   */
  conv?: number;
}

export interface Pt2 {
  x: number;
  y: number;
}

/** Where the face is, for a given pose (64x64 box coords, after pose/squash/scale). */
export interface CharAnchors {
  /** topmost pixel of the head incl. ears/hair (bubbles point here) */
  headTop: number;
  /** head centre (particles, petting) */
  head: Pt2;
  /** eye centres, left then right */
  eyes: [Pt2, Pt2];
  /** eye radius (min half size) in box px */
  eyeR: number;
}

/** Static geometry of a character at the neutral sit pose (box coords). */
export interface CharMetrics {
  /** topmost pixel incl. ears/hair */
  top: number;
  /** pixels from `top` that must stay visible while peeking (down to below the eyes) */
  peekDepth: number;
  /** half width of the ground shadow */
  shadowW: number;
}

export interface PoseState {
  pose: PoseName;
  /** preset name or a custom composed expression */
  expression: ExpressionName | Expression;
  /** optional override of the expression's mouth */
  mouth?: MouthName;
  paws: PawPose;
  eyes: EyeState;
  squashX: number;
  squashY: number;
  offsetX: number;
  offsetY: number;
  tint?: { color: string; amount: number };
  scale: number;
  prop?: PropName;
  /** 0..1, paper roll length / generic prop progress */
  propProgress?: number;
  /** peek amount 0 (not peeking) .. 1 (fully peeking); see engine/peek.ts */
  peek: number;
  peekEdge: 'left' | 'right' | 'bottom';
}

export interface Character {
  readonly id: CharacterId;
  readonly palette: Palette;
  /** Recompile every cached sprite for a new palette. */
  setPalette(p: Palette): void;
  /**
   * Draw into ctx. ctx origin = top-left of the 64x64 character box.
   * Feet anchor is at (32, 62); squash/scale/offset pivot about it.
   */
  draw(ctx: CanvasRenderingContext2D, pose: PoseState, t: number): void;
  readonly metrics: CharMetrics;
  /** Face anchors for this pose (box coords). */
  anchors(pose: PoseState): CharAnchors;
}

export function defaultPoseState(): PoseState {
  return {
    pose: 'sit',
    expression: 'neutral',
    paws: 'down',
    eyes: { open: 1, lookX: 0, lookY: 0, conv: 0 },
    squashX: 1,
    squashY: 1,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    peek: 0,
    peekEdge: 'bottom',
  };
}

/** Logical stage (character box 64x64 sits bottom-centre; room around for bubbles/particles). */
export const STAGE_W = 128;
export const STAGE_H = 112;
export const BOX = 64;
export const BOX_X = (STAGE_W - BOX) / 2; // 32
export const BOX_Y = STAGE_H - BOX; // 48
