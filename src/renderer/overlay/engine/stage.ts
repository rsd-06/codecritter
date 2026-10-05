// Pixel stage: 128x112 logical canvas, integer-scaled presentation, layered compositing, hit-test.
import { BubbleView } from './bubble';
import { ParticleSystem } from './particles';
import { peekPlacement } from './peek';
import {
  BOX,
  BOX_X,
  BOX_Y,
  STAGE_H,
  STAGE_W,
  defaultPoseState,
  type Character,
  type PoseState,
} from './types';
import { NOTE_W, drawNote, drawPomodoro, type PomodoroView } from './widgets';

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export class Stage {
  readonly pose: PoseState = defaultPoseState();
  readonly particles = new ParticleSystem();
  readonly bubble = new BubbleView();
  note = '';
  pomodoro: PomodoroView | null = null;
  scale = 2;

  private readonly view: CanvasRenderingContext2D;
  private readonly buf: CanvasRenderingContext2D;
  private readonly bufCanvas: HTMLCanvasElement;
  private readonly layer: CanvasRenderingContext2D;
  private readonly layerCanvas: HTMLCanvasElement;
  private dpr = 1;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private character: Character,
    scale = 2,
  ) {
    this.view = canvas.getContext('2d')!;
    this.bufCanvas = makeCanvas(STAGE_W, STAGE_H);
    this.buf = this.bufCanvas.getContext('2d')!;
    this.layerCanvas = makeCanvas(STAGE_W, STAGE_H);
    this.layer = this.layerCanvas.getContext('2d', { willReadFrequently: true })!;
    this.buf.imageSmoothingEnabled = false;
    this.layer.imageSmoothingEnabled = false;
    this.setScale(scale);
  }

  get char(): Character {
    return this.character;
  }

  setCharacter(c: Character): void {
    this.character = c;
  }

  /** Integer scale of the 128x112 logical stage; backing store follows devicePixelRatio. */
  setScale(scale: number): void {
    this.scale = Math.max(1, Math.round(scale));
    this.dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const cssW = STAGE_W * this.scale;
    const cssH = STAGE_H * this.scale;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.view.imageSmoothingEnabled = false;
  }

  private placement() {
    const m = this.character.metrics;
    return peekPlacement(this.pose.peekEdge, this.pose.peek, { top: m.top, depth: m.peekDepth });
  }

  /** Box (64x64 character-local) point -> stage point, honouring the peek placement/rotation. */
  boxToStage(x: number, y: number): { x: number; y: number } {
    if (this.pose.peek > 0) {
      const pl = this.placement();
      if (pl.rot === 0) return { x: BOX_X + x, y: BOX_Y + pl.y + y };
      const c = Math.cos(pl.rot);
      const s = Math.sin(pl.rot);
      const lx = x - BOX / 2;
      const ly = y - BOX / 2;
      return { x: pl.x + lx * c - ly * s, y: pl.y + lx * s + ly * c };
    }
    return { x: BOX_X + x, y: BOX_Y + y };
  }

  /** Where speech bubbles point (stage coords): just above the character's head top. */
  get bubbleAnchor(): { x: number; y: number } {
    const p = this.pose;
    if (p.peek > 0) {
      const pl = this.placement();
      return { x: pl.headX, y: pl.headY };
    }
    const a = this.character.anchors(p);
    const top = BOX_Y + a.headTop + p.offsetY;
    return { x: Math.round(BOX_X + a.head.x + p.offsetX), y: Math.max(26, Math.round(top) - 1) };
  }

  /** Head centre in stage coords (particles spawn relative to this). */
  get head(): { x: number; y: number } {
    const a = this.character.anchors(this.pose);
    if (this.pose.peek > 0) return this.boxToStage(a.head.x, a.head.y);
    return { x: BOX_X + a.head.x + this.pose.offsetX, y: BOX_Y + a.head.y + this.pose.offsetY };
  }

  /** Eye centres in stage coords + eye radius + layer rotation (for cursor tracking). */
  get eyes(): { l: { x: number; y: number }; r: { x: number; y: number }; radius: number; rot: number } {
    const a = this.character.anchors(this.pose);
    const peek = this.pose.peek > 0;
    const off = (q: { x: number; y: number }) =>
      peek
        ? this.boxToStage(q.x, q.y)
        : { x: BOX_X + q.x + this.pose.offsetX, y: BOX_Y + q.y + this.pose.offsetY };
    return { l: off(a.eyes[0]), r: off(a.eyes[1]), radius: a.eyeR, rot: peek ? this.placement().rot : 0 };
  }

  render(t: number): void {
    const b = this.buf;
    b.clearRect(0, 0, STAGE_W, STAGE_H);

    // ground shadow (shrinks while airborne)
    const air = Math.max(0, -this.pose.offsetY);
    const peeking = this.pose.peek > 0.05; // at the screen edge: no ground shadow
    const sw = Math.max(6, Math.round(this.character.metrics.shadowW * this.pose.scale - air * 0.4));
    if (!peeking) {
      b.fillStyle = 'rgba(0,0,0,0.22)';
      b.fillRect(BOX_X + 32 - sw + this.pose.offsetX * 0.3, STAGE_H - 3, sw * 2, 2);
      b.fillRect(BOX_X + 32 - sw + 3 + this.pose.offsetX * 0.3, STAGE_H - 4, sw * 2 - 6, 1);
    }

    // character layer (also used for hit-testing)
    const l = this.layer;
    l.clearRect(0, 0, STAGE_W, STAGE_H);
    l.save();
    if (this.pose.peek > 0) {
      const pl = this.placement();
      if (pl.rot === 0) l.translate(BOX_X, BOX_Y + pl.y);
      else {
        l.translate(pl.x, pl.y);
        l.rotate(pl.rot);
        l.translate(-BOX / 2, -BOX / 2);
      }
    } else l.translate(BOX_X, BOX_Y);
    this.character.draw(l, this.pose, t);
    l.restore();
    b.drawImage(this.layerCanvas, 0, 0);

    this.particles.draw(b);
    if (this.note) drawNote(b, this.note, STAGE_W - NOTE_W - 3, 4, this.bubble.active ? 0.35 : 1);
    if (this.pomodoro) {
      // beside the face, following the head top (fixed spot while peeking)
      const py =
        this.pose.peek > 0
          ? STAGE_H - 52
          : Math.min(STAGE_H - 18, Math.max(18, Math.round(BOX_Y + this.character.anchors(this.pose).headTop) + 8));
      drawPomodoro(b, this.pomodoro, STAGE_W - 31, py);
    }
    const a = this.bubbleAnchor;
    const band = this.pose.peek > 0 ? this.placement() : null;
    this.bubble.draw(b, a.x, a.y, band ? band.maxX + 1 : STAGE_W, band ? band.minX : 1);

    this.view.imageSmoothingEnabled = false;
    this.view.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.view.drawImage(this.bufCanvas, 0, 0, this.canvas.width, this.canvas.height);
  }

  /** Is this client-space point over an opaque character pixel? */
  hitTest(clientX: number, clientY: number): boolean {
    const r = this.canvas.getBoundingClientRect();
    if (r.width === 0) return false;
    const x = Math.floor(((clientX - r.left) / r.width) * STAGE_W);
    const y = Math.floor(((clientY - r.top) / r.height) * STAGE_H);
    if (x < 0 || y < 0 || x >= STAGE_W || y >= STAGE_H) return false;
    return this.layer.getImageData(x, y, 1, 1).data[3]! > 24;
  }
}
