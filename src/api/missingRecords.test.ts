// A lookup that finds nothing must fail with a clear message for the callers
// that need the record, and answer `undefined` only through the "find" versions.
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { getAllele } from 'api/allele';
import { findCondition, getCondition } from 'api/condition';
import { getCrossDesign } from 'api/crossDesign';
import { getGene } from 'api/gene';
import { findPhenotype, getPhenotype } from 'api/phenotype';
import { getStrain } from 'api/strain';
import { getVariation } from 'api/variation';
import {
  getSingleRecordOrThrow,
  getSingleRecordOrUndefined,
} from 'models/db/filter/FilterGroup';

afterEach(() => {
  clearMocks();
});

const nothingFound = (): void => {
  mockIPC((cmd) => {
    if (cmd.startsWith('get_filtered_')) return [];
  });
};

describe('getSingleRecordOrThrow', () => {
  test('returns the first record', () => {
    expect(getSingleRecordOrThrow(['a', 'b'])).toBe('a');
  });

  test('throws the given message when there is no record', () => {
    expect(() => {
      getSingleRecordOrThrow([], 'nothing here');
    }).toThrow('nothing here');
    expect(() => {
      getSingleRecordOrThrow([]);
    }).toThrow(/unable to get/);
  });
});

describe('getSingleRecordOrUndefined', () => {
  test('returns the first record, or undefined for none', () => {
    expect(getSingleRecordOrUndefined([1, 2])).toBe(1);
    expect(getSingleRecordOrUndefined<number>([])).toBeUndefined();
  });
});

describe('lookups that find nothing', () => {
  test.each([
    [
      'getAllele',
      async () => await getAllele('noSuch'),
      /alleles with the name: noSuch/,
    ],
    [
      'getGene',
      async () => await getGene('noSuch'),
      /genes with the name: noSuch/,
    ],
    [
      'getVariation',
      async () => await getVariation('noSuch'),
      /specified variation/,
    ],
    ['getStrain', async () => await getStrain('noSuch'), /specified strain/],
    [
      'getPhenotype',
      async () => await getPhenotype('noSuch', false),
      /phenotypes with the name: noSuch/,
    ],
    [
      'getCondition',
      async () => await getCondition('noSuch'),
      /condition with the name: noSuch/,
    ],
    [
      'getCrossDesign',
      async () => await getCrossDesign('noSuch'),
      /cross design with the id: noSuch/,
    ],
  ])('%s rejects with a clear message', async (_name, lookup, message) => {
    nothingFound();
    await expect(lookup()).rejects.toThrow(message);
  });

  test('findPhenotype and findCondition answer undefined instead', async () => {
    nothingFound();
    expect(await findPhenotype('noSuch', false)).toBeUndefined();
    expect(await findCondition('noSuch')).toBeUndefined();
  });

  test('the find versions return the record when there is one', async () => {
    mockIPC((cmd) => {
      if (cmd === 'get_filtered_phenotypes')
        return [{ name: 'Unc', wild: false }];
      if (cmd === 'get_filtered_conditions') return [{ name: '25C' }];
    });
    expect(await findPhenotype('Unc', false)).toEqual({
      name: 'Unc',
      wild: false,
    });
    expect(await findCondition('25C')).toEqual({ name: '25C' });
  });
});
