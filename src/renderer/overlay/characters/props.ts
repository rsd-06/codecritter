// Hand-held props shared by the built-in characters (fixed colours, so they read on any palette).
import { GridBuilder, makePart, type Part } from '../engine/rig';

export function buildCup(x = 29, y = 49): Part {
  const b = new GridBuilder();
  b.stamp(['CCCCCC', 'CWcccC', 'CWcccC', 'CccccC', 'CccccC', '.CCCC.'], x, y);
  return makePart(b.rows());
}
export function buildLaptop(): Part {
  const b = new GridBuilder();
  b.rect(26, 52, 12, 7, 'G').rect(24, 59, 16, 2, 'g');
  b.rect(31, 55, 2, 2, 'W').underShade('G', 'g');
  return makePart(b.rows());
}
export function buildNote(y = 48): Part {
  const b = new GridBuilder();
  b.rect(28, y, 8, 8, 'Y').rect(29, y + 2, 6, 1, 'y').rect(29, y + 4, 5, 1, 'y').rect(29, y + 6, 6, 1, 'y');
  return makePart(b.rows());
}
export function buildRoll(y = 51): Part {
  const b = new GridBuilder();
  b.rect(25, y, 14, 4, 'P').rect(25, y + 3, 14, 1, 'Q');
  b.both(() => {
    b.ellipse(25, y + 2, 2.3, 2.3, 'P').ellipse(25, y + 2, 1.1, 1.1, 'Q');
  });
  return makePart(b.rows());
}

