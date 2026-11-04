import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { Allele } from 'models/frontend/Allele/Allele';
import { Strain } from 'models/frontend/Strain/Strain';
import { Variation } from 'models/frontend/Variation/Variation';
import { type ChromosomeName } from 'models/db/filter/db_ChromosomeName';
import { groupPunnettCells } from './punnettGroups';

const allele = (name: string, chromosome: ChromosomeName): Allele =>
  new Allele({
    name,
    variation: new Variation({ name, chromosome, geneticLoc: 0 }),
  });

const a1 = allele('a1', 'III');
const b1 = allele('b1', 'IV');

beforeEach(() => {
  mockIPC((cmd) => {
    if (cmd === 'get_filtered_strain_alleles') return [];
  });
});
afterEach(() => {
  clearMocks();
});

// the recessive visible phenotype of a1 (Unc) and b1 (Dpy), resolved by hand
const withPhenotypes = (cells: Array<Array<Strain | undefined>>): void => {
  cells.flat().forEach((cell) => {
    if (cell === undefined) return;
    const homozygous = (name: string): boolean =>
      cell.getAlleles().filter((a) => a.name === name).length === 2;
    cell.exprPhenotypeNames = [
      ...(homozygous('a1') ? ['Unc'] : []),
      ...(homozygous('b1') ? ['Dpy'] : []),
    ];
  });
};

const countsOf = (
  groups: ReturnType<typeof groupPunnettCells>,
  kind: 'genotype' | 'phenotype'
): number[] => {
  const seen = new Map<number, number>();
  groups.flat().forEach((g) => {
    if (g !== undefined) seen.set(g[kind].id, g[kind].count);
  });
  return [...seen.values()].sort((p, q) => q - p);
};

describe('groupPunnettCells', () => {
  test('a monohybrid self cross: genotypes 1/2/1 cells, phenotypes 3/1, with their totals', async () => {
    const herm = new Strain({ allelePairs: [a1.toTopHet()] });
    const { cells } = (await herm.punnett(herm)) as { cells: Strain[][] };
    withPhenotypes(cells);
    const groups = groupPunnettCells(cells);
    expect(countsOf(groups, 'genotype')).toEqual([2, 1, 1]);
    expect(countsOf(groups, 'phenotype')).toEqual([3, 1]);
    const unc = groups
      .flat()
      .find((g) => g?.phenotype.label === 'Unc')?.phenotype;
    expect(unc?.count).toBe(1);
    expect(unc?.probability).toBeCloseTo(0.25, 9);
    const wild = groups
      .flat()
      .find((g) => g?.phenotype.label === 'Wild type')?.phenotype;
    expect(wild?.count).toBe(3);
    expect(wild?.probability).toBeCloseTo(0.75, 9);
  });

  test('a dihybrid self cross is the 9:3:3:1 phenotypes over nine genotypes of 4,2,2,2,2,1,1,1,1 cells', async () => {
    const herm = new Strain({ allelePairs: [a1.toTopHet(), b1.toTopHet()] });
    const { cells } = (await herm.punnett(herm)) as { cells: Strain[][] };
    withPhenotypes(cells);
    const groups = groupPunnettCells(cells);
    expect(countsOf(groups, 'phenotype')).toEqual([9, 3, 3, 1]);
    expect(countsOf(groups, 'genotype')).toEqual([4, 2, 2, 2, 2, 1, 1, 1, 1]);
    const total = groups
      .flat()
      .filter((g) => g !== undefined)
      .map((g) => g?.phenotype)
      .filter((p, idx, all) => all.indexOf(p) === idx)
      .reduce((sum, p) => sum + (p?.probability ?? 0), 0);
    expect(total).toBeCloseTo(1, 9);
  });

  test('males and hermaphrodites split a phenotype group only when an allele is on the X', async () => {
    const male = (...alleles: Allele[]): Strain =>
      new Strain({ allelePairs: alleles.map((x) => x.toTopHet()) }).toggleSex();
    // autosomal alleles only: with no phenotype to tell them apart, both sexes
    // are one wild-type group
    const herm = new Strain({ allelePairs: [a1.toTopHet()] });
    const auto = (await herm.punnett(male(a1))) as { cells: Strain[][] };
    auto.cells.flat().forEach((cell) => {
      cell.exprPhenotypeNames = [];
    });
    expect(new Set(auto.cells.flat().map((c) => c.sex)).size).toBe(2);
    const autoLabels = new Set(
      groupPunnettCells(auto.cells)
        .flat()
        .map((g) => g?.phenotype.label)
    );
    expect(autoLabels).toEqual(new Set(['Wild type']));

    // an X-linked allele: the same phenotypes, but males and hermaphrodites differ
    const x1 = allele('x1', 'X');
    const x2 = allele('x2', 'X');
    const hermX = new Strain({ allelePairs: [x1.toTopHet()] });
    const xCross = (await hermX.punnett(male(x2))) as { cells: Strain[][] };
    xCross.cells.flat().forEach((cell) => {
      cell.exprPhenotypeNames = [];
    });
    const xGroups = groupPunnettCells(xCross.cells);
    const labels = new Set(xGroups.flat().map((g) => g?.phenotype.label));
    expect(labels).toEqual(
      new Set(['Wild type (male)', 'Wild type (hermaphrodite)'])
    );
  });

  test('a lethal cell is its own Lethal phenotype group', async () => {
    const herm = new Strain({ allelePairs: [a1.toTopHet()] });
    const { cells } = (await herm.punnett(herm)) as { cells: Strain[][] };
    withPhenotypes(cells);
    cells.flat().forEach((cell) => {
      if (cell.getAlleles().filter((a) => a.name === 'a1').length === 2)
        cell.lethal = true;
    });
    const labels = new Set(
      groupPunnettCells(cells)
        .flat()
        .map((g) => g?.phenotype.label)
    );
    expect(labels).toEqual(new Set(['Unc, Lethal', 'Wild type']));
  });

  test('a pairing that makes no worm has no groups', () => {
    expect(groupPunnettCells([[undefined]])).toEqual([[undefined]]);
  });
});
