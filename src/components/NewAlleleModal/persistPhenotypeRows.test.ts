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
          maleCrossingDefective: null,
          femaleCrossingDefective: null,
          selfCrossingDefective: null,
          him: null,
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
          maleCrossingDefective: null,
          femaleCrossingDefective: null,
          selfCrossingDefective: null,
          him: null,
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

  test.each([
    ['suppressedByMaternalPhenotype', false, true],
    ['rescuedByMaternalWildTypePhenotype', true, true],
    ['requiresMaternalPhenotype', false, false],
    ['requiresMaternalWildTypePhenotype', true, false],
  ] as const)(
    '%s writes a maternal relation with altering_phenotype_wild=%s and is_suppressing=%s',
    async (relationship, expectedWild, expectedSuppressing) => {
      setupIPC();
      await persistPhenotypeRows('ed3', [
        baseRow({ name: 'Unc', relationship, relationshipText: 'unc-119(+)' }),
      ]);
      const insertRelation = calls.find(
        (c) => c.cmd === 'insert_expr_relation'
      );
      expect(insertRelation?.payload).toMatchObject({
        exprRelation: {
          alteringPhenotypeName: 'unc-119(+)',
          alteringPhenotypeWild: expectedWild,
          isSuppressing: expectedSuppressing,
          alteringPhenotypeMaternal: true,
        },
      });
    }
  );

  test('a zygotic and a maternal relation of the same kind may both be on one phenotype', async () => {
    setupIPC();
    await persistPhenotypeRows('ed3', [
      baseRow({
        name: 'Unc',
        relationship: 'suppressedByPhenotype',
        relationshipText: 'A',
      }),
      baseRow({
        id: 'row-2',
        name: 'Unc',
        relationship: 'suppressedByMaternalPhenotype',
        relationshipText: 'B',
      }),
    ]);
    const relations = calls.filter((c) => c.cmd === 'insert_expr_relation');
    expect(relations).toHaveLength(2);
    expect(
      relations.map(
        (c) =>
          (
            c.payload as {
              exprRelation: { alteringPhenotypeMaternal: boolean };
            }
          ).exprRelation.alteringPhenotypeMaternal
      )
    ).toEqual([false, true]);
  });

  test('several relationships of one kind are allowed when they name different things', async () => {
    setupIPC();
    await persistPhenotypeRows('ed3', [
      baseRow({
        name: 'Unc',
        relationship: 'suppressedByPhenotype',
        relationshipText: 'A',
      }),
      baseRow({
        id: 'row-2',
        name: 'Unc',
        relationship: 'suppressedByPhenotype',
        relationshipText: 'B',
      }),
      baseRow({
        id: 'row-3',
        name: 'Unc',
        relationship: 'rescuedByWildTypePhenotype',
        relationshipText: 'A',
      }),
    ]);
    expect(calls.filter((c) => c.cmd === 'insert_expr_relation')).toHaveLength(
      3
    );
  });

  test('an exact repeat of a relationship is rejected', async () => {
    setupIPC();
    await expect(
      persistPhenotypeRows('ed3', [
        baseRow({
          name: 'Unc',
          relationship: 'requiresMaternalPhenotype',
          relationshipText: 'A',
        }),
        baseRow({
          id: 'row-2',
          name: 'Unc',
          relationship: 'requiresMaternalPhenotype',
          relationshipText: 'A',
        }),
      ])
    ).rejects.toThrow(/same relationship/);
    expect(calls.filter((c) => c.cmd === 'insert_expr_relation')).toHaveLength(
      0
    );
  });

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

  describe('crossing effects', () => {
    const existingPhenotype = (
      overrides: Partial<db_Phenotype>
    ): db_Phenotype => ({
      name: 'Unc',
      wild: false,
      shortName: 'Unc',
      description: null,
      maleMating: null,
      lethal: false,
      maleCrossingDefective: null,
      femaleCrossingDefective: null,
      selfCrossingDefective: null,
      him: null,
      arrested: null,
      maturationDays: null,
      ...overrides,
    });

    test('ticked effects are saved on a new Phenotype, the rest as off', async () => {
      setupIPC();
      await persistPhenotypeRows('ed3', [
        baseRow({ femaleCrossingDefective: true, him: true }),
      ]);
      const insert = calls.find((c) => c.cmd === 'insert_phenotype');
      expect(insert?.payload).toMatchObject({
        phenotype: {
          maleCrossingDefective: false,
          femaleCrossingDefective: true,
          selfCrossingDefective: false,
          him: true,
        },
      });
    });

    test('an existing Phenotype with blank effects matches a row with none ticked', async () => {
      setupIPC((cmd) =>
        cmd === 'get_filtered_phenotypes'
          ? [existingPhenotype({})]
          : NOT_HANDLED
      );
      await persistPhenotypeRows('ed3', [baseRow({})]);
      expect(calls.some((c) => c.cmd === 'insert_phenotype')).toBe(false);
      expect(calls.some((c) => c.cmd === 'insert_allele_expr')).toBe(true);
    });

    test('a ticked effect the existing Phenotype does not have is a clear conflict', async () => {
      setupIPC((cmd) =>
        cmd === 'get_filtered_phenotypes'
          ? [existingPhenotype({})]
          : NOT_HANDLED
      );
      await expect(
        persistPhenotypeRows('ed3', [baseRow({ selfCrossingDefective: true })])
      ).rejects.toThrow(/Self crossing defective/);
    });

    test('rows of one phenotype that disagree on an effect are refused', async () => {
      setupIPC();
      await expect(
        persistPhenotypeRows('ed3', [
          baseRow({ id: 'a', relationshipText: '' }),
          baseRow({ id: 'b', him: true }),
        ])
      ).rejects.toThrow(/conflicting "Him/);
    });
  });

  describe('a relationship with no text', () => {
    test('writes no relation and creates no phenotype named blank', async () => {
      setupIPC();
      await persistPhenotypeRows('ed3', [
        baseRow({
          name: 'ZzAdv',
          relationship: 'suppressedByPhenotype',
          relationshipText: '',
        }),
      ]);
      // the row's own phenotype and expression are saved
      expect(
        calls.filter((c) => c.cmd === 'insert_phenotype').map((c) => c.payload)
      ).toEqual([
        expect.objectContaining({
          phenotype: expect.objectContaining({ name: 'ZzAdv' }),
        }),
      ]);
      expect(calls.some((c) => c.cmd === 'insert_allele_expr')).toBe(true);
      // ...but no relation and nothing named ''
      expect(calls.some((c) => c.cmd === 'insert_expr_relation')).toBe(false);
      expect(
        calls.some(
          (c) =>
            c.cmd === 'insert_phenotype' &&
            (c.payload as { phenotype: { name: string } }).phenotype.name === ''
        )
      ).toBe(false);
    });

    test('a condition relationship with no text creates no condition named blank', async () => {
      setupIPC();
      await persistPhenotypeRows('ed3', [
        baseRow({
          name: 'ZzAdv',
          relationship: 'requiresCondition',
          relationshipText: '   ',
        }),
      ]);
      expect(calls.some((c) => c.cmd === 'insert_expr_relation')).toBe(false);
      expect(calls.some((c) => c.cmd === 'insert_condition')).toBe(false);
    });

    test('a relationship with text is still written', async () => {
      setupIPC();
      await persistPhenotypeRows('ed3', [
        baseRow({
          name: 'ZzAdv',
          relationship: 'suppressedByPhenotype',
          relationshipText: 'Other',
        }),
      ]);
      expect(calls.some((c) => c.cmd === 'insert_expr_relation')).toBe(true);
    });
  });
});

describe('phenotype names are matched without regard to case', () => {
  const existing = (name: string, wild: boolean): db_Phenotype => ({
    name,
    wild,
    shortName: name,
    description: null,
    maleMating: null,
    lethal: wild ? null : false,
    maleCrossingDefective: null,
    femaleCrossingDefective: null,
    selfCrossingDefective: null,
    him: null,
    arrested: null,
    maturationDays: null,
  });

  test('a row typed in another case is saved under the existing spelling, with no new phenotype', async () => {
    // the database holds the wild phenotype "Unc-119"
    setupIPC((cmd, payload) => {
      if (cmd !== 'get_filtered_phenotypes') return NOT_HANDLED;
      const text = JSON.stringify(payload).toLowerCase();
      return text.includes('unc-119') ? [existing('Unc-119', true)] : [];
    });
    await persistPhenotypeRows('oxTi1', [
      baseRow({
        name: 'unc-119',
        isWildType: true,
        copyNumber: '1or2',
        isLethal: false,
      }),
    ]);
    expect(calls.some((c) => c.cmd === 'insert_phenotype')).toBe(false);
    const expr = calls.find((c) => c.cmd === 'insert_allele_expr');
    expect(expr?.payload).toMatchObject({
      alleleExpr: {
        alleleName: 'oxTi1',
        expressingPhenotypeName: 'Unc-119',
        expressingPhenotypeWild: true,
      },
    });
  });

  test("a relationship's phenotype text is respelled the same way", async () => {
    setupIPC((cmd, payload) => {
      if (cmd !== 'get_filtered_phenotypes') return NOT_HANDLED;
      const text = JSON.stringify(payload).toLowerCase();
      return text.includes('unc-119') ? [existing('Unc-119', true)] : [];
    });
    await persistPhenotypeRows('ed9', [
      baseRow({
        name: 'Unc-9',
        relationship: 'rescuedByWildTypePhenotype',
        relationshipText: 'unc-119',
      }),
    ]);
    const relation = calls.find((c) => c.cmd === 'insert_expr_relation');
    expect(relation?.payload).toMatchObject({
      exprRelation: {
        alteringPhenotypeName: 'Unc-119',
        alteringPhenotypeWild: true,
      },
    });
  });

  test('two rows of one batch that differ in case share the first spelling', async () => {
    setupIPC();
    await persistPhenotypeRows('x1', [
      baseRow({ id: 'a', name: 'Foo', isWildType: true }),
      baseRow({ id: 'b', name: 'foo', isWildType: true }),
    ]);
    const inserted = calls
      .filter((c) => c.cmd === 'insert_phenotype')
      .map(
        (c) => (c.payload as { phenotype: { name: string } }).phenotype.name
      );
    expect(inserted).toEqual(['Foo']);
  });
});
