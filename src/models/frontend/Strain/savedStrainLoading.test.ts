// Loading saved strains from the database: a compound heterozygote saved as two
// strain-allele rows loads as one pair, and a saved strain that cannot be
// loaded does not stop a new strain from being named.
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Allele } from 'models/frontend/Allele/Allele';
import { ed3 } from 'models/frontend/Allele/Allele.mock';
import { Strain } from 'models/frontend/Strain/Strain';

const ed4 = new Allele({ ...ed3, name: 'ed4' });

interface SavedRow {
  strainName: string;
  alleleName: string;
  isOnTop: boolean;
  isOnBot: boolean;
}

// a stand-in database: two alleles of one gene and three saved strains
const ROWS: SavedRow[] = [
  // a compound heterozygote: ed3 over ed4
  { strainName: 'CH', alleleName: 'ed3', isOnTop: true, isOnBot: false },
  { strainName: 'CH', alleleName: 'ed4', isOnTop: false, isOnBot: true },
  // a malformed strain: two different alleles of one gene, both homozygous
  { strainName: 'BAD', alleleName: 'ed3', isOnTop: true, isOnBot: true },
  { strainName: 'BAD', alleleName: 'ed4', isOnTop: true, isOnBot: true },
  // an ordinary strain
  { strainName: 'EG3', alleleName: 'ed3', isOnTop: true, isOnBot: true },
];
const STRAINS = ['CH', 'BAD', 'EG3'];

interface Filter {
  filters: Array<Array<[string, { Equal: string }]>>;
}
const equalsOf = (payload: unknown, field: string): string[] =>
  (payload as { filter: Filter }).filter.filters
    .flat()
    .filter(([name]) => name === field)
    .map(([, value]) => value.Equal);

const setupDatabase = (): void => {
  mockIPC((cmd, payload) => {
    switch (cmd) {
      case 'get_filtered_strain_alleles': {
        const strains = equalsOf(payload, 'StrainName');
        const alleles = equalsOf(payload, 'AlleleName');
        return ROWS.filter(
          (row) =>
            (strains.length === 0 || strains.includes(row.strainName)) &&
            (alleles.length === 0 || alleles.includes(row.alleleName))
        );
      }
      case 'get_filtered_strains':
        return equalsOf(payload, 'Name')
          .filter((name) => STRAINS.includes(name))
          .map((name) => ({ name, genotype: '', description: null }));
      case 'get_filtered_alleles':
        return equalsOf(payload, 'Name').map((name) => ({
          name,
          contents: null,
          sysGeneName: 'M142.1',
          variationName: null,
        }));
      case 'get_filtered_genes':
        return [
          {
            sysName: 'M142.1',
            descName: 'unc-119',
            chromosome: 'III',
            physLoc: 10902641,
            geneticLoc: 5.59,
          },
        ];
      case 'get_filtered_allele_exprs':
        return [];
    }
  });
};

beforeEach(setupDatabase);
afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

describe('Strain.createFromRecord', () => {
  test('loads a compound heterozygote saved as two rows as one pair', async () => {
    const strain = await Strain.createFromRecord({
      name: 'CH',
      genotype: '',
      description: null,
    });
    const pairs = strain.getAllelePairs();
    expect(pairs).toHaveLength(1);
    expect(pairs[0].top.name).toBe('ed3');
    expect(pairs[0].bot.name).toBe('ed4');
  });

  test('a strain that cannot be a single pair of one gene still fails to load', async () => {
    await expect(
      Strain.createFromRecord({ name: 'BAD', genotype: '', description: null })
    ).rejects.toThrow(/exactly one non-wild allele/);
  });
});

describe('naming a new strain', () => {
  test('skips a saved strain that cannot be loaded, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // shares ed3 and ed4 with the malformed strain BAD
    const strain = new Strain({
      allelePairs: [ed3.toTopHet().merge(ed4.toBotHet())],
    });

    await expect(strain.syncFromDb()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"BAD"'));
  });

  test('still names the strain after the loadable saved strain it matches', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const strain = new Strain({
      allelePairs: [ed3.toTopHet().merge(ed4.toBotHet())],
    });
    await strain.syncFromDb();
    // CH (ed3 over ed4) is the matching saved strain even though BAD failed
    expect(strain.name).toBe('CH');
  });
});
