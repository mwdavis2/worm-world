// Two insertions at one landing site are alleles of two different variations
// at the SAME position. A cross pairs an egg's loci with a sperm's loci by
// index, so every strain has to list tied loci in one fixed order; otherwise
// alleles of different loci are joined into one pair.
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Allele } from 'models/frontend/Allele/Allele';
import { Strain } from 'models/frontend/Strain/Strain';
import { Variation } from 'models/frontend/Variation/Variation';

const alleleAt = (name: string, physLoc: number, geneticLoc?: number): Allele =>
  new Allele({
    name,
    variation: new Variation({ name, chromosome: 'II', physLoc, geneticLoc }),
  });

const a = alleleAt('oxSi1215', 8420158);
const b = alleleAt('oxSi1308', 8420158);

/** every pair holds alleles of ONE locus: a mispaired genotype has two variations in one pair */
const pairedBySameLocus = (strain: Strain): boolean =>
  strain
    .getAllelePairs()
    .every((pair) => pair.top.variation?.name === pair.bot.variation?.name);

describe('loci at one position', () => {
  beforeEach(() => {
    mockIPC((cmd) => (cmd === 'get_filtered_strain_alleles' ? [] : []));
  });
  afterEach(() => {
    clearMocks();
  });

  test('crossing one insertion with the other pairs every child by locus, in either order', async () => {
    const p1 = new Strain({ allelePairs: [a.toTopHet()] });
    const p2 = new Strain({ allelePairs: [b.toTopHet()] });
    for (const [x, y] of [
      [p1, p2],
      [p2, p1],
    ]) {
      const children = await x.crossWith(y);
      expect(children).toHaveLength(4);
      expect(children.every(pairedBySameLocus)).toBe(true);
      children.forEach((child) => {
        expect(child.probability).toBeCloseTo(0.25);
      });
      // the child that got both has each allele opposite a wild partner at its
      // own locus (which side depends on which parent was which)
      const both = children.find(
        (child) => child.getAlleles().filter((al) => !al.isWild()).length === 2
      );
      expect(both).toBeDefined();
      expect(both?.getAllelePairs().every((pair) => pair.isWildHet())).toBe(
        true
      );
      expect(
        both
          ?.getAlleles()
          .filter((al) => !al.isWild())
          .map((al) => al.name)
          .sort()
      ).toEqual(['oxSi1215', 'oxSi1308']);
    }
  });

  test('selfing a double heterozygote never joins the two loci in one pair', async () => {
    const parent = new Strain({
      allelePairs: [a.toTopHet(), b.toBotHet()],
    });
    const children = await parent.selfCross();
    expect(children.length).toBeGreaterThan(0);
    expect(children.every(pairedBySameLocus)).toBe(true);
    const total = children.reduce((sum, c) => sum + (c.probability ?? 0), 0);
    expect(total).toBeCloseTo(1);
  });

  test('tied loci are listed in one fixed order whatever order they were added', () => {
    const forward = new Strain({
      allelePairs: [a.toTopHet(), b.toTopHet()],
    });
    const backward = new Strain({
      allelePairs: [b.toTopHet(), a.toTopHet()],
    });
    const order = (s: Strain): string[] =>
      s.getAllelePairs().map((pair) => pair.top.variation?.name ?? '');
    expect(order(forward)).toEqual(order(backward));
  });

  test('a tie in genetic position falls back to physical position', () => {
    const near = alleleAt('near', 1000, 1.5);
    const far = alleleAt('far', 2000, 1.5);
    for (const pairs of [
      [near.toTopHet(), far.toTopHet()],
      [far.toTopHet(), near.toTopHet()],
    ]) {
      const strain = new Strain({ allelePairs: pairs });
      expect(
        strain.getAllelePairs().map((pair) => pair.top.variation?.name)
      ).toEqual(['near', 'far']);
    }
  });

  test('a lower genetic position still comes first', () => {
    const early = alleleAt('early', 5000, 0.5);
    const late = alleleAt('late', 1000, 2.5);
    const strain = new Strain({
      allelePairs: [late.toTopHet(), early.toTopHet()],
    });
    expect(
      strain.getAllelePairs().map((pair) => pair.top.variation?.name)
    ).toEqual(['early', 'late']);
  });
});
