// The sex filter: a cross's male children are there but hidden by default.
import { describe, expect, test } from 'vitest';
import { type Node } from 'reactflow';
import { Allele } from 'models/frontend/Allele/Allele';
import { Strain } from 'models/frontend/Strain/Strain';
import { Variation } from 'models/frontend/Variation/Variation';
import {
  HERMAPHRODITE,
  MALE,
  StrainFilter,
} from 'models/frontend/StrainFilter/StrainFilter';

const x1 = new Allele({
  name: 'x1',
  variation: new Variation({ name: 'x1', chromosome: 'X', geneticLoc: 1 }),
});
const herm = new Strain({ allelePairs: [x1.toTopHet()] });
const male = herm.toggleSex();
const node = (strain: Strain, id: string): Node<Strain> => ({
  id,
  data: strain,
  position: { x: 0, y: 0 },
});

describe('the sex filter', () => {
  test('a new cross shows hermaphrodites only', () => {
    const filter = new StrainFilter();
    expect(filter.sex).toEqual(new Set([HERMAPHRODITE]));
    expect(herm.passesFilter(filter)).toBe(true);
    expect(male.passesFilter(filter)).toBe(false);
  });

  test('both sexes checked, or none, shows everything', () => {
    for (const sex of [new Set([HERMAPHRODITE, MALE]), new Set<string>()]) {
      const filter = new StrainFilter({ sex });
      expect(herm.passesFilter(filter)).toBe(true);
      expect(male.passesFilter(filter)).toBe(true);
    }
  });

  test('males only', () => {
    const filter = new StrainFilter({ sex: new Set([MALE]) });
    expect(herm.passesFilter(filter)).toBe(false);
    expect(male.passesFilter(filter)).toBe(true);
  });

  test('updates like the other set filters and round-trips through JSON', () => {
    const filter = new StrainFilter();
    filter.update({ field: 'sex', action: 'add', name: MALE, filterId: 'f' });
    expect(filter.sex).toEqual(new Set([HERMAPHRODITE, MALE]));
    const back = StrainFilter.fromJSON(filter.toJSON());
    expect(back.sex).toEqual(new Set([HERMAPHRODITE, MALE]));
    expect(filter.clone().sex).toEqual(filter.sex);
  });

  test('a filter saved before the sex filter existed loads with no narrowing', () => {
    const old = JSON.stringify({ alleleNames: [], viability: [] });
    expect(StrainFilter.fromJSON(old).sex.size).toBe(0);
  });

  test('is offered only when the children include both sexes', () => {
    const both = StrainFilter.getFilterOptions([
      node(herm, 'a'),
      node(male, 'b'),
    ]);
    expect(both.sex).toEqual(new Set([HERMAPHRODITE, MALE]));
    const hermsOnly = StrainFilter.getFilterOptions([
      node(herm, 'a'),
      node(herm, 'c'),
    ]);
    expect(hermsOnly.sex.size).toBe(0);
  });

  test('isEmpty ignores the default but counts males', () => {
    expect(new StrainFilter().isEmpty()).toBe(true);
    expect(
      new StrainFilter({ sex: new Set([HERMAPHRODITE, MALE]) }).isEmpty()
    ).toBe(false);
  });

  test('describe() mentions the default only when a male child is hidden by it', () => {
    const filter = new StrainFilter();
    expect(filter.describe(false, false)).toEqual(
      ['Viability: Non-lethal'].slice(1)
    );
    expect(filter.describe(false, true)).toEqual([`Sex: ${HERMAPHRODITE}`]);
    const both = new StrainFilter({ sex: new Set([HERMAPHRODITE, MALE]) });
    expect(both.describe(false, false)).toEqual([
      `Sex: ${HERMAPHRODITE}, ${MALE}`,
    ]);
  });
});
