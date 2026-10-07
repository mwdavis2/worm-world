import { invoke } from '@tauri-apps/api/tauri';
import { type db_TableImport } from 'models/db/db_TableImport';
import { type db_StrainAllele } from 'models/db/db_StrainAllele';
import { type StrainAlleleFieldName } from 'models/db/filter/db_StrainAlleleFieldName';
import { type FilterGroup } from 'models/db/filter/FilterGroup';

export const getStrainAlleles = async (): Promise<db_StrainAllele[]> => {
  return await invoke('get_strain_alleles');
};

export const getFilteredStrainAlleles = async (
  filter: FilterGroup<StrainAlleleFieldName>
): Promise<db_StrainAllele[]> => {
  return await invoke('get_filtered_strain_alleles', {
    filter,
  });
};

export const getCountFilteredStrainAlleles = async (
  filter: FilterGroup<StrainAlleleFieldName>
): Promise<number> => {
  return await invoke('get_count_filtered_strain_alleles', {
    filter,
  });
};

export const insertDbStrainAllele = async (
  record: db_StrainAllele
): Promise<void> => {
  await invoke('insert_strain_allele', { strainAllele: record });
};

// Changes which chromosome copies a strain allele is on; the strain and
// allele pick the row.
export const updateDbStrainAllele = async (
  record: db_StrainAllele
): Promise<void> => {
  await invoke('update_strain_allele', { strainAllele: record });
};

/**
 * Imports a CSV/TSV file into this table in one transaction. Rows already in
 * the table are kept as they are; the result says how many rows the file held
 * and how many were new.
 */
export const insertStrainAllelesFromFile = async (
  path: string
): Promise<db_TableImport> => {
  return await invoke('insert_strain_alleles_from_file', { path });
};

export const deleteFilteredStrainAlleles = async (
  filter: FilterGroup<StrainAlleleFieldName>
): Promise<void> => {
  await invoke('delete_filtered_strain_alleles', { filter });
};

export const deleteStrainAllele = async (
  strainAllele: db_StrainAllele
): Promise<void> => {
  const filter: FilterGroup<StrainAlleleFieldName> = {
    filters: [
      [['StrainName', { Equal: strainAllele.strainName }]],
      [['AlleleName', { Equal: strainAllele.alleleName }]],
    ],
    orderBy: [],
  };

  await deleteFilteredStrainAlleles(filter);
};
