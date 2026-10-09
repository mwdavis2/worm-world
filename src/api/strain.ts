import { invoke } from '@tauri-apps/api/tauri';
import { type db_TableImport } from 'models/db/db_TableImport';
import { type db_Strain } from 'models/db/db_Strain';
import { type db_StrainAllele } from 'models/db/db_StrainAllele';
import { type StrainFieldName } from 'models/db/filter/db_StrainFieldName';
import {
  type FilterGroup,
  getSingleRecordOrThrow,
} from 'models/db/filter/FilterGroup';
import { type Strain } from 'models/frontend/Strain/Strain';

export const getStrains = async (): Promise<db_Strain[]> => {
  return await invoke('get_strains');
};

export const getFilteredStrains = async (
  filter: FilterGroup<StrainFieldName>
): Promise<db_Strain[]> => {
  return await invoke('get_filtered_strains', {
    filter,
  });
};

export const getCountFilteredStrains = async (
  filter: FilterGroup<StrainFieldName>
): Promise<number> => {
  return await invoke('get_count_filtered_strains', {
    filter,
  });
};

export const getStrain = async (name: string): Promise<db_Strain> => {
  const filter: FilterGroup<StrainFieldName> = {
    filters: [[['Name', { Equal: name }]]],
    orderBy: [],
  };
  const res = await getFilteredStrains(filter);
  return getSingleRecordOrThrow(res, 'Unable to get specified strain');
};

export const insertStrain = async (strain: Strain): Promise<void> => {
  await insertDbStrain(strain.generateRecord());
};

export const insertDbStrain = async (record: db_Strain): Promise<void> => {
  await invoke('insert_strain', { strain: record });
};

/**
 * Imports a CSV/TSV file into this table in one transaction. Rows already in
 * the table are kept as they are; the result says how many rows the file held
 * and how many were new.
 */
export const insertStrainsFromFile = async (
  path: string
): Promise<db_TableImport> => {
  return await invoke('insert_strains_from_file', { path });
};

export const updateStrain = async (
  name: string,
  newStrain: db_Strain
): Promise<void> => {
  await invoke('update_strain', { name, newStrain });
};

export const deleteFilteredStrains = async (
  filter: FilterGroup<StrainFieldName>
): Promise<void> => {
  await invoke('delete_filtered_strains', { filter });
};

export const deleteStrain = async (strain: db_Strain): Promise<void> => {
  const filter: FilterGroup<StrainFieldName> = {
    filters: [[['Name', { Equal: strain.name }]]],
    orderBy: [],
  };

  await deleteFilteredStrains(filter);
};

/**
 * Saves a strain and its allele rows in one transaction - all of it or none of
 * it. With `replaceName` it replaces the saved strain of that name (renaming it
 * if `strain.name` differs); without, it makes a new strain and refuses a name
 * that is taken.
 */
export const saveStrainWithAlleles = async (
  strain: db_Strain,
  alleles: db_StrainAllele[],
  replaceName?: string
): Promise<void> => {
  await invoke('save_strain_with_alleles', {
    strain,
    alleles,
    replaceName: replaceName ?? null,
  });
};

/** The saved strain called `name`, or undefined if there is none. */
export const findSavedStrain = async (
  name: string
): Promise<db_Strain | undefined> => {
  const found = await getFilteredStrains({
    filters: [[['Name', { Equal: name }]]],
    orderBy: [],
  });
  return found[0];
};
