import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, describe, expect, test } from 'vitest';
import { resetGeneticLocationCache } from 'utils/geneticLocation';
import { type db_Variation } from 'models/db/db_Variation';
import {
  type VariationRow,
  toDbVariation,
  toVariationRow,
  withDerivedGeneticLoc,
} from './variationRow';

const base: db_Variation = {
  alleleName: 'tmC5',
  chromosome: 'IV',
  physLoc: 9550000,
  geneticLoc: 4.31,
  recombSuppressor: [6600000, 12500000],
  isLocationReference: false,
  percentLoss: null,
};

describe('variation rows', () => {
  test('the stored range splits into start and end columns and back', () => {
    const row = toVariationRow(base);
    expect(row.recombSuppressorStart).toBe(6600000);
    expect(row.recombSuppressorEnd).toBe(12500000);
    expect('recombSuppressor' in row).toBe(false);
    expect(toDbVariation(row)).toEqual(base);
  });

  test('no range stays no range', () => {
    const row = toVariationRow({ ...base, recombSuppressor: null });
    expect(row.recombSuppressorStart).toBeNull();
    expect(row.recombSuppressorEnd).toBeNull();
    expect(toDbVariation(row).recombSuppressor).toBeNull();
  });

  test('clearing both columns removes the range', () => {
    const row = {
      ...toVariationRow(base),
      recombSuppressorStart: null,
      recombSuppressorEnd: null,
    };
    expect(toDbVariation(row).recombSuppressor).toBeNull();
  });

  test('only one of start/end is rejected', () => {
    const onlyStart = { ...toVariationRow(base), recombSuppressorEnd: null };
    const onlyEnd = { ...toVariationRow(base), recombSuppressorStart: null };
    expect(() => toDbVariation(onlyStart)).toThrow(/both a start and an end/);
    expect(() => toDbVariation(onlyEnd)).toThrow(/both a start and an end/);
  });

  test('a start that is not before the end is rejected', () => {
    const backwards = {
      ...toVariationRow(base),
      recombSuppressorStart: 12500000,
      recombSuppressorEnd: 6600000,
    };
    expect(() => toDbVariation(backwards)).toThrow(/start before it ends/);
  });
});

describe('withDerivedGeneticLoc', () => {
  const gene = (physLoc: number, geneticLoc: number): unknown => ({
    sysName: `g${physLoc}`,
    descName: null,
    chromosome: 'IV',
    physLoc,
    geneticLoc,
  });
  const mockGenes = (): void => {
    mockIPC((cmd) => {
      if (cmd === 'get_filtered_genes')
        return [gene(0, 0), gene(100, 10), gene(200, 20)];
      return [];
    });
  };
  afterEach(() => {
    clearMocks();
    resetGeneticLocationCache();
  });

  const row = (overrides: Partial<VariationRow>): VariationRow => ({
    ...toVariationRow(base),
    ...overrides,
  });

  test('fills in a missing genetic position from the physical one, to 2 decimals', async () => {
    mockGenes();
    const result = await withDerivedGeneticLoc(
      row({ chromosome: 'IV', physLoc: 33, geneticLoc: null })
    );
    expect(result.filled).toBe(true);
    expect(result.row.geneticLoc).toBe(3.3);
  });

  test('leaves a row alone when it already has a genetic position', async () => {
    mockGenes();
    const given = row({ physLoc: 33, geneticLoc: 4.31 });
    const result = await withDerivedGeneticLoc(given);
    expect(result.filled).toBe(false);
    expect(result.row).toBe(given);
  });

  test('leaves a row alone with no physical position, no chromosome, or an unmapped one', async () => {
    mockGenes();
    for (const overrides of [
      { physLoc: null, geneticLoc: null },
      { chromosome: null, physLoc: 33, geneticLoc: null },
      { chromosome: 'Ex' as const, physLoc: 33, geneticLoc: null },
    ]) {
      const result = await withDerivedGeneticLoc(row(overrides));
      expect(result.filled).toBe(false);
      expect(result.row.geneticLoc).toBeNull();
    }
  });
});
