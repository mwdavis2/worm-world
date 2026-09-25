import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { type db_Gene } from 'models/db/db_Gene';
import {
  interpolateGeneticLoc,
  resetGeneticLocationCache,
} from 'utils/geneticLocation';

const mkGene = (
  sysName: string,
  chromosome: string,
  physLoc: number,
  geneticLoc: number
): db_Gene => ({
  sysName,
  descName: null,
  chromosome: chromosome as db_Gene['chromosome'],
  physLoc,
  geneticLoc,
});

describe('interpolateGeneticLoc', () => {
  afterEach(() => {
    clearMocks();
    resetGeneticLocationCache();
  });

  test('interpolates between the two nearest flanking anchors', async () => {
    mockIPC((cmd) => {
      if (cmd === 'get_filtered_genes') {
        return [
          mkGene('g1', 'I', 0, 0),
          mkGene('g2', 'I', 100, 10),
          mkGene('g3', 'I', 200, 20),
        ];
      }
      return [];
    });

    const result = await interpolateGeneticLoc('I', 50);
    expect(result).toBeCloseTo(5, 5);
  });

  test('extrapolates using the two nearest anchors when physLoc is below the known range', async () => {
    mockIPC((cmd) => {
      if (cmd === 'get_filtered_genes') {
        return [mkGene('g1', 'I', 100, 10), mkGene('g2', 'I', 200, 20)];
      }
      return [];
    });

    const result = await interpolateGeneticLoc('I', 0);
    expect(result).toBeCloseTo(0, 5);
  });

  test('extrapolates using the two nearest anchors when physLoc is above the known range', async () => {
    mockIPC((cmd) => {
      if (cmd === 'get_filtered_genes') {
        return [mkGene('g1', 'I', 100, 10), mkGene('g2', 'I', 200, 20)];
      }
      return [];
    });

    const result = await interpolateGeneticLoc('I', 300);
    expect(result).toBeCloseTo(30, 5);
  });

  test('falls back to 50 when fewer than 2 anchors exist for the chromosome', async () => {
    mockIPC((cmd) => {
      if (cmd === 'get_filtered_genes') {
        return [mkGene('g1', 'I', 100, 10)];
      }
      return [];
    });

    const result = await interpolateGeneticLoc('I', 50);
    expect(result).toBe(50);
  });

  test('falls back to 50 when the chromosome has no anchors at all', async () => {
    mockIPC((cmd) => {
      if (cmd === 'get_filtered_genes') {
        return [mkGene('g1', 'II', 100, 10), mkGene('g2', 'II', 200, 20)];
      }
      return [];
    });

    const result = await interpolateGeneticLoc('I', 50);
    expect(result).toBe(50);
  });

  test('only builds the anchor cache once per session, reusing it across calls', async () => {
    let callCount = 0;
    mockIPC((cmd) => {
      if (cmd === 'get_filtered_genes') {
        callCount++;
        return [mkGene('g1', 'I', 0, 0), mkGene('g2', 'I', 100, 10)];
      }
      return [];
    });

    await interpolateGeneticLoc('I', 25);
    await interpolateGeneticLoc('I', 75);
    expect(callCount).toBe(1);
  });
});
