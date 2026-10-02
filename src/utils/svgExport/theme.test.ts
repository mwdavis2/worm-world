import { describe, expect, test } from 'vitest';
import { LETHAL_CARD_MIX, blendRgb } from './theme';

describe('blendRgb', () => {
  test('blends channel-wise and rounds', () => {
    expect(blendRgb('rgb(0, 0, 0)', 'rgb(100, 200, 50)', 0.5)).toBe(
      'rgb(50, 100, 25)'
    );
    expect(blendRgb('rgb(29, 35, 42)', 'rgb(166, 173, 186)', 0)).toBe(
      'rgb(29, 35, 42)'
    );
  });

  test('a lethal card is lighter than a dark card and darker than a light one', () => {
    const red = (color: string): number =>
      Number(/rgb\((\d+)/.exec(color)?.[1]);
    // dark theme: near-black card, light text
    expect(
      red(blendRgb('rgb(29, 35, 42)', 'rgb(166, 173, 186)', LETHAL_CARD_MIX))
    ).toBeGreaterThan(29);
    // light theme: white card, dark text
    expect(
      red(blendRgb('rgb(255, 255, 255)', 'rgb(31, 41, 55)', LETHAL_CARD_MIX))
    ).toBeLessThan(255);
  });
});
