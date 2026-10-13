// A cross between strains with no X-linked allele still has sexes: there is an
// implicit wild X. A hermaphrodite's gametes all carry it, a male's are half X and
// half X-less, and an X-less gamete with an X one makes a male.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { Allele } from 'models/frontend/Allele/Allele';
import { Strain } from 'models/frontend/Strain/Strain';
import { Variation } from 'models/frontend/Variation/Variation';
import { Sex } from 'models/enums';
import { type ChromosomeName } from 'models/db/filter/db_ChromosomeName';

const allele = (name: string, chromosome: ChromosomeName): Allele =>
  new Allele({
    name,
    variation: new Variation({ name, chromosome, geneticLoc: 0 }),
  });
const a1 = allele('a1', 'III');
const a2 = allele('a2', 'IV');

const share = (kids: Strain[], sex: Sex): number =>
  kids
    .filter((kid) => kid.sex === sex)
    .reduce((sum, kid) => sum + (kid.probability ?? 0), 0);
const total = (kids: Strain[]): number =>
  kids.reduce((sum, kid) => sum + (kid.probability ?? 0), 0);

beforeEach(() => {
  mockIPC(() => []);
});
afterEach(() => {
  clearMocks();
});

const herm = (him = false): Strain => {
  const strain = new Strain({ allelePairs: [a1.toHomo()] });
  strain.him = him;
  return strain;
};
const male = (): Strain =>
  new Strain({ sex: Sex.Male, allelePairs: [a2.toHomo()] });

describe('crosses with no X-linked allele', () => {
  test('hermaphrodite x male: half hermaphrodites, half males, genotypes intact', async () => {
    const kids = await herm().crossWith(male());
    expect(total(kids)).toBeCloseTo(1, 9);
    expect(share(kids, Sex.Hermaphrodite)).toBeCloseTo(0.5, 9);
    expect(share(kids, Sex.Male)).toBeCloseTo(0.5, 9);
    // every child is a1/+ ; a2/+
    kids.forEach((kid) => {
      expect(kid.getAlleles().filter((a) => a.name === 'a1')).toHaveLength(1);
      expect(kid.getAlleles().filter((a) => a.name === 'a2')).toHaveLength(1);
    });
  });

  test('the same whichever parent crossWith is called on', async () => {
    const kids = await male().crossWith(herm());
    expect(share(kids, Sex.Male)).toBeCloseTo(0.5, 9);
  });

  test('a self cross makes only hermaphrodites', async () => {
    const kids = await herm().selfCross();
    expect(share(kids, Sex.Male)).toBe(0);
    expect(total(kids)).toBeCloseTo(1, 9);
  });

  test('a Him mother to a male: the usual extra males, as when an X allele shows them', async () => {
    const n = 0.37;
    const kids = await herm(true).crossWith(male(), { himNulloFraction: n });
    // normal eggs: half hermaphrodite, half male; X-less eggs: male with an X
    // sperm, nothing with an X-less one; rescaled
    const kept = 1 - n + n * 0.5;
    expect(total(kids)).toBeCloseTo(1, 9);
    expect(share(kids, Sex.Hermaphrodite)).toBeCloseTo(
      ((1 - n) * 0.5) / kept,
      9
    );
    expect(share(kids, Sex.Male)).toBeCloseTo(
      ((1 - n) * 0.5 + n * 0.5) / kept,
      9
    );
  });

  test('a Him self cross still gives the setting as the male share', async () => {
    const kids = await herm(true).selfCross(undefined, 0.37);
    expect(share(kids, Sex.Male)).toBeCloseTo(0.37, 9);
  });
});
