import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './defaults';

describe('defaults.json (embedded by the Rust shell)', () => {
  it('matches DEFAULT_SETTINGS; run `npm run gen:defaults` if this fails', () => {
    const json = JSON.parse(readFileSync(resolve(__dirname, 'defaults.json'), 'utf8')) as unknown;
    expect(json).toEqual(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
  });
});
