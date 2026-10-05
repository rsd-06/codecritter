# Authoring a character

A CodeCritter character is **data**: a handful of small pixel-grid parts, a palette and some geometry numbers. There is no art pipeline and no sprite sheet; the engine composes the parts live, so every pose, expression, blink and palette swap works for free. The reference implementations are `src/renderer/overlay/characters/stitch.ts` and `yoda.ts`; shared machinery is in `kit.ts`.

> Only create characters you have the rights to, or originals. Stitch and Yoda are unofficial fan art (see the README disclaimer).

## Concepts

- **Logical canvas**: every sprite lives in a 64x64 box. The character sits bottom-centre of the 128x112 stage; the feet anchor is at (32, 62). The overlay upscales by an integer factor with smoothing off. The built-in characters use ~46 px of the box height (head top around y=16); leave headroom so hops and the 1.4x stretch stay inside the stage.
- **Grid**: a part is an array of strings, one char per pixel, `.` (or space) is transparent. Parts are trimmed and compiled once per palette (cached), so authoring cost is paid once.
- **Parts** (`RigDef` in `kit.ts`): `head`, optional `hair`, `body`, optional `feet`, `ears` (one L/R pair for each ear pose), `mouths` (one part per mouth name), `arms` (generated from shoulder/hand points per paw pose), `props` (cup, laptop, note, roll, optional cane), plus `eye` geometry, per-pose offsets, face anchor points (`face`: blush, sweat, vein, tear, steam), `headCy` (head centre y: particles, petting), `sheet` (where the paper hangs from the roll) and `shadowW`. The engine derives `metrics` (head top incl. ears/hair, peek depth) from the parts, and `anchors(pose)` gives the head top, head centre and eye centres for any pose: bubbles, the pomodoro widget, peek placement and cursor tracking all use them, so a character of any size works without engine changes.
- Eyes, brows and the face extras (blush, sweat, tears, anger vein, steam) are **drawn procedurally** from the `eye`/`face` geometry, so pupils can follow the cursor and expressions can blend.

## Colour keys

Characters never contain hex colours for body parts; they use keys, which map to the editable `Palette`:

| Key | Palette field | Typical use |
| --- | --- | --- |
| `o` | `outline` | outline |
| `b` | `body` | main body colour |
| `s` | `bodyShade` | shadow side |
| `w` | `belly` | belly / chest |
| `p` | `earInner` | inner ear |
| `e` | `eye` | eye / iris fill |
| `k` | `pupil` | eye glint |
| `a` | `accent` | clothing or accent (Yoda's robe) |
| `u d l q A z` | derived | body light, body deep, belly shade, ear shade, accent light, accent dark |
| `h i n` | derived | iris (eye pulled towards green-brown), pink inner ear (earInner pulled towards pink), nose/deep interior (outline mixed with body shade) |

Fixed colours that ignore the palette (so props look right on any colour scheme): `W` white, `V` off-white, `R/r` red, `T` pink, `N` near-black, `C` glass, `c` water, `B/D` wood, `Y/y` sticky-note yellow, `P/Q` paper, `F/f` cream cloth, `G/g` greys, `H` hair white, `L` laptop glow. The full list is `FIXED_COLORS` in `engine/rig.ts`.

Palette fields are defined in `src/shared/types.ts` (`Palette`) and defaults per character live in `src/shared/defaults.ts` (`DEFAULT_PALETTES`).

## Building parts

You can write grids by hand, or use `GridBuilder` (`engine/rig.ts`) which is what both built-in characters do:

```ts
const b = new GridBuilder();            // 64x64, '.' everywhere
b.ellipse(32, 29, 17.5, 14, 'b')        // filled shapes in colour keys
 .poly([[30, 24], [32, 15.5], [34, 24]], 'w', { over: 'b' }) // only paints over 'b'
 .both(() => b.rotEllipse(24.6, 29, 6.4, 8.2, 14, 'd'))      // draw on the left AND mirrored right
 .underShade('b', 's');                 // auto shading pass
return makePart(b.rows());              // trim + offset bookkeeping
```

Helpers: `set`, `rect`, `ellipse`, `rotEllipse`, `poly`, `capsule`, `stamp`, `erase`, `underShade`, `topLight`, `mirrored`. `parseGrid`/`compileRows` validate keys, so a typo throws in tests instead of silently drawing nothing. See `engine/rig.test.ts` for the contract.

## Poses, paws, props, ears, mouths

The engine asks your rig for these named variants:

- **Poses**: `sit`, `crouch`, `pounce`, `sleep`, `stretch`, `alert`. Each has `PoseParams` (`bodyDy`, `headDy`, `headDx`, squash `sx/sy`, `feetSpread`). Start from `defaultPoses()` and tweak.
- **Paws**: `down`, `knead-L`, `knead-R`, `up`, `hold-cup`, `hold-paper`, `chin`, `wave`. Describe each as `[shoulder, hand]` points per side in `ArmSpec.poses`; arms are rasterised for you.
- **Ears**: `neutral`, `perk`, `droop`, `back`, `flare` (build one L/R pair for each).
- **Mouths**: `neutral`, `happy`, `open`, `o`, `flat`, `smirk`, `cat-smile`, `grin`, `wobbly`, `tongue`, `yawn`.
- **Props**: `cup`, `laptop`, `note`, `roll` (paper roll), and optionally `cane`. Set `autoProp: 'cane'` to show it whenever the paws are down.

## Expressions and per-character overrides

An expression is `eyes x brows x mouth x ears x extras`. 18 shared presets (`EXPRESSIONS` in `engine/expression.ts`): neutral, happy, focused, excited, curious, surprised, love, annoyed, dizzy, stressed, sleepy, bored, thinking, proud, worried, determined, relaxed, sneaky. The behaviour layer maps user activity to these names (PLAN section 3a).

To give your character its own flavour, add an entry to `STYLE_OVERRIDES` keyed by character id; only the fields you list replace the shared preset:

```ts
mychar: {
  happy: { mouth: 'grin', ears: 'perk' },
  annoyed: { ears: 'back', mouth: 'flat' },
}
```

Brow and eye knobs live in `EyeSpec` (`style: 'solid' | 'sclera'`, eye centres and half sizes, `baseLid`, `browDy`, `browW`, optional `browKey` so brows stay readable on dark eye patches, `tilt` for solid oval eyes, `irisR` for sclera eyes, `travel` = max pupil offset in px). Pupils get a per-eye look (`lookX +/- conv`) from `behavior/look.ts`, and sclera irises are clipped to the eye white so they can never leave it.

## Registering the character

1. Add the id to `CharacterId` in `src/shared/types.ts` and a default palette to `DEFAULT_PALETTES` in `src/shared/defaults.ts` (a settings migration is not needed for new keys that have defaults, but check `src/shared/defaults.test.ts`).
2. Export `createMyCharRig()` and `createMyChar = (p) => createRigCharacter(createMyCharRig(), p)`; add it to `createCharacter` in `characters/index.ts`.
3. Add its voice in `engine/sound.ts`, its personalised lines in `behavior/strings.ts`, and a tray entry in `src/main/tray.ts`.
4. Add it to the character picker (`src/renderer/settings/Character.tsx`) and to the `characters` lists in `tools/sprite-export.ts` and `tools/make_icons.py`.

## Gallery workflow

1. `npm run playground`, then open http://localhost:5174/playground/gallery.html. Query parameters: `?mode=expressions|poses|paws|props&pose=&paws=&scale=2&only=mychar`. Iterate on the grids with hot reload and check all 18 expressions, every pose and the props.
2. Use `index.html` in the playground (fake desktop + buttons for every event) to see it behave: knead, overheat, hop, sleep, peek.
3. Run `npm run sprites:export` to render the same frames headlessly into `tools/out/`, then `python tools/make_icons.py` to regenerate icons, tray images and the README galleries/GIFs. Commit the regenerated `build/`, `resources/tray/` and `docs/media/`.
4. `npm test` - rig/expression tests catch invalid colour keys and missing variants.

Tips: keep heads readable at 16x16 (tray icon is a head crop); keep a 1px outline in `o`; avoid single-pixel details in the body that vanish when squashed; add a `stamp`ed highlight rather than a new colour key.
