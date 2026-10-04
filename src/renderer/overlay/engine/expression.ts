// Expression presets (pure) + a blender that blinks on expression change.
import type { CharacterId } from '@shared/types';
import type { Expression, ExpressionName } from './types';

const E = (
  eyes: Expression['eyes'],
  brows: Expression['brows'],
  mouth: Expression['mouth'],
  ears: Expression['ears'],
  extras: Expression['extras'] = [],
): Expression => ({ eyes, brows, mouth, ears, extras });

export const EXPRESSION_NAMES: readonly ExpressionName[] = [
  'neutral',
  'happy',
  'focused',
  'excited',
  'curious',
  'surprised',
  'love',
  'annoyed',
  'dizzy',
  'stressed',
  'sleepy',
  'bored',
  'thinking',
  'proud',
  'worried',
  'determined',
  'relaxed',
  'sneaky',
];

/** Baseline presets shared by all characters. */
export const EXPRESSIONS: Record<ExpressionName, Expression> = {
  neutral: E('open', 'none', 'neutral', 'neutral'),
  happy: E('happy', 'none', 'happy', 'neutral'),
  focused: E('half', 'furrowed', 'flat', 'neutral'),
  excited: E('sparkle', 'raised', 'open', 'flare'),
  curious: E('open', 'raised', 'smirk', 'perk'),
  surprised: E('wide', 'raised', 'o', 'perk'),
  love: E('hearts', 'none', 'happy', 'neutral', ['blush']),
  annoyed: E('half', 'angry', 'flat', 'back'),
  dizzy: E('spiral', 'none', 'wobbly', 'droop'),
  stressed: E('wide', 'worried', 'wobbly', 'back', ['sweat', 'steam']),
  sleepy: E('sleepy', 'none', 'yawn', 'droop'),
  bored: E('side-eye', 'none', 'flat', 'droop'),
  thinking: E('side-eye', 'raised', 'flat', 'neutral'),
  proud: E('happy', 'raised', 'grin', 'perk', ['blush']),
  worried: E('wide', 'worried', 'wobbly', 'droop', ['sweat']),
  determined: E('open', 'furrowed', 'smirk', 'neutral'),
  relaxed: E('closed', 'none', 'neutral', 'neutral'),
  sneaky: E('side-eye', 'furrowed', 'grin', 'back'),
};

/** Per-character style overrides (Yoda: wise half-lids, ear droop; Stitch: ears fold/flare, big grin). */
export const STYLE_OVERRIDES: Record<CharacterId, Partial<Record<ExpressionName, Partial<Expression>>>> = {
  stitch: {
    neutral: { mouth: 'neutral' },
    happy: { mouth: 'grin', ears: 'perk' },
    annoyed: { ears: 'back' },
    worried: { ears: 'back' },
    excited: { ears: 'flare', mouth: 'grin' },
    sneaky: { mouth: 'grin', ears: 'back', eyes: 'side-eye' },
    surprised: { ears: 'flare' },
    love: { ears: 'droop', mouth: 'cat-smile' },
    proud: { mouth: 'grin', ears: 'flare' },
    dizzy: { ears: 'droop' },
    relaxed: { mouth: 'cat-smile' },
  },
  yoda: {
    neutral: { eyes: 'open' },
    happy: { mouth: 'happy' },
    annoyed: { ears: 'back', mouth: 'flat' },
    worried: { ears: 'droop', brows: 'worried' },
    surprised: { ears: 'perk', mouth: 'o' },
    excited: { ears: 'perk', mouth: 'open', eyes: 'sparkle' },
    sneaky: { mouth: 'smirk', ears: 'back' },
    proud: { mouth: 'smirk', ears: 'perk', extras: [] },
    thinking: { eyes: 'half', brows: 'raised', mouth: 'flat' },
    determined: { eyes: 'half', mouth: 'flat' },
    stressed: { ears: 'back' },
    curious: { ears: 'perk', mouth: 'flat' },
    love: { mouth: 'smirk' },
  },
};

export function resolveExpression(id: CharacterId, e: ExpressionName | Expression): Expression {
  if (typeof e !== 'string') return e;
  return { ...EXPRESSIONS[e], ...(STYLE_OVERRIDES[id][e] ?? {}) };
}

const BLINK_DUR = 0.22;

/** Tracks the displayed expression, auto-blinks and blinks on change (swap happens with eyes shut). */
export class ExpressionBlender {
  private shown: ExpressionName = 'neutral';
  private target: ExpressionName = 'neutral';
  private blinkT = -1; // <0 = not blinking, else seconds into the blink
  private untilBlink: number;
  private autoOn = true;

  constructor(private rng: () => number = Math.random) {
    this.untilBlink = this.nextInterval();
  }

  private nextInterval(): number {
    return 2.2 + this.rng() * 3.8;
  }

  set(name: ExpressionName): void {
    if (name === this.target) return;
    this.target = name;
    if (this.blinkT < 0) this.blinkT = 0;
  }

  /** Jump without a blink. */
  snap(name: ExpressionName): void {
    this.shown = this.target = name;
  }

  /** `auto=false` pauses the idle blink timer (eyes already shut, e.g. sleeping). */
  update(dt: number, auto = true): void {
    this.autoOn = auto;
    if (this.blinkT >= 0) {
      const prev = this.blinkT;
      this.blinkT += dt;
      if (prev < BLINK_DUR / 2 && this.blinkT >= BLINK_DUR / 2) this.shown = this.target;
      // done once the lids are (almost) back up: avoids a redraw that shows nothing new
      if (this.blinkT >= BLINK_DUR || (this.blinkT > BLINK_DUR / 2 && this.eyeOpen >= 0.7)) {
        this.blinkT = -1;
        this.shown = this.target;
        this.untilBlink = this.nextInterval();
      }
      return;
    }
    if (!auto) return;
    this.untilBlink -= dt;
    // start with the lids already down so the first drawn frame differs (2 redraws per blink)
    if (this.untilBlink <= 0) this.blinkT = 0.1;
  }

  get current(): ExpressionName {
    return this.shown;
  }

  get blinking(): boolean {
    return this.blinkT >= 0;
  }

  /** 1 open .. 0 shut. */
  get eyeOpen(): number {
    if (this.blinkT < 0) return 1;
    const x = this.blinkT / (BLINK_DUR / 2) - 1; // -1..1
    return Math.min(1, Math.abs(x) * 1.15);
  }

  /** Seconds until the blender will change what is drawn on its own. */
  get nextChangeIn(): number {
    if (this.blinkT >= 0) return 0;
    return this.autoOn ? Math.max(0, this.untilBlink) : Infinity;
  }
}
