import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { type db_Phenotype } from 'models/db/db_Phenotype';
import { type PhenotypeRowState } from 'components/NewAlleleModal/newAlleleTypes';
import { persistPhenotypeRows } from 'components/NewAlleleModal/persistPhenotypeRows';

interface RecordedCall {
  cmd: string;
  payload: unknown;
}

const NOT_HANDLED = Symbol('not handled');

let calls: RecordedCall[];

const setupIPC = (
  overrides: (cmd: string, payload: unknown) => unknown = () => NOT_HANDLED
): void => {
  calls = [];
  mockIPC((cmd, payload) => {
    calls.push({ cmd, payload });
    const overridden = overrides(cmd, payload);
    if (overridden !== NOT_HANDLED) return overridden;
    switch (cmd) {
      case 'get_filtered_phenotypes':
        return [];
      case 'get_filtered_conditions':
        return [];
      default:
        return undefined;
    }
  });
};

afterEach(() => {
  clearMocks();
});

const baseRow = (overrides: Partial<PhenotypeRowState>): PhenotypeRowState => ({
  id: 'row-0',
  copyNumber: '2',
  name: 'Unc',
  isWildType: false,
  isLethal: false,
  relationshipText: '',
  ...overrides,
});

describe('persistPhenotypeRows', () => {
  test('skips rows with a blank Name entirely', async () => {
    setupIPC();
    await persistPhenotypeRows('ed3', [baseRow({ name: '' })]);
    expect(calls).toEqual([]);
  });

  test('creates a fresh Phenotype and AlleleExpression for a new row', async () => {
    setupIPC();
    await persistPhenotypeRows('ed3', [
      baseRow({
        name: 'Unc',
        isWildType: false,
        isLethal: true,
        copyNumber: '2',
      }),
    ]);

    const insertPhenotype = calls.find((c) => c.cmd === 'insert_phenotype');
    expect(insertPhenotype?.payload).toMatchObject({
      phenotype: {
        name: 'Unc',
        wild: false,
        shortName: 'Unc',
        lethal: true,
      },
    });

    const insertAlleleExpr = calls.find((c) => c.cmd === 'insert_allele_expr');
    expect(insertAlleleExpr?.payload).toMatchObject({
      alleleExpr: {
        alleleName: 'ed3',
        expressingPhenotypeName: 'Unc',
        expressingPhenotypeWild: false,
        dominance: 0, // '2' copies -> 0
      },
    });
  });

  test('reuses an existing matching Phenotype without a duplicate insert', async () => {
    setupIPC((cmd) => {
      if (cmd === 'get_filtered_phenotypes') {
        const existing: db_Phenotype = {
          name: 'Unc',
          wild: false,
          shortName: 'Unc',
          description: null,
          maleMating: null,
          lethal: true,
          femaleSterile: null,
          arrested: null,
          maturationDays: null,
        };
        return [existing];
      }
      return NOT_HANDLED;
    });

    await persistPhenotypeRows('ed3', [
      baseRow({ name: 'Unc', isWildType: false, isLethal: true }),
    ]);

    expect(calls.some((c) => c.cmd === 'insert_phenotype')).toBe(false);
    expect(calls.some((c) => c.cmd === 'insert_allele_expr')).toBe(true);
  });

  test('blocks with a clear error when an existing Phenotype has a conflicting lethal value', async () => {
    setupIPC((cmd) => {
      if (cmd === 'get_filtered_phenotypes') {
        const existing: db_Phenotype = {
          name: 'Unc',
          wild: false,
          shortName: 'Unc',
          description: null,
          maleMating: null,
          lethal: false,
          femaleSterile: null,
          arrested: null,
          maturationDays: null,
        };
        return [existing];
      }
      return NOT_HANDLED;
    });

    await expect(
      persistPhenotypeRows('ed3', [
        baseRow({ name: 'Unc', isWildType: false, isLethal: true }),
      ])
    ).rejects.toThrow(/already exists with lethal=false/);
  });

  test.each([
    ['suppressedByPhenotype', false, true],
    ['rescuedByWildTypePhenotype', true, true],
    ['requiresPhenotype', false, false],
    ['requiresWildTypePhenotype', true, false],
  ] as const)(
    '%s writes altering_phenotype_wild=%s and is_suppressing=%s',
    async (relationship, expectedWild, expectedSuppressing) => {
      setupIPC();
      await persistPhenotypeRows('ed3', [
        baseRow({
          name: 'Unc',
          relationship,
          relationshipText: 'unc-119(+)',
        }),
      ]);

      const insertRelation = calls.find(
        (c) => c.cmd === 'insert_expr_relation'
      );
      expect(insertRelation?.payload).toMatchObject({
        exprRelation: {
          alleleName: 'ed3',
          expressingPhenotypeName: 'Unc',
          alteringPhenotypeName: 'unc-119(+)',
          alteringPhenotypeWild: expectedWild,
          alteringCondition: null,
          isSuppressing: expectedSuppressing,
        },
      });

      // The altering phenotype itself gets found-or-created too.
      const insertedNames = calls
        .filter((c) => c.cmd === 'insert_phenotype')
        .map((c) => (c.payload as { phenotype: db_Phenotype }).phenotype.name);
      expect(insertedNames).toContain('unc-119(+)');
    }
  );

  test('finds-or-creates a Condition for the *Condition relationship variants', async () => {
    setupIPC();
    await persistPhenotypeRows('ed3', [
      baseRow({
        name: 'HygR',
        relationship: 'requiresCondition',
        relationshipText: 'Hyg',
      }),
    ]);

    const insertCondition = calls.find((c) => c.cmd === 'insert_condition');
    expect(insertCondition?.payload).toMatchObject({
      condition: { name: 'Hyg' },
    });

    const insertRelation = calls.find((c) => c.cmd === 'insert_expr_relation');
    expect(insertRelation?.payload).toMatchObject({
      exprRelation: {
        alteringPhenotypeName: null,
        alteringPhenotypeWild: null,
        alteringCondition: 'Hyg',
        isSuppressing: false,
      },
    });
  });

  test('does not write a relation at all when relationship is unset', async () => {
    setupIPC();
    await persistPhenotypeRows('ed3', [baseRow({ name: 'unc-119(+)' })]);
    expect(calls.some((c) => c.cmd === 'insert_expr_relation')).toBe(false);
  });
});
