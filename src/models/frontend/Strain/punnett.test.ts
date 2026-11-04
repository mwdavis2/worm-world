// The Punnett square of a cross: each parent's gametes with their probabilities
// and the child of every pairing. Its cells are the children the same cross
// gives on the canvas, so each grid is checked against crossWith/selfCross.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { Allele } from 'models/frontend/Allele/Allele';
import {
  MAX_PUNNETT_GAMETES,
  Strain,
  type PunnettSquare,
} from 'models/frontend/Strain/Strain';
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

const a1 = allele('a1', 'III', 0);
const b1 = allele('b1', 'IV', 0);
const c1 = allele('c1', 'III', 10);
const x1 = allele('x1', 'X', 0);
const x2 = allele('x2', 'X', 5);

beforeEach(() => {
  mockIPC((cmd) => {
    if (cmd === 'get_filtered_strain_alleles') return [];
  });
});
afterEach(() => {
  clearMocks();
});

const gridOf = (
  square: PunnettSquare
): Extract<PunnettSquare, { kind: 'grid' }> => {
  if (square.kind !== 'grid') throw new Error(`no grid: ${square.kind}`);
  return square;
};
const cellsOf = (square: PunnettSquare): Strain[] =>
  gridOf(square)
    .cells.flat()
    .filter((cell): cell is Strain => cell !== undefined);
const sum = (kids: Strain[]): number =>
  kids.reduce((total, kid) => total + (kid.probability ?? 0), 0);

describe('Strain.punnett', () => {
  test('selfing a double heterozygote at unlinked loci is a 4x4 grid of 1/16', async () => {
    const herm = new Strain({ allelePairs: [a1.toTopHet(), b1.toTopHet()] });
    const grid = gridOf(await herm.punnett(herm));
    expect(grid.rows).toHaveLength(4);
    expect(grid.cols).toHaveLength(4);
    grid.rows.forEach((row) => {
      expect(row.prob).toBeCloseTo(0.25, 9);
    });
    cellsOf(grid).forEach((cell) => {
      expect(cell.probability).toBeCloseTo(1 / 16, 9);
    });
    expect(sum(cellsOf(grid))).toBeCloseTo(1, 9);
  });

  test('the cells add up, genotype by genotype, to what selfCross gives', async () => {
    const herm = new Strain({ allelePairs: [a1.toTopHet(), b1.toTopHet()] });
    const cells = cellsOf(await herm.punnett(herm));
    const kids = await herm.selfCross();
    kids.forEach((kid) => {
      const same = cells.filter((cell) => cell.equals(kid));
      expect(sum(same)).toBeCloseTo(kid.probability ?? 0, 9);
    });
    expect(sum(cells)).toBeCloseTo(sum(kids), 9);
  });

  test('linked loci give unequal gamete weights, the recombinants being rarer', async () => {
    const herm = new Strain({ allelePairs: [a1.toTopHet(), c1.toTopHet()] });
    const grid = gridOf(await herm.punnett(herm));
    const probs = grid.rows.map((row) => row.prob).sort((p, q) => q - p);
    expect(probs).toHaveLength(4);
    // 10 cM apart: parental 0.45 each, recombinant 0.05 each
    expect(probs[0]).toBeCloseTo(0.45, 9);
    expect(probs[1]).toBeCloseTo(0.45, 9);
    expect(probs[2]).toBeCloseTo(0.05, 9);
    expect(probs[3]).toBeCloseTo(0.05, 9);
    expect(sum(cellsOf(grid))).toBeCloseTo(1, 9);
  });

  test('a male has X and X-less gametes, and a pairing of two X-less ones makes no worm', async () => {
    const herm = new Strain({ allelePairs: [x1.toTopHet()] });
    const male = new Strain({ allelePairs: [x2.toTopHet()] }).toggleSex();
    const grid = gridOf(await herm.punnett(male));
    expect(grid.rows).toHaveLength(2);
    expect(grid.cols).toHaveLength(2);
    expect(grid.cols.filter((col) => col.nulloX === true)).toHaveLength(0);
    const kids = cellsOf(grid);
    expect(sum(kids)).toBeCloseTo(1, 9);
    // the same children as the cross on the canvas
    const crossed = await male.crossWith(herm);
    expect(sum(kids.filter((k) => k.sex === Sex.Male))).toBeCloseTo(
      sum(crossed.filter((k) => k.sex === Sex.Male)),
      9
    );
  });

  test('a Him hermaphrodite selfing: only the eggs may lack an X, giving the chosen share of males', async () => {
    const herm = new Strain({ allelePairs: [x1.toTopHet()] });
    herm.him = true;
    const grid = gridOf(await herm.punnett(herm, { himNulloFraction: 0.37 }));
    expect(grid.rows.some((row) => row.nulloX === true)).toBe(false);
    expect(grid.cols.some((col) => col.nulloX === true)).toBe(true);
    const kids = cellsOf(grid);
    expect(sum(kids)).toBeCloseTo(1, 9);
    expect(sum(kids.filter((k) => k.sex === Sex.Male))).toBeCloseTo(0.37, 9);
  });

  test('a Him hermaphrodite crossed to a male: two X-less gametes leave an empty cell and the rest rescale', async () => {
    const herm = new Strain({ allelePairs: [x1.toTopHet()] });
    herm.him = true;
    const male = new Strain({ allelePairs: [x2.toTopHet()] }).toggleSex();
    const grid = gridOf(await herm.punnett(male, { himNulloFraction: 0.37 }));
    expect(grid.cells.flat().some((cell) => cell === undefined)).toBe(true);
    const kids = cellsOf(grid);
    expect(sum(kids)).toBeCloseTo(1, 9);
    const crossed = await male.crossWith(herm, { himNulloFraction: 0.37 });
    expect(sum(kids.filter((k) => k.sex === Sex.Male))).toBeCloseTo(
      sum(crossed.filter((k) => k.sex === Sex.Male)),
      9
    );
  });

  test('each child is resolved for lethality and phenotypes like a card', async () => {
    const herm = new Strain({ allelePairs: [a1.toTopHet()] });
    const cells = cellsOf(await herm.punnett(herm));
    cells.forEach((cell) => {
      expect(cell.lethal).toBe(false);
      expect(cell.exprPhenotypeNames).toEqual([]);
    });
  });

  test('more gametes than the cap give a message, not a grid', async () => {
    // one heterozygous locus on each of six chromosomes is 2^6 = 64 gametes
    const chromosomes: ChromosomeName[] = ['I', 'II', 'III', 'IV', 'V', 'X'];
    const herm = new Strain({
      allelePairs: chromosomes.map((chromosome, idx) =>
        allele(`g${idx}`, chromosome, 0).toTopHet()
      ),
    });
    const square = await herm.punnett(herm);
    expect(square.kind).toBe('tooMany');
    if (square.kind === 'tooMany')
      expect(square.rows).toBeGreaterThan(MAX_PUNNETT_GAMETES);
  });
});
