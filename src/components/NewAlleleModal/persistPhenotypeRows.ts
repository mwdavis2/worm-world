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

  // Pass 1 - every row's own Phenotype + AlleleExpression, so Pass 2's
  // cross-references within the same batch (e.g. Resistant-to-Drug's pair)
  // always resolve against phenotypes that already exist.
  for (const row of namedRows) {
    await findOrCreatePhenotype(row.name, row.isWildType, row.isLethal);
    await insertDbAlleleExpression({
      alleleName,
      expressingPhenotypeName: row.name,
      expressingPhenotypeWild: row.isWildType,
      dominance: zygosityToDominance(row.copyNumber),
    });
  }

  // Pass 2 - relations, only for rows that have one.
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
