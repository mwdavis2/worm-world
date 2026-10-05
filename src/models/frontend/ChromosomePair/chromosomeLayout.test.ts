import { describe, expect, test } from 'vitest';
import { Allele } from 'models/frontend/Allele/Allele';
import { AllelePair } from 'models/frontend/AllelePair/AllelePair';
import { ChromosomePair } from 'models/frontend/ChromosomePair/ChromosomePair';
import { Gene } from 'models/frontend/Gene/Gene';
import { Variation } from 'models/frontend/Variation/Variation';
import { type ChromosomeName } from 'models/db/filter/db_ChromosomeName';
import { getChromosomeLayout } from './chromosomeLayout';

const RANGE: [number, number] = [6_600_000, 12_500_000];

const rearrangement = (
  name: string,
  chromosome: ChromosomeName = 'IV',
  range: [number, number] = RANGE,
  geneticLoc = 4.31
): Allele =>
  new Allele({
    name,
    variation: new Variation({
      name,
      chromosome,
      physLoc: (range[0] + range[1]) / 2,
      geneticLoc,
      recombination: range,
    }),
  });

const marker = (
  name: string,
  physLoc: number | undefined,
  geneticLoc: number,
  chromosome: ChromosomeName = 'IV'
): Allele =>
  new Allele({
    name,
    gene: new Gene({
      sysName: `${name}-gene`,
      descName: `${name}-gene`,
      chromosome,
      physLoc,
      geneticLoc,
    }),
  });

/** A pair as "top/bottom" allele names. */
const pairOf = (top: Allele, bot: Allele): AllelePair =>
  new AllelePair({ top, bot });
const hetOf = (mutant: Allele): AllelePair => pairOf(mutant.toWild(), mutant);

/** The layout as readable tokens: "top/bot" for a column, "[" and "]". */
const tokens = (pair: ChromosomePair): string[] =>
  getChromosomeLayout(pair).map((item) =>
    item.kind === 'pair'
      ? `${item.pair.top.name}/${item.pair.bot.name}`
      : item.kind === 'open'
      ? '['
      : ']'
  );

const unc43 = marker('unc43', 10_324_254, 4.58);
const dpy20 = marker('dpy20', 11_696_430, 5.22);
const tmC5 = rearrangement('tmC5');
const balancerHet = (): AllelePair => pairOf(tmC5, tmC5.toWild());

describe('getChromosomeLayout', () => {
  test('a heterozygous balancer sits at the left edge of its range, with brackets around the markers inside it', () => {
    const pair = new ChromosomePair([
      hetOf(unc43),
      hetOf(dpy20),
      balancerHet(),
    ]);
    expect(tokens(pair)).toEqual(['tmC5/+', '[', '+/unc43', '+/dpy20', ']']);
  });

  test('a homozygous balancer marks its region too', () => {
    const pair = new ChromosomePair([
      pairOf(unc43.toWild(), unc43.toWild()),
      pairOf(dpy20.toWild(), dpy20.toWild()),
      pairOf(tmC5, tmC5),
    ]);
    expect(tokens(pair)).toEqual(['tmC5/tmC5', '[', '+/+', '+/+', ']']);
  });

  test('markers outside the range stay outside the brackets', () => {
    const before = marker('before', 5_000_000, 2.5);
    const after = marker('after', 15_000_000, 8.0);
    const pair = new ChromosomePair([
      hetOf(before),
      hetOf(unc43),
      hetOf(after),
      balancerHet(),
    ]);
    // The balancer is not pushed to the chromosome's far left: it sits at the
    // left edge of its region, after the marker that is outside it.
    expect(tokens(pair)).toEqual([
      '+/before',
      'tmC5/+',
      '[',
      '+/unc43',
      ']',
      '+/after',
    ]);
  });

  test('a marker with no physical position counts as outside', () => {
    const unplaced = marker('unplaced', undefined, 4.5);
    const pair = new ChromosomePair([
      hetOf(unplaced),
      hetOf(unc43),
      balancerHet(),
    ]);
    expect(tokens(pair)).toEqual(['+/unplaced', 'tmC5/+', '[', '+/unc43', ']']);
  });

  test('a balancer with nothing inside its range gets no brackets', () => {
    const pair = new ChromosomePair([
      hetOf(marker('after', 15_000_000, 8.0)),
      balancerHet(),
    ]);
    expect(tokens(pair)).toEqual(['tmC5/+', '+/after']);
    expect(tokens(new ChromosomePair([balancerHet()]))).toEqual(['tmC5/+']);
  });

  test('two separate regions get two bracket pairs', () => {
    const early = rearrangement('hT2', 'IV', [6_600_000, 9_000_000], 3.5);
    const late = rearrangement('tmC5', 'IV', [11_000_000, 12_500_000], 5.5);
    const pair = new ChromosomePair([
      hetOf(marker('a', 8_000_000, 3.8)),
      hetOf(marker('b', 10_000_000, 4.9)),
      hetOf(marker('c', 11_700_000, 5.3)),
      pairOf(early, early.toWild()),
      pairOf(late, late.toWild()),
    ]);
    // Each rearrangement sits at the left edge of its own region.
    expect(tokens(pair)).toEqual([
      'hT2/+',
      '[',
      '+/a',
      ']',
      '+/b',
      'tmC5/+',
      '[',
      '+/c',
      ']',
    ]);
  });

  test('overlapping ranges are one region', () => {
    const wide = rearrangement('wide', 'IV', [6_600_000, 10_500_000], 3.9);
    const pair = new ChromosomePair([
      hetOf(unc43),
      hetOf(dpy20),
      balancerHet(),
      pairOf(wide, wide.toWild()),
    ]);
    expect(tokens(pair).filter((t) => t === '[' || t === ']')).toEqual([
      '[',
      ']',
    ]);
  });

  test('your example: dpy-9 outside on the left, tmC5 at the edge of its region, tra-3 outside on the right', () => {
    const dpy9 = marker('dpy9', 257_384, -26.77);
    const lin45 = marker('lin45', 6_742_537, 3.23);
    const tra3 = marker('tra3', 14_436_445, 12.1);
    const pair = new ChromosomePair([
      pairOf(dpy9, dpy9),
      pairOf(lin45, lin45),
      pairOf(dpy20, dpy20),
      pairOf(tra3, tra3),
      pairOf(tmC5, tmC5),
    ]);
    expect(tokens(pair)).toEqual([
      'dpy9/dpy9',
      'tmC5/tmC5',
      '[',
      'lin45/lin45',
      'dpy20/dpy20',
      ']',
      'tra3/tra3',
    ]);
  });

  test('a chromosome with no rearrangement is left exactly as it is', () => {
    const pair = new ChromosomePair([hetOf(unc43), hetOf(dpy20)]);
    expect(tokens(pair)).toEqual(['+/unc43', '+/dpy20']);
  });

  test('extrachromosomal arrays are left as they are', () => {
    const array = new Allele({
      name: 'oxEx1',
      variation: new Variation({ name: 'oxEx1', chromosome: 'Ex' }),
    });
    const pair = new ChromosomePair([pairOf(array, array.toWild())]);
    expect(tokens(pair)).toEqual(['oxEx1/+']);
  });

  test("a translocation's two halves each bracket their own chromosome", () => {
    const eT1III = rearrangement(
      'eT1(III)',
      'III',
      [8_192_365, 13_783_733],
      -0.37
    );
    const eT1V = rearrangement('eT1(V)', 'V', [1, 8_934_697], 1.85);
    const onIII = new ChromosomePair([
      hetOf(marker('m3', 10_000_000, 1.49, 'III')),
      pairOf(eT1III, eT1III.toWild()),
    ]);
    const onV = new ChromosomePair([
      hetOf(marker('m5', 5_000_000, -1.0, 'V')),
      pairOf(eT1V, eT1V.toWild()),
    ]);
    expect(tokens(onIII)).toEqual(['eT1(III)/+', '[', '+/m3', ']']);
    expect(tokens(onV)).toEqual(['eT1(V)/+', '[', '+/m5', ']']);
  });

  test('the chromosome itself keeps its pair order (meiosis relies on it)', () => {
    const pair = new ChromosomePair([
      hetOf(unc43),
      hetOf(dpy20),
      balancerHet(),
    ]);
    const before = pair.allelePairs.map((p) => p.top.name);
    getChromosomeLayout(pair);
    expect(pair.allelePairs.map((p) => p.top.name)).toEqual(before);
  });
});

describe('rearrangement ranges', () => {
  test('a homozygous rearrangement has a region but no active suppressor', () => {
    const pair = new ChromosomePair([pairOf(tmC5, tmC5)]);
    expect(pair.getRearrangementRanges()).toEqual([RANGE]);
    expect(pair.getActiveSuppressors()).toEqual([]);
  });

  test('a heterozygous one has both', () => {
    const pair = new ChromosomePair([balancerHet()]);
    expect(pair.getRearrangementRanges()).toEqual([RANGE]);
    expect(pair.getActiveSuppressors()).toEqual([RANGE]);
  });
});
