import { describe, expect, test } from 'vitest';
import { fromDateInputValue, toDateInputValue } from 'utils/dateInput';

describe('toDateInputValue', () => {
  test.each([
    [new Date(2026, 0, 5), '2026-01-05'],
    [new Date(2026, 8, 15), '2026-09-15'],
    // October was written as 2026-010-10
    [new Date(2026, 9, 10), '2026-10-10'],
    [new Date(2026, 9, 1), '2026-10-01'],
    [new Date(2026, 10, 10), '2026-11-10'],
    [new Date(2026, 11, 25), '2026-12-25'],
  ])('%s -> %s', (date, text) => {
    expect(toDateInputValue(date)).toBe(text);
  });

  test('every day of a year round-trips, and is a well-formed date', () => {
    for (let day = 0; day < 366; day++) {
      const date = new Date(2028, 0, 1 + day); // a leap year
      const text = toDateInputValue(date);
      expect(text).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(fromDateInputValue(text)?.getTime()).toBe(date.getTime());
    }
  });
});

describe('fromDateInputValue', () => {
  test('reads a date as local midnight', () => {
    const date = fromDateInputValue('2026-10-05');
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(9);
    expect(date?.getDate()).toBe(5);
    expect(date?.getHours()).toBe(0);
  });

  test.each([
    [''],
    ['2026-010-10'],
    ['2026-13-01'],
    ['2026-02-30'],
    ['2026-1-5'],
    ['not a date'],
  ])('%s is not a date', (text) => {
    expect(fromDateInputValue(text)).toBeUndefined();
  });

  test('accepts 29 February in a leap year only', () => {
    expect(fromDateInputValue('2028-02-29')).toBeDefined();
    expect(fromDateInputValue('2027-02-29')).toBeUndefined();
  });
});
