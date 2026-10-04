import { screen } from 'electron';
import { isPeeking, onStateChange, setPeek } from '../hooks';
import { getSettings, onSettingsChanged } from '../store';
import { getOverlayWindow, setPeekBounds } from '../windows/overlay';
import { activeWindowOrUndefined, FullscreenDetector } from './detector';
import { peekRect, type PeekEdge, type Rect } from './geometry';

let home: Rect | null = null; // overlay bounds before peeking
let applied = false;
let appliedEdge: PeekEdge | null = null;
let autoPeeked = false;
let detector: FullscreenDetector | null = null;
let offs: Array<() => void> = [];

function apply(): void {
  const w = getOverlayWindow();
  if (!w) return;
  const want = isPeeking();
  const edge = getSettings().peek.edge;
  if (want && (!applied || appliedEdge !== edge)) {
    home ??= w.getBounds();
    const display = screen.getDisplayMatching(home).bounds;
    setPeekBounds(peekRect(home, display, edge));
    applied = true;
    appliedEdge = edge;
  } else if (!want && applied) {
    if (home) setPeekBounds(null, home);
    home = null;
    applied = false;
    appliedEdge = null;
  }
}

/** Overlay display bounds, converted to the coordinate space get-windows reports. */
function displayBoundsForDetector(): Rect | null {
  const w = getOverlayWindow();
  if (!w) return null;
  const b = home ?? w.getBounds();
  const d = screen.getDisplayMatching(b).bounds;
  // get-windows reports physical pixels on Windows, DIPs elsewhere.
  return process.platform === 'win32' ? screen.dipToScreenRect(null, d) : d;
}

function syncDetector(): void {
  const auto = getSettings().peek.auto;
  if (auto && !detector) {
    detector = new FullscreenDetector({
      getActive: activeWindowOrUndefined,
      getDisplayBounds: displayBoundsForDetector,
      onChange: (fs) => {
        if (fs) {
          if (!isPeeking()) {
            autoPeeked = true;
            setPeek(true);
          }
        } else if (autoPeeked) {
          autoPeeked = false;
          setPeek(false);
        }
      },
    });
    detector.start();
  } else if (!auto && detector) {
    detector.stop();
    detector = null;
    autoPeeked = false;
  }
}

/** Slide the overlay on manual/auto peek (via hooks.setPeek) and run the auto detector. */
export function startPeek(): void {
  offs.push(
    onStateChange(() => {
      if (!isPeeking()) autoPeeked = false;
      apply();
    }),
  );
  offs.push(
    onSettingsChanged((next, prev) => {
      if (next.peek.auto !== prev.peek.auto) syncDetector();
      if (next.peek.edge !== prev.peek.edge && isPeeking()) apply();
    }),
  );
  syncDetector();
}

export function stopPeek(): void {
  detector?.stop();
  detector = null;
  offs.forEach((f) => f());
  offs = [];
}
