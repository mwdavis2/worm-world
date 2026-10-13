// A Him hermaphrodite's eggs may carry no X (him-8: X nondisjunction in
// oogenesis). Selfed, such an egg fertilized by an X-bearing sperm is a male, so
// the share of males is the share of X-less eggs. Crossed to a male, the same
// eggs give extra males, some carrying the FATHER's X; an X-less egg cannot be
// fertilized by an X-less sperm, and the rest is rescaled. Without Him nothing
// changes.
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
    const kids = await herm.selfCross(undefined, 0.37);
    expect(maleShare(kids)).toBe(0);
  });

  test('a Him self cross gives the chosen share of males (its X-less eggs), the rest as usual', async () => {
    const herm = new Strain({ allelePairs: [x1.toTopHet(), a1.toTopHet()] });
    herm.him = true;
    const kids = await herm.selfCross(undefined, 0.37);
    expect(maleShare(kids)).toBeCloseTo(0.37, 9);
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
    expect(x1Males).toBeCloseTo(0.37 / 2, 9);
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
});

describe('a Him hermaphrodite crossed to a male', () => {
  const x2 = allele('x2', 'X', 5);
  const n = 0.37;
  const hermX1 = (): Strain => {
    const herm = new Strain({ allelePairs: [x1.toTopHet()] });
    herm.him = true;
    return herm;
  };
  const maleX2 = (): Strain =>
    new Strain({ allelePairs: [x2.toTopHet()] }).toggleSex();
  const has = (kid: Strain, name: string): boolean =>
    kid.getAlleles().some((a) => a.name === name && !a.isAbsent());
  const sum = (kids: Strain[]): number =>
    kids.reduce((total, kid) => total + (kid.probability ?? 0), 0);

  test('without Him the cross is the usual half males, all with the mother X', async () => {
    const herm = new Strain({ allelePairs: [x1.toTopHet()] });
    const kids = await herm.crossWith(maleX2(), { himNulloFraction: n });
    expect(maleShare(kids)).toBeCloseTo(0.5, 9);
    // no male carries the father's x2
    expect(
      sum(kids.filter((k) => k.sex === Sex.Male && has(k, 'x2')))
    ).toBeCloseTo(0, 9);
  });

  test('a Him mother gives extra males, some with the father X, and the rest is rescaled', async () => {
    const kids = await hermX1().crossWith(maleX2(), { himNulloFraction: n });
    const kept = (1 - n) * 0.5 + (1 - n) * 0.5 + n * 0.5; // 0.815
    expect(sum(kids)).toBeCloseTo(1, 9);
    // hermaphrodites: normal egg + the father's X sperm
    expect(sum(kids.filter((k) => k.sex === Sex.Hermaphrodite))).toBeCloseTo(
      ((1 - n) * 0.5) / kept,
      9
    );
    // males with the mother's X (never the father's x2)
    const maternal = kids.filter((k) => k.sex === Sex.Male && !has(k, 'x2'));
    expect(sum(maternal)).toBeCloseTo(((1 - n) * 0.5) / kept, 9);
    // males with the father's X: from the X-less eggs
    const paternal = kids.filter((k) => k.sex === Sex.Male && has(k, 'x2'));
    expect(sum(paternal)).toBeCloseTo((n * 0.5) / kept, 9);
    expect(maleShare(kids)).toBeGreaterThan(0.5);
  });

  test('works whichever parent crossWith is called on', async () => {
    const a = await hermX1().crossWith(maleX2(), { himNulloFraction: n });
    const b = await maleX2().crossWith(hermX1(), { himNulloFraction: n });
    expect(maleShare(b)).toBeCloseTo(maleShare(a), 9);
    expect(
      sum(b.filter((k) => k.sex === Sex.Male && has(k, 'x2')))
    ).toBeCloseTo((n * 0.5) / (1 - n + n * 0.5), 9);
  });

  test('a Him male parent changes nothing, only a hermaphrodite mother does', async () => {
    const herm = new Strain({ allelePairs: [x1.toTopHet()] });
    const himMale = maleX2();
    himMale.him = true;
    const kids = await herm.crossWith(himMale, { himNulloFraction: n });
    expect(maleShare(kids)).toBeCloseTo(0.5, 9);
  });

  test('without the setting passed, a Him mother crosses as usual', async () => {
    const kids = await hermX1().crossWith(maleX2());
    expect(maleShare(kids)).toBeCloseTo(0.5, 9);
  });
});
