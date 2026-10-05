import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, describe, expect, test } from 'vitest';
import { type db_ExpressionRelation } from 'models/db/db_ExpressionRelation';
import { deleteExpressionRelation } from './expressionRelation';

const sentFilter = async (row: db_ExpressionRelation): Promise<unknown> => {
  let filter: unknown;
  mockIPC((cmd, args) => {
    if (cmd === 'delete_filtered_expr_relations')
      filter = (args as { filter: unknown }).filter;
  });
  await deleteExpressionRelation(row);
  return filter;
};

const base: db_ExpressionRelation = {
  alleleName: 'eT1(III)',
  expressingPhenotypeName: 'translocation aneuploid (het)',
  expressingPhenotypeWild: false,
  alteringPhenotypeName: 'eT1(V) 1 copy',
  alteringPhenotypeWild: true,
  alteringCondition: null,
  isSuppressing: true,
};

describe('deleteExpressionRelation', () => {
  afterEach(() => {
    clearMocks();
  });

  // Regression: NULL columns were matched with "= ''" (never true) and the
  // altering phenotype's wild flag was read from the expressing phenotype, so
  // a row could not be deleted.
  test('a phenotype-based relationship matches its empty condition with a NULL test', async () => {
    expect(await sentFilter(base)).toEqual({
      filters: [
        [['AlleleName', { Equal: 'eT1(III)' }]],
        [
          [
            'ExpressingPhenotypeName',
            { Equal: 'translocation aneuploid (het)' },
          ],
        ],
        [['ExpressingPhenotypeWild', 'False']],
        [['AlteringPhenotypeName', { Equal: 'eT1(V) 1 copy' }]],
        // The altering phenotype's own wild flag (true), not the expressing
        // phenotype's (false).
        [['AlteringPhenotypeWild', 'True']],
        [['AlteringCondition', 'Null']],
      ],
      orderBy: [],
    });
  });

  test('a condition-based relationship matches its empty phenotype columns with NULL tests', async () => {
    const filter = (await sentFilter({
      ...base,
      alteringPhenotypeName: null,
      alteringPhenotypeWild: null,
      alteringCondition: '25C',
    })) as { filters: unknown[] };
    expect(filter.filters.slice(3)).toEqual([
      [['AlteringPhenotypeName', 'Null']],
      [['AlteringPhenotypeWild', 'Null']],
      [['AlteringCondition', { Equal: '25C' }]],
    ]);
  });
});
