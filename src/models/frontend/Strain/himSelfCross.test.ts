// A Him hermaphrodite makes males when it selfs: a chosen share of its
// children come from a sperm with no X (one X, from the egg: a male). Without
// Him, selfing never makes a male.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { Allele } from 'models/frontend/Allele/Allele';
import { Strain } from 'models/frontend/Strain/Strain';
import { Variation } from 'models/frontend/Variation/Variation';
import { Sex } from 'models/enums';
import { type ChromosomeName } from 'models/db/filter/db_ChromosomeName';

const allele = (
  name: string,
  chromosome: ChromosomeName,
  geneticLoc: number
): Allele =>
  new Allele({
    name,
    variation: new Variation({ name, chromosome, geneticLoc }),
  });

const x1 = allele('x1', 'X', 0);
const a1 = allele('a1', 'III', 0);

const maleShare = (kids: Strain[]): number =>
  kids
    .filter((kid) => kid.sex === Sex.Male)
    .reduce((sum, kid) => sum + (kid.probability ?? 0), 0);
const total = (kids: Strain[]): number =>
  kids.reduce((sum, kid) => sum + (kid.probability ?? 0), 0);

beforeEach(() => {
  mockIPC((cmd) => {
    if (cmd === 'get_filtered_strain_alleles') return [];
  });
});
afterEach(() => {
  clearMocks();
});

describe('selfing a Him hermaphrodite', () => {
  test('without Him a self cross never makes a male', async () => {
    const herm = new Strain({ allelePairs: [x1.toTopHet(), a1.toTopHet()] });
    const kids = await herm.selfCross(undefined, 0.33);
    expect(maleShare(kids)).toBe(0);
  });

  test('a Him self cross gives the chosen share of males, the rest as usual', async () => {
    const herm = new Strain({ allelePairs: [x1.toTopHet(), a1.toTopHet()] });
    herm.him = true;
    const kids = await herm.selfCross(undefined, 0.33);
    expect(maleShare(kids)).toBeCloseTo(0.33, 9);
    expect(total(kids)).toBeCloseTo(1, 9);
    // males carry one X, from the egg: x1 or the wild one, half each
    const males = kids.filter((kid) => kid.sex === Sex.Male);
    males.forEach((male) => {
      expect(
        male.getAllelePairs().filter((p) => p.getChromName() === 'X')
      ).toSatisfy((pairs: Array<{ isHemizygous: () => boolean }>) =>
        pairs.every((p) => p.isHemizygous())
      );
    });
    const x1Males = males
      .filter((male) => male.getAlleles().some((a) => a.name === 'x1'))
      .reduce((sum, male) => sum + (male.probability ?? 0), 0);
    expect(x1Males).toBeCloseTo(0.33 / 2, 9);
  });

  test('the share follows the setting, and none means no males', async () => {
    const herm = new Strain({ allelePairs: [x1.toTopHet()] });
    herm.him = true;
    expect(maleShare(await herm.selfCross(undefined, 0.5))).toBeCloseTo(0.5, 9);
    expect(maleShare(await herm.selfCross(undefined, 0))).toBe(0);
    expect(maleShare(await herm.selfCross(undefined))).toBe(0);
  });

  test('a Him strain with no X chromosome pair still makes males, told apart by sex', async () => {
    const herm = new Strain({ allelePairs: [a1.toTopHet()] });
    herm.him = true;
    const kids = await herm.selfCross(undefined, 0.25);
    expect(maleShare(kids)).toBeCloseTo(0.25, 9);
    expect(total(kids)).toBeCloseTo(1, 9);
  });

  test('a mated cross with a Him parent makes no extra males', async () => {
    const herm = new Strain({ allelePairs: [x1.toTopHet()] });
    herm.him = true;
    const male = new Strain({ allelePairs: [a1.toTopHet()] }).toggleSex();
    const kids = await herm.crossWith(male);
    // only the usual male children of a mated cross (half), no Him share
    expect(maleShare(kids)).toBeCloseTo(0.5, 9);
  });
});
