import { describe, expect, test } from 'vitest';
import { minContentWidth, wrapLabel } from './wrapLabel';

// One unit of width per character, so widths are easy to reason about.
const measure = (s: string): number => s.length;

describe('wrapLabel', () => {
  test('keeps text that fits on one line', () => {
    expect(wrapLabel('oxEx2254 [GFP]', 40, measure)).toEqual([
      'oxEx2254 [GFP]',
    ]);
  });

  test('breaks at spaces and fills lines greedily', () => {
    expect(wrapLabel('aaa bbb ccc ddd', 7, measure)).toEqual([
      'aaa bbb',
      'ccc ddd',
    ]);
  });

  test('breaks after a hyphen, like the browser does on the card', () => {
    expect(wrapLabel('Punc-122::GAP-43::mScarlet', 10, measure)).toEqual([
      'Punc-',
      '122::GAP-',
      '43::mScarlet',
    ]);
  });

  test('never splits a piece that has no break opportunity, even if too wide', () => {
    expect(wrapLabel('averyveryverylongword x', 5, measure)).toEqual([
      'averyveryverylongword',
      'x',
    ]);
  });

  test('a hyphen that ends a word (nothing after it) is not a break point', () => {
    expect(wrapLabel('a- b', 3, measure)).toEqual(['a-', 'b']);
  });

  test('returns the text itself when there is nothing to wrap', () => {
    expect(wrapLabel('', 10, measure)).toEqual(['']);
  });
});

describe('minContentWidth', () => {
  test('is the width of the widest unbreakable piece', () => {
    expect(minContentWidth('Punc-122::GAP-43::mScarlet x', measure)).toBe(
      '43::mScarlet'.length
    );
  });
});
