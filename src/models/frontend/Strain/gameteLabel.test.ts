import { describe, expect, test } from 'vitest';
import { Allele } from 'models/frontend/Allele/Allele';
import { Strain } from 'models/frontend/Strain/Strain';
import { Variation } from 'models/frontend/Variation/Variation';
import { gameteLabel } from 'models/frontend/Strain/gameteLabel';

const allele = (name: string, chromosome: 'III' | 'IV' | 'X'): Allele =>
  new Allele({
    name,
    variation: new Variation({ name, chromosome, geneticLoc: 0 }),
  });

describe('gameteLabel', () => {
  test('names the mutant alleles and writes + for the wild ones, by chromosome', () => {
    const herm = new Strain({
      allelePairs: [
        allele('a1', 'III').toTopHet(),
        allele('b1', 'IV').toTopHet(),
      ],
    });
    expect(herm.meiosis().map(gameteLabel).sort()).toEqual([
      '+; +',
      '+; b1',
      'a1; +',
      'a1; b1',
    ]);
  });

  test("a male's X-less gamete reads 0", () => {
    const male = new Strain({
      allelePairs: [allele('x1', 'X').toTopHet()],
    }).toggleSex();
    expect(male.meiosis().map(gameteLabel).sort()).toEqual(['0', 'x1']);
  });
});
