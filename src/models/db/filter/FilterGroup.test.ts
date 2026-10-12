import { describe, expect, test } from 'vitest';
import { type Filter } from 'models/db/filter/Filter';
import { isBlankFilter } from 'models/db/filter/FilterGroup';

describe('isBlankFilter', () => {
  test.each<[Filter, boolean]>([
    [{ Equal: '' }, true],
    [{ NotEqual: '' }, true],
    [{ Like: '' }, true],
    [{ StartsWith: '' }, true],
    [{ LessThan: ['', false] }, true],
    [{ GreaterThan: ['', false] }, true],
    [{ Range: ['', false, '', false] }, true],
    [{ Equal: 'a' }, false],
    [{ Like: 'ox' }, false],
    [{ LessThan: ['3', false] }, false],
    [{ Range: ['1', false, '', false] }, false],
    [{ Range: ['', false, '5', false] }, false],
    ['Null', false],
    ['NotNull', false],
    ['True', false],
    ['False', false],
  ])('%j -> %s', (filter, blank) => {
    expect(isBlankFilter(filter)).toBe(blank);
  });
});
