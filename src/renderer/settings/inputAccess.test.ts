import { describe, expect, it } from 'vitest';
import { bannerVisible } from './InputAccessBanner';

describe('input access banner', () => {
  it('shows only when the OS says access is denied', () => {
    expect(bannerVisible('denied')).toBe(true);
    expect(bannerVisible('granted')).toBe(false);
    expect(bannerVisible('not-needed')).toBe(false);
    expect(bannerVisible(null)).toBe(false);
  });
});
