// Spike for the translocation-balancer data encoding (eT1 and its kin): the
// rows here are exactly what the generator will emit, built in memory, to
// prove the encoding works in the real resolver before ~200 rows are made.
//
// A translocation is a pair of half-alleles, one per chromosome. Each half
// expresses "<half> 1 copy" / "<half> 2 copies" marker phenotypes (wild, so
// hidden on cards), and two global lethal phenotypes - aneuploid (het) and
// (hom) - each suppressed by the PARTNER half's matching marker. So the
// animal is viable exactly when both halves are present in equal numbers.
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { Allele } from 'models/frontend/Allele/Allele';
import { AlleleExpression } from 'models/frontend/AlleleExpression/AlleleExpression';
import { AllelePair } from 'models/frontend/AllelePair/AllelePair';
import { ChromosomePair } from 'models/frontend/ChromosomePair/ChromosomePair';
import { Gene } from 'models/frontend/Gene/Gene';
import { Phenotype } from 'models/frontend/Phenotype/Phenotype';
import { Strain } from 'models/frontend/Strain/Strain';
import { StrainFilter } from 'models/frontend/StrainFilter/StrainFilter';
import { Variation } from 'models/frontend/Variation/Variation';

beforeEach(() => {
  mockIPC((cmd) => {
    if (cmd === 'get_filtered_strain_alleles') return [];
  });
});
afterAll(() => {
  clearMocks();
});

const marker = (name: string): Phenotype =>
  new Phenotype({ name, shortName: name, wild: true });
const M3_1 = marker('eT1(III) 1 copy');
const M3_2 = marker('eT1(III) 2 copies');
const M5_1 = marker('eT1(V) 1 copy');
const M5_2 = marker('eT1(V) 2 copies');
const ANEUPLOID_HET = new Phenotype({
  name: 'translocation aneuploid (het)',
  shortName: 'aneuploid',
  wild: false,
  lethal: true,
});
const ANEUPLOID_HOM = new Phenotype({
  name: 'translocation aneuploid (hom)',
  shortName: 'aneuploid',
  wild: false,
  lethal: true,
});
const UNC36 = new Phenotype({
  name: 'unc-36',
  shortName: 'Unc-36',
  wild: false,
});

const row = (
  alleleName: string,
  phenotype: Phenotype,
  dominance: '1' | '2',
  suppressingPhenotypes: Phenotype[] = []
): AlleleExpression =>
  new AlleleExpression({
    alleleName,
    expressingPhenotype: phenotype,
    requiredPhenotypes: [],
    suppressingPhenotypes,
    requiredConditions: [],
    suppressingConditions: [],
    dominance,
  });

// Positions are at the boundary of each half's balanced region (the end of its
// range that isn't a chromosome end), with genetic positions interpolated from
// the gene table.
const half = (
  name: string,
  chromosome: 'III' | 'V',
  range: [number, number],
  boundary: { physLoc: number; geneticLoc: number },
  rows: AlleleExpression[]
): Allele =>
  new Allele({
    name,
    variation: new Variation({
      name,
      chromosome,
      ...boundary,
      recombination: range,
    }),
    alleleExpressions: rows,
  });

const eT1III = half(
  'eT1(III)',
  'III',
  [8_192_365, 13_783_733],
  { physLoc: 8_192_365, geneticLoc: -0.37 },
  [
    row('eT1(III)', M3_1, '1'),
    row('eT1(III)', M3_2, '2'),
    row('eT1(III)', ANEUPLOID_HET, '1', [M5_1]),
    row('eT1(III)', ANEUPLOID_HOM, '2', [M5_2]),
    row('eT1(III)', UNC36, '2'), // eT1 carries unc-36(e873)
  ]
);
const eT1V = half(
  'eT1(V)',
  'V',
  [1, 8_934_697],
  { physLoc: 8_934_697, geneticLoc: 1.85 },
  [
    row('eT1(V)', M5_1, '1'),
    row('eT1(V)', M5_2, '2'),
    row('eT1(V)', ANEUPLOID_HET, '1', [M3_1]),
    row('eT1(V)', ANEUPLOID_HOM, '2', [M3_2]),
  ]
);

/** A strain carrying `copies` (0, 1 or 2) of each half. */
const withCopies = (copies3: number, copies5: number): Strain => {
  const pairOf = (allele: Allele, copies: number): AllelePair[] =>
    copies === 0 ? [] : [copies === 1 ? allele.toTopHet() : allele.toHomo()];
  return new Strain({
    allelePairs: [...pairOf(eT1III, copies3), ...pairOf(eT1V, copies5)],
  });
};

const COPIES = [0, 1, 2];
const combos = COPIES.flatMap((c3) => COPIES.map((c5) => [c3, c5]));

describe('translocation encoding (eT1)', () => {
  test.each(combos)(
    'III copies %i, V copies %i: lethal unless the halves are present in equal numbers',
    (c3, c5) => {
      const strain = withCopies(c3, c5);
      expect(strain.isLethal()).toBe(c3 !== c5);
    }
  );

  test.each(combos)(
    'III copies %i, V copies %i: nothing is left unresolved',
    (c3, c5) => {
      expect(withCopies(c3, c5).getUnresolvedExprPhenotypes()).toEqual([]);
    }
  );

  test('selfing the balanced heterozygote gives 3/8 viable, split 1:4:1', async () => {
    const parent = withCopies(1, 1);
    const children = await parent.selfCross();

    const countOf = (child: Strain, name: string): number =>
      child.getAlleles().filter((allele) => allele.name === name).length;
    const byCopies = new Map<string, number>();
    let viable = 0;
    children.forEach((child) => {
      const key = `${countOf(child, 'eT1(III)')},${countOf(child, 'eT1(V)')}`;
      byCopies.set(key, (byCopies.get(key) ?? 0) + child.probability);
      if (!child.isLethal()) viable += child.probability;
    });

    expect(viable).toBeCloseTo(3 / 8);
    expect(byCopies.get('0,0')).toBeCloseTo(1 / 16); // +/+
    expect(byCopies.get('1,1')).toBeCloseTo(4 / 16); // eT1/+
    expect(byCopies.get('2,2')).toBeCloseTo(1 / 16); // eT1/eT1
    const total = [...byCopies.values()].reduce((sum, p) => sum + p, 0);
    expect(total).toBeCloseTo(1);
  });

  test('eT1 homozygotes show unc-36; the copy markers never appear on the card', () => {
    const homozygote = withCopies(2, 2);
    homozygote.refreshCardInfo();
    expect(homozygote.exprPhenotypeNames).toEqual(['Unc-36']);

    const balanced = withCopies(1, 1);
    balanced.refreshCardInfo();
    expect(balanced.exprPhenotypeNames).toEqual([]);
    expect(balanced.lethal).toBe(false);
  });

  test('aneuploid genotypes are hidden by the default viability filter', () => {
    const filter = new StrainFilter();
    expect(withCopies(1, 1).passesFilter(filter)).toBe(true);
    expect(withCopies(1, 0).passesFilter(filter)).toBe(false);
    expect(withCopies(2, 1).passesFilter(filter)).toBe(false);
  });
});

describe('a translocation half suppresses crossovers inside its region', () => {
  const markerAllele = (
    name: string,
    physLoc: number,
    geneticLoc: number
  ): Allele =>
    new Allele({
      name,
      gene: new Gene({
        sysName: `${name}-gene`,
        descName: `${name}-gene`,
        chromosome: 'III',
        physLoc,
        geneticLoc,
      }),
    });

  /** half / (marker) - the half on top, the mutant marker on the bottom. */
  const chromosome = (m: Allele): ChromosomePair =>
    new ChromosomePair([
      new AllelePair({ top: m.toWild(), bot: m }),
      new AllelePair({ top: eT1III, bot: eT1III.toWild() }),
    ]);

  const recombinantProb = (pair: ChromosomePair): number =>
    pair
      .meiosis()
      .filter((option) => {
        const names = option.chromosome.map((allele) => allele.name);
        // A recombinant carries the marker's mutant allele with the half, or
        // the wild marker without it.
        return names.join(' ') === '+ +' || names.join(' ') === 'mk eT1(III)';
      })
      .reduce((sum, option) => sum + option.prob, 0);

  test('a marker inside the region (past the boundary) does not recombine with the half', () => {
    // 10 Mb is inside eT1(III)'s 8.19-13.78 Mb region; gap is fully covered.
    const inside = markerAllele('mk', 10_000_000, 1.49);
    expect(recombinantProb(chromosome(inside))).toBeCloseTo(0);
  });

  test('a marker outside the region recombines with the half at the normal rate', () => {
    // 5 Mb is outside; the gap from there to the boundary touches no range.
    const outside = markerAllele('mk', 5_000_000, -2.25);
    // |-2.25 - (-0.37)| cM / 2 / 100 = 0.0094 per recombinant class.
    expect(recombinantProb(chromosome(outside))).toBeCloseTo(0.0094 * 2);
  });
});
