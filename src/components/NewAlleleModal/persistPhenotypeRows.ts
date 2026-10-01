import { getPhenotype, insertDbPhenotype } from 'api/phenotype';
import { getCondition, insertDbCondition } from 'api/condition';
import { insertDbAlleleExpression } from 'api/alleleExpression';
import { insertDbExpressionRelation } from 'api/expressionRelation';
import { zygosityToDominance } from 'models/frontend/AlleleExpression/AlleleExpression';
import {
  type PhenotypeRelationship,
  type PhenotypeRowState,
} from 'components/NewAlleleModal/newAlleleTypes';

const isSuppressingRelationship = (
  relationship: PhenotypeRelationship
): boolean =>
  relationship === 'suppressedByPhenotype' ||
  relationship === 'rescuedByWildTypePhenotype' ||
  relationship === 'suppressedByCondition';

const isWildTypeRelationship = (relationship: PhenotypeRelationship): boolean =>
  relationship === 'rescuedByWildTypePhenotype' ||
  relationship === 'requiresWildTypePhenotype';

const isConditionRelationship = (
  relationship: PhenotypeRelationship
): boolean =>
  relationship === 'suppressedByCondition' ||
  relationship === 'requiresCondition';

// Which of the 4 independent AlleleExpression relation arrays a given
// relationship ultimately populates - a phenotype may have at most one row
// per category (one requires-condition, one suppressed-by-condition, one
// requires-phenotype, one suppressed-by-phenotype), even though it can
// freely combine one of each category together (e.g. a row both requiring
// a condition and suppressed by a phenotype).
type RelationCategory =
  | 'requiredConditions'
  | 'suppressingConditions'
  | 'requiredPhenotypes'
  | 'suppressingPhenotypes';

const categorize = (relationship: PhenotypeRelationship): RelationCategory => {
  switch (relationship) {
    case 'requiresCondition':
      return 'requiredConditions';
    case 'suppressedByCondition':
      return 'suppressingConditions';
    case 'requiresPhenotype':
    case 'requiresWildTypePhenotype':
      return 'requiredPhenotypes';
    case 'suppressedByPhenotype':
    case 'rescuedByWildTypePhenotype':
      return 'suppressingPhenotypes';
  }
};

const phenotypeKey = (name: string, wild: boolean): string =>
  `${name}\u0000${String(wild)}`;

// Finds an existing (name, wild) Phenotype row, or creates a minimal one.
// `lethal: null` means "this call has no lethal data to compare" (used for
// an *altering* phenotype, which the dialog never collects lethal for) -
// skip the conflict check entirely in that case. Otherwise, block with a
// clear error if an existing row's lethal value conflicts with what's being
// submitted, rather than silently overwriting or silently reusing mismatched
// data.
const findOrCreatePhenotype = async (
  name: string,
  wild: boolean,
  lethal: boolean | null
): Promise<void> => {
  // getPhenotype resolves to `undefined` (not a rejected promise) when no
  // matching row exists - see getSingleRecordOrThrow (FilterGroup.ts).
  const existing = await getPhenotype(name, wild);
  if (existing !== undefined) {
    if (lethal !== null && existing.lethal !== lethal) {
      throw new Error(
        `Phenotype "${name}" (${
          wild ? 'wild-type' : 'non-wild-type'
        }) already exists with lethal=${String(existing.lethal)}, which ` +
          'conflicts with this row - edit the existing Phenotypes entry ' +
          'directly if you need to change it.'
      );
    }
    return;
  }
  await insertDbPhenotype({
    name,
    wild,
    shortName: name,
    description: null,
    maleMating: null,
    lethal,
    femaleSterile: null,
    arrested: null,
    maturationDays: null,
  });
};

const findOrCreateCondition = async (name: string): Promise<void> => {
  const existing = await getCondition(name);
  if (existing !== undefined) return;
  await insertDbCondition({
    name,
    description: null,
    maleMating: null,
    lethal: null,
    femaleSterile: null,
    arrested: null,
    maturationDays: null,
  });
};

// Persists a New Allele dialog's Phenotype rows into phenotypes/allele_exprs/
// expr_relations. Rows with a blank Name are skipped (should already be
// filtered out upstream, but this is defensive rather than assumed).
export const persistPhenotypeRows = async (
  alleleName: string,
  rows: PhenotypeRowState[]
): Promise<void> => {
  const namedRows = rows.filter((row) => row.name !== '');

  // Pass 1 - every distinct (name, wild) phenotype's own Phenotype +
  // AlleleExpression, so Pass 2's cross-references within the same batch
  // (e.g. Resistant-to-Drug's pair) always resolve against phenotypes that
  // already exist. Multiple rows can target the same (name, wild) now (one
  // relation each, validated in Pass 2 below) - only the first is used to
  // create the Phenotype/AlleleExpression; later ones must agree with it on
  // copy number, or this is a genuine conflicting-data error.
  const seenPhenotypes = new Map<string, PhenotypeRowState>();
  for (const row of namedRows) {
    const key = phenotypeKey(row.name, row.isWildType);
    const first = seenPhenotypes.get(key);
    if (first !== undefined) {
      if (first.copyNumber !== row.copyNumber) {
        throw new Error(
          `Phenotype "${row.name}" (${
            row.isWildType ? 'wild-type' : 'non-wild-type'
          }) has conflicting copy numbers across its rows - ` +
            `"${first.copyNumber}" vs "${row.copyNumber}".`
        );
      }
      if (first.isLethal !== row.isLethal) {
        throw new Error(
          `Phenotype "${row.name}" (${
            row.isWildType ? 'wild-type' : 'non-wild-type'
          }) has conflicting Lethal values across its rows.`
        );
      }
      continue;
    }
    seenPhenotypes.set(key, row);
    await findOrCreatePhenotype(row.name, row.isWildType, row.isLethal);
    await insertDbAlleleExpression({
      alleleName,
      expressingPhenotypeName: row.name,
      expressingPhenotypeWild: row.isWildType,
      dominance: zygosityToDominance(row.copyNumber),
    });
  }

  // Pass 2 - relations, only for rows that have one. A phenotype may
  // combine at most one row per relation category (one requires-condition,
  // one suppressed-by-condition, one requires-phenotype, one
  // suppressed-by-phenotype) - reject a second row in the same category
  // before writing anything, rather than silently persisting a duplicate.
  const seenCategories = new Set<string>();
  for (const row of namedRows) {
    if (row.relationship === undefined) continue;
    const category = categorize(row.relationship);
    const categoryKey = `${phenotypeKey(
      row.name,
      row.isWildType
    )}\u0000${category}`;
    if (seenCategories.has(categoryKey)) {
      throw new Error(
        `Phenotype "${row.name}" (${
          row.isWildType ? 'wild-type' : 'non-wild-type'
        }) has more than one "${category}" relation - only one of each ` +
          'relation category is allowed per phenotype.'
      );
    }
    seenCategories.add(categoryKey);
  }
  for (const row of namedRows) {
    if (row.relationship === undefined) continue;
    const isSuppressing = isSuppressingRelationship(row.relationship);
    if (isConditionRelationship(row.relationship)) {
      await findOrCreateCondition(row.relationshipText);
      await insertDbExpressionRelation({
        alleleName,
        expressingPhenotypeName: row.name,
        expressingPhenotypeWild: row.isWildType,
        alteringPhenotypeName: null,
        alteringPhenotypeWild: null,
        alteringCondition: row.relationshipText,
        isSuppressing,
      });
    } else {
      const alteringWild = isWildTypeRelationship(row.relationship);
      await findOrCreatePhenotype(row.relationshipText, alteringWild, null);
      await insertDbExpressionRelation({
        alleleName,
        expressingPhenotypeName: row.name,
        expressingPhenotypeWild: row.isWildType,
        alteringPhenotypeName: row.relationshipText,
        alteringPhenotypeWild: alteringWild,
        alteringCondition: null,
        isSuppressing,
      });
    }
  }
};
