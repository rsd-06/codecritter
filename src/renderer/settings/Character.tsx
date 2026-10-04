import { memo, useEffect, useRef, useState } from 'react';
import type { CharacterId, Palette } from '@shared/types';
import { createCharacter } from '../overlay/characters';
import { defaultPoseState, type Character, type ExpressionName } from '../overlay/engine/types';
import {
  PALETTE_KEYS,
  PALETTE_LABELS,
  PRESETS,
  matchPreset,
  paletteEdit,
  paletteReset,
  paletteSet,
} from './helpers';
import { ColorField, Section, useCtx, useVisible } from './ui';

const CYCLE: ExpressionName[] = ['happy', 'excited', 'curious', 'love', 'proud', 'sneaky'];
const STRIP: ExpressionName[] = ['neutral', 'happy', 'excited', 'curious', 'love', 'sleepy', 'surprised', 'annoyed'];
const FPS = 8;
const NAMES: Record<CharacterId, string> = { stitch: 'Stitch', yoda: 'Yoda' };

/** Lightweight preview: own setInterval at 8 fps, only while the document is visible. */
export const Preview = memo(function Preview(props: {
  id: CharacterId;
  palette: Palette;
  size: number;
  /** cycle through a few presets while true */
  cycling?: boolean;
  expression?: ExpressionName;
  label: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const charRef = useRef<Character | null>(null);
  const live = useRef({ cycling: !!props.cycling, expression: props.expression ?? 'neutral' });
  live.current = { cycling: !!props.cycling, expression: props.expression ?? 'neutral' };
  const palRef = useRef(props.palette);
  const visible = useVisible();

  const paint = useRef((tick: number): void => {
    const c = canvas.current;
    const ch = charRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ch || !ctx) return;
    const pose = defaultPoseState();
    const t = tick / FPS;
    const l = live.current;
    pose.expression = l.cycling ? (CYCLE[Math.floor(tick / 6) % CYCLE.length] ?? 'happy') : l.expression;
    pose.offsetY = Math.round(Math.sin(t * 2.2));
    pose.eyes.open = tick % 34 === 0 ? 0 : 1;
    const k = c.width / 64;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ch.draw(ctx, pose, t);
  });

  // (re)create character on id change
  useEffect(() => {
    charRef.current = createCharacter(props.id, palRef.current);
    paint.current(0);
  }, [props.id]);

  // palette / expression change -> immediate redraw
  useEffect(() => {
    palRef.current = props.palette;
    charRef.current?.setPalette(props.palette);
    paint.current(0);
  }, [props.palette, props.expression]);

  useEffect(() => {
    if (!visible) return;
    let tick = 0;
    const h = setInterval(() => {
      tick++;
      paint.current(tick);
    }, 1000 / FPS);
    return () => clearInterval(h);
  }, [visible]);

  return (
    <canvas
      ref={canvas}
      className="preview"
      width={64 * props.size}
      height={64 * props.size}
      role="img"
      aria-label={props.label}
    />
  );
});

const CharacterCard = memo(function CharacterCard(props: {
  id: CharacterId;
  palette: Palette;
  selected: boolean;
  onPick: (id: CharacterId) => void;
}) {
  const [hot, setHot] = useState(false);
  return (
    <button
      type="button"
      className={props.selected ? 'char-card selected' : 'char-card'}
      aria-pressed={props.selected}
      onClick={() => props.onPick(props.id)}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
    >
      <Preview
        id={props.id}
        palette={props.palette}
        size={3}
        cycling={hot}
        label={`${NAMES[props.id]} preview`}
      />
      <span className="char-name">{NAMES[props.id]}</span>
      {props.selected && <span className="badge">Active</span>}
    </button>
  );
});

export const CharacterTab = memo(function CharacterTab() {
  const { settings, save } = useCtx();
  const id = settings.character;
  const pal = settings.palettes[id];
  const [expr, setExpr] = useState<ExpressionName>('neutral');
  const current = matchPreset(id, pal);
  return (
    <Section title="Character" intro="Pick your companion, then tune its colours. Hover a card to see it emote.">
      <div className="cards">
        {(['stitch', 'yoda'] as const).map((cid) => (
          <CharacterCard
            key={cid}
            id={cid}
            palette={settings.palettes[cid]}
            selected={cid === id}
            onPick={(c) => save({ character: c })}
          />
        ))}
      </div>

      <h3>Expressions</h3>
      <div className="strip" role="group" aria-label="Expression preview">
        <Preview id={id} palette={pal} size={4} expression={expr} label={`${NAMES[id]} showing ${expr}`} />
        <div className="chips">
          {STRIP.map((e) => (
            <button
              key={e}
              type="button"
              className={e === expr ? 'chip on' : 'chip'}
              onMouseEnter={() => setExpr(e)}
              onFocus={() => setExpr(e)}
              onClick={() => setExpr(e)}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      <h3>Presets</h3>
      <div className="presets" role="group" aria-label="Colour presets">
        {PRESETS[id].map((p) => (
          <button
            key={p.name}
            type="button"
            className={current === p.name ? 'preset on' : 'preset'}
            aria-pressed={current === p.name}
            onClick={() => save((s) => paletteSet(s, id, p.palette))}
          >
            <span className="swatches" aria-hidden="true">
              {(['body', 'belly', 'earInner', 'accent'] as const).map((k) => (
                <i key={k} style={{ background: p.palette[k] }} />
              ))}
            </span>
            {p.name}
          </button>
        ))}
        <button type="button" className="btn" onClick={() => save((s) => paletteReset(s, id))}>
          Reset {NAMES[id]}
        </button>
      </div>

      <h3>Palette</h3>
      <div className="palette-grid">
        {PALETTE_KEYS.map((k) => (
          <ColorField
            key={`${id}-${k}`}
            label={PALETTE_LABELS[k]}
            value={pal[k]}
            onCommit={(hex) => save((s) => paletteEdit(s, id, k, hex))}
          />
        ))}
      </div>
    </Section>
  );
});
