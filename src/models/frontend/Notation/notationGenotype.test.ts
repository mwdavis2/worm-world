import { describe, expect, test } from 'vitest';
import { Sex } from 'models/enums';
import { Allele } from 'models/frontend/Allele/Allele';
import { AllelePair } from 'models/frontend/AllelePair/AllelePair';
import { Gene } from 'models/frontend/Gene/Gene';
import { Variation } from 'models/frontend/Variation/Variation';
import { Strain } from 'models/frontend/Strain/Strain';
import { type ChromosomeName } from 'models/db/filter/db_ChromosomeName';
import {
  findMatchingChild,
  lociToStrain,
  NotationGenotypeError,
  strainToLoci,
} from './notationGenotype';

const geneAllele = (
  name: string,
  chromosome: ChromosomeName,
  geneticLoc: number
): Allele =>
  new Allele({
    name,
    gene: new Gene({
      sysName: `${name}-gene`,
      descName: `${name}-gene`,
      chromosome,
      physLoc: geneticLoc * 1000,
      geneticLoc,
    }),
  });

// Two alleles on chromosome IV, two on X, one on II.
const a1 = geneAllele('a1', 'IV', 1);
const a2 = geneAllele('a2', 'IV', 3);
const x1 = geneAllele('x1', 'X', 2);
const x2 = geneAllele('x2', 'X', 4);
const b1 = geneAllele('b1', 'II', 5);
const lookup = new Map(
  [a1, a2, x1, x2, b1].map((allele) => [allele.name, allele])
);

const het = (allele: Allele): AllelePair => allele.toTopHet();
const transHet = (allele: Allele): AllelePair =>
  new AllelePair({ top: allele.toWild(), bot: allele });

describe('strainToLoci', () => {
  test('lists every non-wild pair as top/bottom, with the X always present', () => {
    const strain = new Strain({
      allelePairs: [het(a1), a2.toHomo(), het(x1)],
    });
    expect(strainToLoci(strain)).toEqual([
      { top: 'a1', bot: '+' },
      { top: 'a2', bot: 'a2' },
      { top: 'x1', bot: '+' },
    ]);
  });

  test('a hermaphrodite with nothing on X gets +/+ and a male gets +/0', () => {
    const herm = new Strain({ allelePairs: [het(a1)] });
    expect(strainToLoci(herm)).toEqual([
      { top: 'a1', bot: '+' },
      { top: '+', bot: '+' },
    ]);
    expect(strainToLoci(herm.toggleSex())).toEqual([
      { top: 'a1', bot: '+' },
      { top: '+', bot: '0' },
    ]);
  });

  test('a male writes his X alleles as allele/0, whatever the second slot holds', () => {
    const male = new Strain({ allelePairs: [het(x1), het(x2)] }).toggleSex();
    expect(strainToLoci(male)).toEqual([
      { top: 'x1', bot: '0' },
      { top: 'x2', bot: '0' },
    ]);
  });

  test('phase is kept: a trans pair reads +/allele', () => {
    const strain = new Strain({ allelePairs: [het(a1), transHet(a2)] });
    expect(strainToLoci(strain)).toEqual([
      { top: 'a1', bot: '+' },
      { top: '+', bot: 'a2' },
      { top: '+', bot: '+' },
    ]);
  });

  test('a wild-type strain is just the X placeholder', () => {
    expect(strainToLoci(new Strain({ allelePairs: [] }))).toEqual([
      { top: '+', bot: '+' },
    ]);
  });
});

describe('extrachromosomal arrays', () => {
  // An array has no second copy, so it is written bare: "oxEx6", not "oxEx6/+".
  const ex = new Allele({
    name: 'oxEx6',
    variation: new Variation({ name: 'oxEx6', chromosome: 'Ex' }),
  });
  const withArray = new Strain({ allelePairs: [het(a1), ex.toTopHet()] });

  test('are written bare and round-trip', () => {
    expect(strainToLoci(withArray)).toEqual([
      { top: 'a1', bot: '+' },
      { top: 'oxEx6' },
      { top: '+', bot: '+' },
    ]);
    const alleles = new Map([...lookup, ['oxEx6', ex]]);
    const rebuilt = lociToStrain(strainToLoci(withArray), alleles);
    expect(rebuilt.equals(withArray)).toBe(true);
    expect(strainToLoci(rebuilt)).toEqual(strainToLoci(withArray));
  });

  test('a bare name that is not an array is an error, and "array/+" still reads', () => {
    expect(() => lociToStrain([{ top: 'a1' }], lookup)).toThrow(
      /not an extrachromosomal array/
    );
    const alleles = new Map([...lookup, ['oxEx6', ex]]);
    const older = lociToStrain([{ top: 'oxEx6', bot: '+' }], alleles);
    expect(older.equals(new Strain({ allelePairs: [ex.toTopHet()] }))).toBe(
      true
    );
  });
});

describe('lociToStrain', () => {
  const roundTrip = (strain: Strain): Strain =>
    lociToStrain(strainToLoci(strain), lookup);

  test('loci round-trip through a hermaphrodite strain', () => {
    const strain = new Strain({
      allelePairs: [het(a1), transHet(a2), b1.toHomo(), het(x1)],
    });
    const rebuilt = roundTrip(strain);
    expect(rebuilt.sex).toBe(Sex.Hermaphrodite);
    expect(rebuilt.equals(strain)).toBe(true);
    expect(strainToLoci(rebuilt)).toEqual(strainToLoci(strain));
  });

  test('a 0 makes a male with its X alleles on the one X', () => {
    const male = new Strain({ allelePairs: [het(a1), het(x1)] }).toggleSex();
    const rebuilt = roundTrip(male);
    expect(rebuilt.sex).toBe(Sex.Male);
    expect(strainToLoci(rebuilt)).toEqual(strainToLoci(male));
    expect(rebuilt.equals(male)).toBe(true);
  });

  test('a male with nothing on X is just a male', () => {
    const rebuilt = lociToStrain(
      [
        { top: 'a1', bot: 'a1' },
        { top: '+', bot: '0' },
      ],
      lookup
    );
    expect(rebuilt.sex).toBe(Sex.Male);
    expect(strainToLoci(rebuilt)).toEqual([
      { top: 'a1', bot: 'a1' },
      { top: '+', bot: '0' },
    ]);
  });

  test('an unknown allele name is an error that names it', () => {
    expect(() => lociToStrain([{ top: 'nope', bot: '+' }], lookup)).toThrow(
      /Unknown allele "nope"/
    );
  });

  test('only X alleles can have no second copy', () => {
    expect(() => lociToStrain([{ top: 'a1', bot: '0' }], lookup)).toThrow(
      NotationGenotypeError
    );
  });

  test('two loci of the same gene are an error', () => {
    expect(() =>
      lociToStrain(
        [
          { top: 'a1', bot: '+' },
          { top: '+', bot: 'a1' },
        ],
        lookup
      )
    ).toThrow(NotationGenotypeError);
  });
});

describe('findMatchingChild', () => {
  // The children of a re-run cross are hermaphrodites.
  const herm = (...pairs: AllelePair[]): Strain =>
    new Strain({ allelePairs: pairs });

  test('a hermaphrodite target matches the child with that genotype', () => {
    const children = [
      herm(het(a1), het(x1)),
      herm(het(a1), a2.toHomo()),
      herm(a1.toHomo()),
    ];
    const target = herm(het(a1), a2.toHomo());
    expect(findMatchingChild(children, target)).toBe(children[1]);
  });

  test('no child fits', () => {
    expect(findMatchingChild([herm(het(a1))], herm(het(a2)))).toBeUndefined();
  });

  describe('a male target', () => {
    const maleTarget = (...pairs: AllelePair[]): Strain =>
      herm(...pairs).toggleSex();

    test('matches a child whose X carries the allele on the top', () => {
      const child = herm(het(a1), het(x1));
      const found = findMatchingChild([child], maleTarget(het(a1), het(x1)));
      expect(found?.sex).toBe(Sex.Male);
      expect(strainToLoci(found as Strain)).toEqual([
        { top: 'a1', bot: '+' },
        { top: 'x1', bot: '0' },
      ]);
    });

    test('matches a child whose X carries the allele on the bottom, putting it on top', () => {
      const child = herm(het(a1), transHet(x1));
      const found = findMatchingChild([child], maleTarget(het(a1), het(x1)));
      expect(found?.sex).toBe(Sex.Male);
      expect(strainToLoci(found as Strain)).toEqual([
        { top: 'a1', bot: '+' },
        { top: 'x1', bot: '0' },
      ]);
    });

    test('a male with nothing tracked on X matches the X homolog that carries nothing', () => {
      const child = herm(het(a1), het(x1));
      const found = findMatchingChild([child], maleTarget(het(a1)));
      expect(found?.sex).toBe(Sex.Male);
      expect(strainToLoci(found as Strain)).toEqual([
        { top: 'a1', bot: '+' },
        { top: '+', bot: '0' },
      ]);
    });

    test('several alleles on one X must be on the same homolog', () => {
      const cis = herm(het(x1), het(x2));
      const trans = herm(het(x1), transHet(x2));
      const target = maleTarget(het(x1), het(x2));
      expect(findMatchingChild([trans], target)).toBeUndefined();
      expect(findMatchingChild([trans, cis], target)?.sex).toBe(Sex.Male);
    });

    test('the autosomes must match too', () => {
      const child = herm(het(a2), het(x1));
      expect(
        findMatchingChild([child], maleTarget(het(a1), het(x1)))
      ).toBeUndefined();
    });

    test('the first matching child wins', () => {
      const first = herm(het(a1), het(x1));
      const second = herm(het(a1), transHet(x1));
      const found = findMatchingChild(
        [first, second],
        maleTarget(het(a1), het(x1))
      );
      expect(found?.chromPairMap.get('X')?.getTop()[0].name).toBe('x1');
    });
  });
});
