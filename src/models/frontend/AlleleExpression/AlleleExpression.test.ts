import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { AlleleExpression } from 'models/frontend/AlleleExpression/AlleleExpression';
import { cond25C } from 'models/frontend/Condition/Condition.mock';
import {
  phenLin15B,
  phenUnc119,
} from 'models/frontend/Phenotype/Phenotype.mock';
import { type db_AlleleExpression } from 'models/db/db_AlleleExpression';
import { type FilterGroup } from 'models/db/filter/FilterGroup';
import { expect, test, describe, afterEach } from 'vitest';

afterEach(() => {
  clearMocks();
});

describe('AlleleExpression', () => {
  test('should be able to serialize and deserialize', () => {
    const alleleExpr = new AlleleExpression({
      alleleName: 'alleleExpr',
      expressingPhenotype: phenUnc119,
      requiredPhenotypes: [phenLin15B],
      suppressingPhenotypes: [],
      requiredConditions: [cond25C],
      suppressingConditions: [],
      dominance: '1',
    });
    const str = alleleExpr.toJSON();
    const alleleExprBack = AlleleExpression.fromJSON(str);
    expect(alleleExprBack.toJSON()).toEqual(str);
  });

  // Regression test for a bug where createFromRecord queried
  // get_altering_conditions/get_altering_phenotypes with the isSuppressing
  // argument backwards, so every real DB-loaded allele had its required and
  // suppressing conditions/phenotypes swapped (is_suppressing=0 in the DB
  // means "required", per the expr_relations schema comment).
  test('createFromRecord assigns required vs suppressing conditions/phenotypes correctly, not swapped', async () => {
    const isSuppressingValue = (filter: FilterGroup<unknown>): string => {
      const tuple = filter.filters
        .flat()
        .find(([field]) => field === 'IsSuppressing');
      return tuple?.[1] as unknown as string;
    };

    mockIPC((cmd, rawPayload) => {
      const payload = rawPayload as {
        exprRelationFilter: FilterGroup<unknown>;
        phenotypeFilter?: unknown;
        conditionFilter?: unknown;
        filter?: FilterGroup<unknown>;
      };
      switch (cmd) {
        case 'get_altering_conditions':
          return isSuppressingValue(payload.exprRelationFilter) === 'False'
            ? [
                {
                  name: 'ActuallyRequiredCondition',
                  description: null,
                  maleMating: null,
                  lethal: null,
                  femaleSterile: null,
                  arrested: null,
                  maturationDays: null,
                },
              ]
            : [
                {
                  name: 'ActuallySuppressingCondition',
                  description: null,
                  maleMating: null,
                  lethal: null,
                  femaleSterile: null,
                  arrested: null,
                  maturationDays: null,
                },
              ];
        case 'get_altering_phenotypes':
          return isSuppressingValue(payload.exprRelationFilter) === 'False'
            ? [
                {
                  name: 'ActuallyRequiredPhenotype',
                  wild: false,
                  shortName: 'req',
                  description: null,
                  maleMating: null,
                  lethal: null,
                  femaleSterile: null,
                  arrested: null,
                  maturationDays: null,
                },
              ]
            : [
                {
                  name: 'ActuallySuppressingPhenotype',
                  wild: false,
                  shortName: 'sup',
                  description: null,
                  maleMating: null,
                  lethal: null,
                  femaleSterile: null,
                  arrested: null,
                  maturationDays: null,
                },
              ];
        case 'get_filtered_phenotypes':
          return [
            {
              name: 'unc-119',
              wild: false,
              shortName: 'unc-119',
              description: null,
              maleMating: null,
              lethal: null,
              femaleSterile: null,
              arrested: null,
              maturationDays: null,
            },
          ];
        default:
          return undefined;
      }
    });

    const record: db_AlleleExpression = {
      alleleName: 'ed3',
      expressingPhenotypeName: 'unc-119',
      expressingPhenotypeWild: false,
      dominance: 0,
    };
    const alleleExpr = await AlleleExpression.createFromRecord(record);

    expect(alleleExpr.requiredConditions.map((c) => c.name)).toEqual([
      'ActuallyRequiredCondition',
    ]);
    expect(alleleExpr.suppressingConditions.map((c) => c.name)).toEqual([
      'ActuallySuppressingCondition',
    ]);
    expect(alleleExpr.requiredPhenotypes.map((p) => p.name)).toEqual([
      'ActuallyRequiredPhenotype',
    ]);
    expect(alleleExpr.suppressingPhenotypes.map((p) => p.name)).toEqual([
      'ActuallySuppressingPhenotype',
    ]);
  });
});
