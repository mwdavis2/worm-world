// A male has one X, written `x1/0`: his sperm carry his X exactly as it is
// (it cannot recombine) or no X at all, half each. A cross therefore has
// hermaphrodite children (his X and one of the mother's) and male children
// (the mother's X alone). A hermaphrodite's X, and every autosome, recombine
// by map distance as always.
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

// two X-linked alleles 10 cM apart, and two autosomal ones 10 cM apart
const x1 = allele('x1', 'X', -5);
const x2 = allele('x2', 'X', 5);
const a1 = allele('a1', 'III', -5);
const a2 = allele('a2', 'III', 5);

// "herm" or "male", then how many copies of x1 and x2 the child carries
const copies = (kid: Strain): string => {
  const names = kid.getAlleles().map((a) => a.name);
  const count = (name: string): number =>
    names.filter((n) => n === name).length;
  return `${kid.sex === Sex.Male ? 'male' : 'herm'} x1:${count(
    'x1'
  )} x2:${count('x2')}`;
};

const byCopies = (kids: Strain[]): Record<string, number> =>
  Object.fromEntries(
    kids.map((kid) => [copies(kid), Number((kid.probability ?? 0).toFixed(9))])
  );

const total = (kids: Strain[]): number =>
  kids.reduce((sum, kid) => sum + (kid.probability ?? 0), 0);

// a male whose one X carries x1 and x2 in cis (made by toggling a
// hermaphrodite, as the app does)
const maleXCis = (): Strain =>
  new Strain({ allelePairs: [x1.toTopHet(), x2.toTopHet()] }).toggleSex();

describe("a male's X", () => {
  test('is stored as his alleles over the absent placeholder', () => {
    const male = maleXCis();
    expect(male.sex).toBe(Sex.Male);
    const pairs = male.getAllelePairs();
    expect(pairs.map((p) => p.top.name)).toEqual(['x1', 'x2']);
    expect(pairs.every((p) => p.bot.isAbsent() && !p.bot.isWild())).toBe(true);
    expect(pairs.every((p) => p.isHemizygous())).toBe(true);
    // the placeholder is not an allele he carries
    expect(male.getNonWildAlleles().map((a) => a.name)).toEqual(['x1', 'x2']);
  });

  test('a strain built as a male from a heterozygous X pair gets the same single X', () => {
    const male = new Strain({
      sex: Sex.Male,
      allelePairs: [x1.toTopHet()],
    });
    expect(male.getAllelePairs()[0].bot.isAbsent()).toBe(true);
  });

  test('a male cannot carry two different alleles on his one X', () => {
    // one allele on his one X is fine, even given as a homozygous pair
    expect(
      new Strain({ sex: Sex.Male, allelePairs: [x1.toHomo()] })
        .getAllelePairs()[0]
        .bot.isAbsent()
    ).toBe(true);
    const pair = x1.toTopHet();
    const x1Alt = allele('x1alt', 'X', -5);
    pair.bot = x1Alt;
    expect(() => new Strain({ sex: Sex.Male, allelePairs: [pair] })).toThrow(
      /single X/
    );
  });

  test('a male is not equal to a hermaphrodite with the same alleles', () => {
    const herm = new Strain({ allelePairs: [x1.toTopHet()] });
    const male = herm.toggleSex();
    expect(herm.equals(male)).toBe(false);
    expect(herm.equals(male, false, true)).toBe(true); // same alleles
  });

  test('his gametes are his intact X or no X, half each, never a recombinant', () => {
    const gametes = maleXCis().meiosis();
    const described = gametes.map((gamete) => ({
      alleles: gamete.chromosomes.map((chrom) => chrom.map((a) => a.name)),
      prob: gamete.prob,
    }));
    expect(described).toHaveLength(2);
    expect(described).toContainEqual({ alleles: [['x1', 'x2']], prob: 0.5 });
    expect(described).toContainEqual({ alleles: [['0', '0']], prob: 0.5 });
  });
});

describe("a male's X in a cross", () => {
  beforeEach(() => {
    mockIPC(() => []); // no saved strains to name the children after
  });
  afterEach(() => {
    clearMocks();
  });

  test("his X alleles stay together: no recombinant children, males have the mother's wild X", async () => {
    const kids = await maleXCis().crossWith(new Strain({ allelePairs: [] }));
    expect(byCopies(kids)).toEqual({
      'herm x1:1 x2:1': 0.5, // his X and her wild X
      'male x1:0 x2:0': 0.5, // her wild X alone
    });
    expect(total(kids)).toBeCloseTo(1, 9);
  });

  test("with one X allele: the mother's X varies, his X goes to daughters only", async () => {
    const male = new Strain({ allelePairs: [x1.toTopHet()] }).toggleSex();
    const herm = new Strain({ allelePairs: [x2.toTopHet()] }); // eggs: x2 or +
    const kids = await male.crossWith(herm);
    expect(byCopies(kids)).toEqual({
      'herm x1:1 x2:1': 0.25,
      'herm x1:1 x2:0': 0.25,
      'male x1:0 x2:1': 0.25,
      'male x1:0 x2:0': 0.25,
    });
    expect(total(kids)).toBeCloseTo(1, 9);
  });

  test("the mother's linked alleles recombine; sons get one of her gametes", async () => {
    const male = new Strain({ allelePairs: [x1.toTopHet()] }).toggleSex();
    // the mother carries x1 and x2 in cis, 10 cM apart: her eggs are
    // x1 x2 and + + (45% each) and the recombinants x1 + and + x2 (5% each)
    const herm = new Strain({ allelePairs: [x1.toTopHet(), x2.toTopHet()] });
    const kids = await male.crossWith(herm);
    expect(byCopies(kids)).toEqual({
      'herm x1:2 x2:1': 0.225, // x1 x2 egg + his X
      'herm x1:1 x2:0': 0.225, // + + egg + his X
      'herm x1:2 x2:0': 0.025, // x1 + egg
      'herm x1:1 x2:1': 0.025, // + x2 egg
      'male x1:1 x2:1': 0.225, // x1 x2 egg alone
      'male x1:0 x2:0': 0.225, // + + egg alone
      'male x1:1 x2:0': 0.025, // x1 + egg
      'male x1:0 x2:1': 0.025, // + x2 egg
    });
    expect(total(kids)).toBeCloseTo(1, 9);
  });

  test('a male with no X allele crossed with an X-linked hermaphrodite', async () => {
    const male = new Strain({ sex: Sex.Male, allelePairs: [] });
    const herm = new Strain({ allelePairs: [x1.toHomo()] });
    const kids = await male.crossWith(herm);
    expect(byCopies(kids)).toEqual({
      'herm x1:1 x2:0': 0.5, // her x1 and his wild X
      'male x1:1 x2:0': 0.5, // her x1 alone
    });
  });

  test('whichever parent the cross is called on', async () => {
    const male = new Strain({ allelePairs: [x1.toTopHet()] }).toggleSex();
    const herm = new Strain({ allelePairs: [x2.toTopHet()] });
    const fromMale = await male.crossWith(herm);
    const fromHerm = await herm.crossWith(male);
    expect(byCopies(fromHerm)).toEqual(byCopies(fromMale));
  });

  test('without any X data the children carry no sex split', async () => {
    const male = new Strain({
      sex: Sex.Male,
      allelePairs: [a1.toTopHet()],
    });
    const herm = new Strain({ allelePairs: [a2.toTopHet()] });
    const kids = await male.crossWith(herm);
    expect(kids.every((kid) => kid.sex === Sex.Hermaphrodite)).toBe(true);
    expect(total(kids)).toBeCloseTo(1, 9);
  });
});

describe('what still recombines', () => {
  test("a hermaphrodite's X recombines", () => {
    const herm = new Strain({ allelePairs: [x1.toTopHet(), x2.toTopHet()] });
    const probs = herm
      .meiosis()
      .map((gamete) => gamete.prob)
      .sort((a, b) => a - b);
    expect(probs).toHaveLength(4);
    expect(probs[0]).toBeCloseTo(0.05, 9);
  });

  test("a male's autosomes recombine as always", () => {
    const male = new Strain({
      sex: Sex.Male,
      allelePairs: [a1.toTopHet(), a2.toTopHet()],
    });
    const probs = male
      .meiosis()
      .map((gamete) => gamete.prob)
      .sort((a, b) => a - b);
    expect(probs).toHaveLength(4);
    expect(probs[0]).toBeCloseTo(0.05, 9);
  });
});
