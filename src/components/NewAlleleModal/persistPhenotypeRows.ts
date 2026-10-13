import { findPhenotype, insertDbPhenotype } from 'api/phenotype';
import { findCondition, insertDbCondition } from 'api/condition';
import { insertDbAlleleExpression } from 'api/alleleExpression';
import { insertDbExpressionRelation } from 'api/expressionRelation';
import { zygosityToDominance } from 'models/frontend/AlleleExpression/AlleleExpression';
import {
  CROSSING_EFFECT_OPTIONS,
  crossingEffectsOf,
  type CrossingEffects,
  type PhenotypeRelationship,
  type PhenotypeRowState,
} from 'components/NewAlleleModal/newAlleleTypes';

const isSuppressingRelationship = (
  relationship: PhenotypeRelationship
): boolean =>
  relationship === 'suppressedByPhenotype' ||
  relationship === 'rescuedByWildTypePhenotype' ||
  relationship === 'suppressedByMaternalPhenotype' ||
  relationship === 'rescuedByMaternalWildTypePhenotype' ||
  relationship === 'suppressedByCondition';

const isWildTypeRelationship = (relationship: PhenotypeRelationship): boolean =>
  relationship === 'rescuedByWildTypePhenotype' ||
  relationship === 'requiresWildTypePhenotype' ||
  relationship === 'rescuedByMaternalWildTypePhenotype' ||
  relationship === 'requiresMaternalWildTypePhenotype';

// The altering phenotype is the hermaphrodite mother's, not the animal's own.
const isMaternalRelationship = (relationship: PhenotypeRelationship): boolean =>
  relationship === 'suppressedByMaternalPhenotype' ||
  relationship === 'rescuedByMaternalWildTypePhenotype' ||
  relationship === 'requiresMaternalPhenotype' ||
  relationship === 'requiresMaternalWildTypePhenotype';

const isConditionRelationship = (
  relationship: PhenotypeRelationship
): boolean =>
  relationship === 'suppressedByCondition' ||
  relationship === 'requiresCondition';

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
  lethal: boolean | null,
  effects: CrossingEffects | null = null
): Promise<void> => {
  // findPhenotype resolves to `undefined` (not a rejected promise) when no
  // matching row exists.
  const existing = await findPhenotype(name, wild);
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
    // A flag the existing row does not have (blank counts as off) cannot be
    // set from here either, for the same reason as lethal
    const clash = CROSSING_EFFECT_OPTIONS.find(
      ({ key }) => effects !== null && (existing[key] ?? false) !== effects[key]
    );
    if (clash !== undefined) {
      throw new Error(
        `Phenotype "${name}" (${
          wild ? 'wild-type' : 'non-wild-type'
        }) already exists with a different "${clash.label}" setting, which ` +
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
    maleCrossingDefective: effects?.maleCrossingDefective ?? null,
    femaleCrossingDefective: effects?.femaleCrossingDefective ?? null,
    selfCrossingDefective: effects?.selfCrossingDefective ?? null,
    him: effects?.him ?? null,
    arrested: null,
    maturationDays: null,
  });
};

const findOrCreateCondition = async (name: string): Promise<void> => {
  const existing = await findCondition(name);
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
      const firstEffects = crossingEffectsOf(first);
      const rowEffects = crossingEffectsOf(row);
      const differing = CROSSING_EFFECT_OPTIONS.find(
        ({ key }) => firstEffects[key] !== rowEffects[key]
      );
      if (differing !== undefined) {
        throw new Error(
          `Phenotype "${row.name}" (${
            row.isWildType ? 'wild-type' : 'non-wild-type'
          }) has conflicting "${differing.label}" values across its rows.`
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
    await findOrCreatePhenotype(
      row.name,
      row.isWildType,
      row.isLethal,
      crossingEffectsOf(row)
    );
    await insertDbAlleleExpression({
      alleleName,
      expressingPhenotypeName: row.name,
      expressingPhenotypeWild: row.isWildType,
      dominance: zygosityToDominance(row.copyNumber),
    });
  }

  // Pass 2 - relations, only for rows that have one. A phenotype may have any
  // number of relations; reject only an exact repeat of one (same kind, same
  // condition or altering phenotype) before writing anything, rather than
  // silently persisting a duplicate.
  const seenRelations = new Set<string>();
  // A relationship with no text names nothing to relate to (the Advanced view's
  // default row has one selected and blank): there is no relation to write, and
  // no phenotype or condition named '' to create.
  const hasRelation = (row: PhenotypeRowState): boolean =>
    row.relationship !== undefined && row.relationshipText.trim() !== '';
  for (const row of namedRows) {
    if (!hasRelation(row) || row.relationship === undefined) continue;
    const target = isConditionRelationship(row.relationship)
      ? `condition\u0000${row.relationshipText}`
      : `phenotype\u0000${row.relationshipText}\u0000${String(
          isWildTypeRelationship(row.relationship)
        )}`;
    const relationKey = [
      phenotypeKey(row.name, row.isWildType),
      String(isSuppressingRelationship(row.relationship)),
      String(isMaternalRelationship(row.relationship)),
      target,
    ].join('\u0000');
    if (seenRelations.has(relationKey)) {
      throw new Error(
        `Phenotype "${row.name}" (${
          row.isWildType ? 'wild-type' : 'non-wild-type'
        }) has the same relationship to "${row.relationshipText}" more ` +
          'than once - remove the repeated row.'
      );
    }
    seenRelations.add(relationKey);
  }
  for (const row of namedRows) {
    if (!hasRelation(row) || row.relationship === undefined) continue;
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
        alteringPhenotypeMaternal: false,
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
        alteringPhenotypeMaternal: isMaternalRelationship(row.relationship),
      });
    }
  }
};
