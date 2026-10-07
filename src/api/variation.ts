import { invoke } from '@tauri-apps/api/tauri';
import { type db_TableImport } from 'models/db/db_TableImport';
import { type db_Variation } from 'models/db/db_Variation';
import { type VariationFieldName } from 'models/db/filter/db_VariationFieldName';
import {
  type FilterGroup,
  getSingleRecordOrThrow,
} from 'models/db/filter/FilterGroup';
import { type Variation } from 'models/frontend/Variation/Variation';

export const getVariations = async (): Promise<db_Variation[]> => {
  return await invoke('get_variation');
};

export const getFilteredVariations = async (
  filter: FilterGroup<VariationFieldName>
): Promise<db_Variation[]> => {
  return await invoke('get_filtered_variations', {
    filter,
  });
};

export const getCountFilteredVariations = async (
  filter: FilterGroup<VariationFieldName>
): Promise<number> => {
  return await invoke('get_count_filtered_variations', {
    filter,
  });
};

// Eligible for the New Allele dialog's "Location lookup" control - see
// InnerDbState::get_location_reference_variations for the exact filter.
export const getLocationReferenceVariations = async (): Promise<
  db_Variation[]
> => {
  return await invoke('get_location_reference_variations');
};

export const getVariation = async (
  alleleName: string
): Promise<db_Variation> => {
  const filter: FilterGroup<VariationFieldName> = {
    filters: [[['AlleleName', { Equal: alleleName }]]],
    orderBy: [],
  };
  const res = await getFilteredVariations(filter);
  return getSingleRecordOrThrow(res, 'Unable to get specified variation');
};

export const insertVariation = async (variation: Variation): Promise<void> => {
  await insertDbVariation(variation.generateRecord());
};

export const insertDbVariation = async (
  record: db_Variation
): Promise<void> => {
  await invoke('insert_variation', { variation: record });
};

// Changes a variation's non-key columns; its allele name picks the row.
export const updateDbVariation = async (
  record: db_Variation
): Promise<void> => {
  await invoke('update_variation', { variation: record });
};

/**
 * Imports a CSV/TSV file into this table in one transaction. Rows already in
 * the table are kept as they are; the result says how many rows the file held
 * and how many were new.
 */
export const insertVariationsFromFile = async (
  path: string
): Promise<db_TableImport> => {
  return await invoke('insert_variations_from_file', { path });
};

export const deleteFilteredVariations = async (
  filter: FilterGroup<VariationFieldName>
): Promise<void> => {
  await invoke('delete_filtered_variations', { filter });
};

export const deleteVariation = async (
  variation: db_Variation
): Promise<void> => {
  const filter: FilterGroup<VariationFieldName> = {
    filters: [[['AlleleName', { Equal: variation.alleleName }]]],
    orderBy: [],
  };

  await deleteFilteredVariations(filter);
};
