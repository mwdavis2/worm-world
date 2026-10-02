import { expect, test, describe } from 'vitest';
import {
  e204,
  ox802,
  ox1059,
  oxIs363,
  md299,
  oxEx100,
  oxEx200,
  oxEx300,
  oxEx2254,
} from 'models/frontend/Allele/Allele.mock';
import { AllelePair } from 'models/frontend/AllelePair/AllelePair';
import {
  ChromosomePair,
  chromsEqual,
} from 'models/frontend/ChromosomePair/ChromosomePair';
import { type ChromosomeName } from 'models/db/filter/db_ChromosomeName';
import { cmpChromName } from 'models/frontend/Strain/Strain';
import { Allele } from 'models/frontend/Allele/Allele';
import { Gene } from 'models/frontend/Gene/Gene';
import { Variation } from 'models/frontend/Variation/Variation';

describe('ChromosomePair', () => {
  test('Constructor sorts alleles', () => {
    const chromosomePair = new ChromosomePair([
      new AllelePair({ top: ox802, bot: ox802 }),
      new AllelePair({ top: e204, bot: e204.toWild() }),
    ]);

    // Notice sorted order
    expect(chromosomePair.allelePairs).toEqual([
      new AllelePair({ top: e204, bot: e204.toWild() }),
      new AllelePair({ top: ox802, bot: ox802 }),
    ]);
  });

  test('Constructor throws error when alleles are on different chromosomes', () => {
    expect(
      () =>
        new ChromosomePair([
          new AllelePair({ top: ox802, bot: ox802 }),
          new AllelePair({ top: md299, bot: md299.toWild() }),
        ])
    ).toThrow();
  });

  test('.getTop() returns top chrom', () => {
    const chromosomePair = new ChromosomePair([
      new AllelePair({ top: e204, bot: e204.toWild() }),
      new AllelePair({ top: ox802, bot: ox802 }),
      new AllelePair({ top: oxIs363.toWild(), bot: oxIs363 }),
    ]);

    const expected = [e204, ox802, oxIs363.toWild()];
    const topChrom = chromosomePair.getTop();

    expect(topChrom).toHaveLength(expected.length);
    topChrom.every((allele, idx) => allele.equals(expected[idx]));
  });

  test('.getBot() returns bot chrom', () => {
    const chromosomePair = new ChromosomePair([
      new AllelePair({ top: e204, bot: e204.toWild() }),
      new AllelePair({ top: ox802, bot: ox802 }),
      new AllelePair({ top: oxIs363.toWild(), bot: oxIs363 }),
    ]);

    const expected = [e204.toWild(), ox802, oxIs363];
    const botChrom = chromosomePair.getBot();

    expect(botChrom).toHaveLength(expected.length);
    botChrom.every((allele, idx) => allele.equals(expected[idx]));
  });

  test('.equals() true for equivalent same-side chromosome pairs', () => {
    const chromPair1 = new ChromosomePair([
      new AllelePair({ top: e204, bot: e204.toWild() }),
      new AllelePair({ top: ox802, bot: ox802 }),
      new AllelePair({ top: oxIs363.toWild(), bot: oxIs363 }),
    ]);
    const chromPair2 = new ChromosomePair([
      new AllelePair({ top: e204, bot: e204.toWild() }),
      new AllelePair({ top: ox802, bot: ox802 }),
      new AllelePair({ top: oxIs363.toWild(), bot: oxIs363 }),
    ]);

    expect(chromPair1.equals(chromPair2)).toBe(true);
    expect(chromPair2.equals(chromPair1)).toBe(true);
  });

  test('.equals() true for for equivalent flipped chromosome pairs', () => {
    const chromPair1 = new ChromosomePair([
      new AllelePair({ top: e204, bot: e204.toWild() }),
      new AllelePair({ top: ox802, bot: ox802 }),
      new AllelePair({ top: oxIs363.toWild(), bot: oxIs363 }),
    ]);
    const chromPair2 = new ChromosomePair([
      new AllelePair({ top: e204.toWild(), bot: e204 }),
      new AllelePair({ top: ox802, bot: ox802 }),
      new AllelePair({ top: oxIs363, bot: oxIs363.toWild() }),
    ]);

    expect(chromPair1.equals(chromPair2)).toBe(true);
    expect(chromPair2.equals(chromPair1)).toBe(true);
  });

  test('.equals() false for different chromosome pairs (allele mismatch)', () => {
    const chromPair1 = new ChromosomePair([
      new AllelePair({ top: e204, bot: e204.toWild() }),
      new AllelePair({ top: ox802, bot: ox802 }),
      new AllelePair({ top: oxIs363.toWild(), bot: oxIs363 }),
    ]);
    const chromPair2 = new ChromosomePair([
      new AllelePair({ top: e204, bot: e204.toWild() }),
      new AllelePair({ top: ox802, bot: ox802 }),
      new AllelePair({ top: ox1059.toWild(), bot: ox1059 }),
    ]);

    expect(chromPair1.equals(chromPair2)).toBe(false);
    expect(chromPair2.equals(chromPair1)).toBe(false);
  });

  test('.equals() false for different chromosome pairs (wildness mismatch)', () => {
    const chromPair1 = new ChromosomePair([
      new AllelePair({ top: e204, bot: e204.toWild() }),
      new AllelePair({ top: ox802, bot: ox802 }),
      new AllelePair({ top: oxIs363.toWild(), bot: oxIs363 }),
    ]);
    const chromPair2 = new ChromosomePair([
      new AllelePair({ top: e204, bot: e204.toWild() }),
      new AllelePair({ top: ox802, bot: ox802 }),
      new AllelePair({
        top: oxIs363.toWild(),
        bot: oxIs363.toWild(),
      }),
    ]);

    expect(chromPair1.equals(chromPair2)).toBe(false);
    expect(chromPair2.equals(chromPair1)).toBe(false);
  });

  test('chromsEqual() true when equal', () => {
    const chrom1 = [e204, ox802, oxIs363.toWild()];
    const chrom2 = [...chrom1];

    expect(chromsEqual(chrom1, chrom2));
    expect(chromsEqual(chrom2, chrom1));
  });

  test('chromsEqual() false when unequal', () => {
    const chrom1 = [e204, ox802, oxIs363.toWild()];
    const chrom2 = [e204, ox802, oxIs363];

    expect(chromsEqual(chrom1, chrom2));
    expect(chromsEqual(chrom2, chrom1));
  });

  test('cmpChromName() correctly orders chromosomes', () => {
    const expected: Array<ChromosomeName | undefined> = [
      'I',
      'II',
      'III',
      'IV',
      'V',
      'X',
      'Ex',
      undefined,
    ];
    const beforeSort: Array<ChromosomeName | undefined> = [
      'II',
      'I',
      'X',
      undefined,
      'Ex',
      'V',
      'IV',
      'III',
    ];
    const afterSort = beforeSort.sort(cmpChromName);
    afterSort.forEach((chrom, idx) => {
      expect(chrom).toEqual(expected[idx]);
    });
  });

  test('cmpChromName() puts undefined at end', () => {
    const beforeSort: Array<ChromosomeName | undefined> = [
      'II',
      undefined,
      'I',
    ];
    const expected: Array<ChromosomeName | undefined> = ['I', 'II', undefined];
    const afterSort = beforeSort.sort(cmpChromName);
    afterSort.forEach((chrom, idx) => {
      expect(chrom).toEqual(expected[idx]);
    });
  });

  test('(De)serializes', () => {
    const chromPair = new ChromosomePair([
      e204.toTopHet(),
      ox802.toHomo(),
      oxIs363.toBotHet(),
    ]);
    const str = chromPair.toJSON();
    const chromPairBack = ChromosomePair.fromJSON(str);
    expect(chromPairBack).toEqual(chromPair);
    expect(chromPairBack.allelePairs).toBeDefined();
    expect(chromPairBack.toJSON).toBeDefined();
  });
});

describe('ChromosomePair.crossEx()', () => {
  test('undefined inputs return a single empty-pair option at probability 1', () => {
    const options = ChromosomePair.crossEx(undefined, undefined);

    expect(options).toHaveLength(1);
    expect(options[0].pair.allelePairs).toHaveLength(0);
    expect(options[0].prob).toBeCloseTo(1, 6);
  });

  test('same array present in both parents is counted once, not twice', () => {
    // oxEx2254 has percentLoss: 50 -> transmission prob 0.5
    const leftPair = new ChromosomePair([oxEx2254.toTopHet()]);
    const rightPair = new ChromosomePair([oxEx2254.toBotHet()]);

    const options = ChromosomePair.crossEx(leftPair, rightPair);

    expect(options).toHaveLength(2);
    options.forEach((option) => {
      expect(option.pair.allelePairs.length).toBeLessThanOrEqual(1);
    });

    const present = options.find((o) => o.pair.allelePairs.length === 1);
    const absent = options.find((o) => o.pair.allelePairs.length === 0);
    expect(present?.prob).toBeCloseTo(0.5, 6);
    expect(absent?.prob).toBeCloseTo(0.5, 6);
  });

  test('reads a bottom-het Ex pair correctly', () => {
    // oxEx200 has percentLoss: 30 -> transmission prob 0.7
    const pair = new ChromosomePair([oxEx200.toBotHet()]);

    const options = ChromosomePair.crossEx(pair, undefined);

    expect(options).toHaveLength(2);
    const present = options.find((o) => o.pair.allelePairs.length === 1);
    const absent = options.find((o) => o.pair.allelePairs.length === 0);
    expect(present?.prob).toBeCloseTo(0.7, 6);
    expect(absent?.prob).toBeCloseTo(0.3, 6);
  });

  test('probabilities across all options sum to 1 for three independent arrays', () => {
    const pair = new ChromosomePair([
      oxEx100.toTopHet(), // 10% loss
      oxEx200.toTopHet(), // 30% loss
      oxEx300.toTopHet(), // 40% loss
    ]);

    const options = ChromosomePair.crossEx(pair, undefined);

    expect(options).toHaveLength(8);
    const probSum = options.reduce((sum, option) => sum + option.prob, 0);
    expect(probSum).toBeCloseTo(1, 6);
  });
});

describe('ChromosomePair.meiosis() with balancers', () => {
  // A balanced region on IV, 6.6-12.5 Mb, anchored (like tmC5 should be in the
  // data) at its midpoint so it sorts inside its own region.
  const RANGE: [number, number] = [6_600_000, 12_500_000];
  const balancerVariation = (
    name: string,
    range: [number, number] = RANGE
  ): Variation =>
    new Variation({
      name,
      chromosome: 'IV',
      physLoc: (range[0] + range[1]) / 2,
      geneticLoc: 4.31,
      recombination: range,
    });
  const balancer = (name = 'tmC5', range: [number, number] = RANGE): Allele =>
    new Allele({ name, variation: balancerVariation(name, range) });

  // A mutant allele of a marker gene at a given position.
  const marker = (
    name: string,
    physLoc: number | undefined,
    geneticLoc: number
  ): Allele =>
    new Allele({
      name,
      gene: new Gene({
        sysName: `${name}-gene`,
        descName: `${name}-gene`,
        chromosome: 'IV',
        physLoc,
        geneticLoc,
      }),
    });

  /** Probability of the gamete chromosome with these allele names, in position order. */
  const probOf = (pair: ChromosomePair, names: string[]): number =>
    pair
      .meiosis()
      .filter(
        (option) =>
          option.chromosome.map((allele) => allele.name).join(' ') ===
          names.join(' ')
      )
      .reduce((sum, option) => sum + option.prob, 0);

  const inside1 = marker('a1', 8_000_000, 4.0);
  const inside2 = marker('a2', 10_000_000, 5.0);

  /** balancer / (markers) - the balancer on top, the mutant markers on the bottom. */
  const balanced = (markers: Allele[], bal = balancer()): ChromosomePair =>
    new ChromosomePair([
      ...markers.map((m) => new AllelePair({ top: m.toWild(), bot: m })),
      new AllelePair({ top: bal, bot: bal.toWild() }),
    ]);

  test('a heterozygous balancer leaves only the two parental chromosomes', () => {
    const options = balanced([inside1, inside2]).meiosis();
    const possible = options.filter((option) => option.prob > 1e-12);
    // Position order: a1 (4.0 cM), the balancer (4.31, between them), a2 (5.0).
    expect(
      possible
        .map((o) => o.chromosome.map((a) => a.name).join(' '))
        .sort((x, y) => x.localeCompare(y))
    ).toEqual(['+ tmC5 +', 'a1 + a2']);
    possible.forEach((option) => {
      expect(option.prob).toBeCloseTo(0.5);
    });
  });

  test('without a balancer the same markers recombine at the genetic-distance rate', () => {
    const pair = new ChromosomePair([
      new AllelePair({ top: inside1.toWild(), bot: inside1 }),
      new AllelePair({ top: inside2.toWild(), bot: inside2 }),
    ]);
    // |4.0 - 5.0| cM / 2 / 100 = 0.005 for each recombinant class.
    expect(probOf(pair, ['+', 'a2'])).toBeCloseTo(0.005);
    expect(probOf(pair, ['a1', '+'])).toBeCloseTo(0.005);
    expect(probOf(pair, ['+', '+'])).toBeCloseTo(0.495);
  });

  test('a homozygous balancer suppresses nothing', () => {
    const bal = balancer();
    const pair = new ChromosomePair([
      new AllelePair({ top: inside1.toWild(), bot: inside1 }),
      new AllelePair({ top: bal, bot: bal }),
      new AllelePair({ top: inside2.toWild(), bot: inside2 }),
    ]);
    expect(pair.getActiveSuppressors()).toEqual([]);
    // inside1 (4.0) and the balancer (4.31) are 0.31 cM apart: 0.00155.
    expect(probOf(pair, ['+', 'tmC5', 'a2'])).toBeCloseTo(0.00155);
  });

  test('a gap that straddles the balancer edge is scaled by its uncovered share', () => {
    // Left marker at 5.6 Mb is outside the range; 8.0 Mb is inside. The gap
    // spans 2.4 Mb, 1.4 Mb of it inside, so 1 - 1.4/2.4 stays crossable.
    const left = marker('aL', 5_600_000, 2.5);
    const pair = balanced([left, inside1]);
    const base = Math.abs(2.5 - 4.0) / 2 / 100; // 0.0075
    expect(probOf(pair, ['+', 'a1', '+'])).toBeCloseTo(base * (1 - 1.4 / 2.4));
  });

  test('a gap entirely outside the balanced region is unchanged', () => {
    const out1 = marker('o1', 15_000_000, 8.0);
    const out2 = marker('o2', 16_000_000, 9.0);
    const pair = balanced([out1, out2]);
    // |8 - 9| / 200 = 0.005, with the balancer sorted before both.
    expect(probOf(pair, ['tmC5', '+', 'o2'])).toBeCloseTo(0.005);
  });

  test('a gap is not suppressed when a flanking locus has no physical position', () => {
    const noPhys = marker('x1', undefined, 4.0);
    const pair = balanced([noPhys, inside2]);
    // x1 (4.0) and the balancer (4.31): 0.31 cM / 200, even though that is
    // inside the range, since x1's physical position is unknown.
    expect(probOf(pair, ['+', '+', 'a2'])).toBeCloseTo(0.00155);
  });

  test('overlapping balancer ranges are merged, not counted twice', () => {
    const other = balancer('tmC5-variant', [10_000_000, 14_000_000]);
    const pair = new ChromosomePair([
      new AllelePair({ top: balancer(), bot: balancer().toWild() }),
      new AllelePair({ top: other, bot: other.toWild() }),
    ]);
    expect(pair.getActiveSuppressors()).toEqual([[6_600_000, 14_000_000]]);
  });

  test('a wild copy of a balancer does not count as a balancer', () => {
    const wildOnly = new ChromosomePair([
      new AllelePair({ top: balancer().toWild(), bot: balancer().toWild() }),
    ]);
    expect(wildOnly.getActiveSuppressors()).toEqual([]);
    expect(balanced([inside1]).getActiveSuppressors()).toEqual([RANGE]);
  });

  test('suppressed and unsuppressed gametes still total 1', () => {
    [
      balanced([inside1, inside2]),
      balanced([marker('aL', 5_600_000, 2.5), inside1]),
    ].forEach((pair) => {
      const total = pair
        .meiosis()
        .reduce((sum, option) => sum + option.prob, 0);
      expect(total).toBeCloseTo(1);
    });
  });
});
