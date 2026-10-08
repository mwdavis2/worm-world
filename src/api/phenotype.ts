import { invoke } from '@tauri-apps/api/tauri';
import { type db_TableImport } from 'models/db/db_TableImport';
import { type db_Phenotype } from 'models/db/db_Phenotype';
import { type ExpressionRelationFieldName } from 'models/db/filter/db_ExpressionRelationFieldName';
import { type PhenotypeFieldName } from 'models/db/filter/db_PhenotypeFieldName';
import {
  type FilterGroup,
  getDbBoolean,
  getSingleRecordOrThrow,
  getSingleRecordOrUndefined,
} from 'models/db/filter/FilterGroup';
import { type Phenotype } from 'models/frontend/Phenotype/Phenotype';

export const getPhenotypes = async (): Promise<db_Phenotype[]> => {
  return await invoke('get_phenotypes');
};

export const getFilteredPhenotypes = async (
  filter: FilterGroup<PhenotypeFieldName>
): Promise<db_Phenotype[]> => {
  return await invoke('get_filtered_phenotypes', {
    filter,
  });
};

export const getCountFilteredPhenotypes = async (
  filter: FilterGroup<PhenotypeFieldName>
): Promise<number> => {
  return await invoke('get_count_filtered_phenotypes', {
    filter,
  });
};

const phenotypeFilter = (
  name: string,
  wild: boolean
): FilterGroup<PhenotypeFieldName> => ({
  filters: [[['Name', { Equal: name }]], [['Wild', getDbBoolean(wild)]]],
  orderBy: [],
});

/** The (name, wild) phenotype; throws if there is none. */
export const getPhenotype = async (
  name: string,
  wild: boolean
): Promise<db_Phenotype> => {
  const res = await getFilteredPhenotypes(phenotypeFilter(name, wild));
  return getSingleRecordOrThrow(
    res,
    `Unable to find any phenotypes with the name: ${name} and wild: ${wild}`
  );
};

/** The (name, wild) phenotype, or `undefined` if there is none. */
export const findPhenotype = async (
  name: string,
  wild: boolean
): Promise<db_Phenotype | undefined> => {
  return getSingleRecordOrUndefined(
    await getFilteredPhenotypes(phenotypeFilter(name, wild))
  );
};

export const getAlteringPhenotypes = async (
  alleleName: string,
  phenotypeName: string,
  phenotypeWild: boolean,
  isSuppressing: boolean
): Promise<db_Phenotype[]> => {
  const exprRelationFilter: FilterGroup<ExpressionRelationFieldName> = {
    filters: [
      [['AlleleName', { Equal: alleleName }]],
      [['ExpressingPhenotypeName', { Equal: phenotypeName }]],
      [['ExpressingPhenotypeWild', getDbBoolean(phenotypeWild)]],
      [['IsSuppressing', getDbBoolean(isSuppressing)]],
    ],
    orderBy: [],
  };
  const phenotypeFilter: FilterGroup<PhenotypeFieldName> = {
    filters: [],
    orderBy: [],
  };

  return await invoke('get_altering_phenotypes', {
    exprRelationFilter,
    phenotypeFilter,
  });
};

export const insertPhenotype = async (phenotype: Phenotype): Promise<void> => {
  await insertDbPhenotype(phenotype.generateRecord());
};

export const insertDbPhenotype = async (
  record: db_Phenotype
): Promise<void> => {
  await invoke('insert_phenotype', { phenotype: record });
};

// Changes a phenotype's non-key columns; its name and wild flag pick the row.
export const updateDbPhenotype = async (
  record: db_Phenotype
): Promise<void> => {
  await invoke('update_phenotype', { phenotype: record });
};

/**
 * Imports a CSV/TSV file into this table in one transaction. Rows already in
 * the table are kept as they are; the result says how many rows the file held
 * and how many were new.
 */
export const insertPhenotypesFromFile = async (
  path: string
): Promise<db_TableImport> => {
  return await invoke('insert_phenotypes_from_file', { path });
};

export const deleteFilteredPhenotypes = async (
  filter: FilterGroup<PhenotypeFieldName>
): Promise<void> => {
  await invoke('delete_filtered_phenotypes', { filter });
};

export const deletePhenotype = async (
  phenotype: db_Phenotype
): Promise<void> => {
  const filter: FilterGroup<PhenotypeFieldName> = {
    filters: [
      [['Name', { Equal: phenotype.name }]],
      [['Wild', getDbBoolean(phenotype.wild)]],
    ],
    orderBy: [],
  };

  await deleteFilteredPhenotypes(filter);
};

export const getUnusedPhenotypeKeys = async (): Promise<
  Array<[string, boolean]>
> => {
  return await invoke('get_unused_phenotype_keys');
};
