// Pixel stage: 128x112 logical canvas, integer-scaled presentation, layered compositing, hit-test.
import { BubbleView } from './bubble';
import { ParticleSystem } from './particles';
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

  /** Where speech bubbles point (stage coords), follows hops and growth. */
  get bubbleAnchor(): { x: number; y: number } {
    const p = this.pose;
    const top = BOX_Y + 62 - 58 * p.scale * p.squashY + p.offsetY;
    return { x: BOX_X + BOX / 2 + p.offsetX, y: Math.max(26, Math.round(top) - 1) };
  }

  /** Head centre in stage coords (particles spawn relative to this). */
  get head(): { x: number; y: number } {
    return { x: BOX_X + BOX / 2 + this.pose.offsetX, y: BOX_Y + 28 + this.pose.offsetY };
  }

  render(t: number): void {
    const b = this.buf;
    b.clearRect(0, 0, STAGE_W, STAGE_H);

    // ground shadow (shrinks while airborne)
    const air = Math.max(0, -this.pose.offsetY);
    const sw = Math.max(8, Math.round(18 * this.pose.scale - air * 0.4));
    b.fillStyle = 'rgba(0,0,0,0.22)';
    b.fillRect(BOX_X + 32 - sw + this.pose.offsetX * 0.3, STAGE_H - 3, sw * 2, 2);
    b.fillRect(BOX_X + 32 - sw + 3 + this.pose.offsetX * 0.3, STAGE_H - 4, sw * 2 - 6, 1);

    // character layer (also used for hit-testing)
    const l = this.layer;
    l.clearRect(0, 0, STAGE_W, STAGE_H);
    l.save();
    l.translate(BOX_X, BOX_Y);
    this.character.draw(l, this.pose, t);
    l.restore();
    b.drawImage(this.layerCanvas, 0, 0);

    this.particles.draw(b);
    if (this.note) drawNote(b, this.note, STAGE_W - NOTE_W - 3, 4, this.bubble.active ? 0.35 : 1);
    if (this.pomodoro) drawPomodoro(b, this.pomodoro, STAGE_W - 31, STAGE_H - 52);
    const a = this.bubbleAnchor;
    this.bubble.draw(b, a.x, a.y, STAGE_W);

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
