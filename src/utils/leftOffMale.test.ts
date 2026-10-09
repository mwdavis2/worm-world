import { describe, expect, test } from 'vitest';
import { Allele } from 'models/frontend/Allele/Allele';
import { Strain } from 'models/frontend/Strain/Strain';
import { Variation } from 'models/frontend/Variation/Variation';
import { allelesLeftOffMale, leftOffMaleMessage } from 'utils/leftOffMale';

const x = (name: string, loc: number): Allele =>
  new Allele({
    name,
    variation: new Variation({ name, chromosome: 'X', geneticLoc: loc }),
  });
const e678 = x('e678', -6.7);
const md299 = x('md299', -1.3);

describe('alleles a male leaves off', () => {
  test('a trans heterozygote: the bottom X allele is left off', () => {
    const herm = new Strain({
      allelePairs: [e678.toTopHet(), md299.toBotHet()],
    });
    expect(allelesLeftOffMale(herm)).toEqual(['md299']);
    expect(leftOffMaleMessage(herm)).toBe(
      'md299 is on the other X, so it is left off the male, who keeps the top X. Toggling back restores it.'
    );
  });

  test('several alleles are listed once each', () => {
    const herm = new Strain({
      allelePairs: [e678.toBotHet(), md299.toBotHet()],
    });
    expect(allelesLeftOffMale(herm)).toEqual(['e678', 'md299']);
    expect(leftOffMaleMessage(herm)).toContain('are on the other X');
  });

  test('nothing is left off when the bottom X is wild, or for a male', () => {
    const cis = new Strain({
      allelePairs: [e678.toTopHet(), md299.toTopHet()],
    });
    expect(allelesLeftOffMale(cis)).toEqual([]);
    expect(leftOffMaleMessage(cis)).toBeUndefined();
    expect(allelesLeftOffMale(cis.toggleSex())).toEqual([]);
  });

  test('an allele on both X chromosomes is not lost', () => {
    const homo = new Strain({ allelePairs: [e678.toHomo()] });
    expect(allelesLeftOffMale(homo)).toEqual([]);
    expect(leftOffMaleMessage(homo)).toBeUndefined();
  });

  test('a compound heterozygote on X: the bottom allele is left off', () => {
    const e678b = x('e678b', -6.7);
    const pair = e678.toTopHet();
    pair.bot = e678b;
    const herm = new Strain({ allelePairs: [pair] });
    expect(allelesLeftOffMale(herm)).toEqual(['e678b']);
  });
});
