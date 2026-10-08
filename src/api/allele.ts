import { invoke } from '@tauri-apps/api/tauri';
import { type db_TableImport } from 'models/db/db_TableImport';
import { type db_Allele } from 'models/db/db_Allele';
import { type db_Gene } from 'models/db/db_Gene';
import { type AlleleFieldName } from 'models/db/filter/db_AlleleFieldName';
import { type GeneFieldName } from 'models/db/filter/db_GeneFieldName';
import {
  type FilterGroup,
  getSingleRecordOrThrow,
} from 'models/db/filter/FilterGroup';
import { type Allele } from 'models/frontend/Allele/Allele';

export const getAlleles = async (): Promise<db_Allele[]> => {
  return await invoke('get_alleles');
};

export const getFilteredAlleles = async (
  filter: FilterGroup<AlleleFieldName>
): Promise<db_Allele[]> => {
  return await invoke('get_filtered_alleles', { filter });
};

export const getCountFilteredAlleles = async (
  filter: FilterGroup<AlleleFieldName>
): Promise<number> => {
  return await invoke('get_count_filtered_alleles', { filter });
};

export const getFilteredAllelesWithGeneFilter = async (
  alleleFilter: FilterGroup<AlleleFieldName>,
  geneFilter: FilterGroup<GeneFieldName>
): Promise<Array<[db_Allele, db_Gene]>> => {
  return await invoke('get_filtered_alleles_with_gene_filter', {
    alleleFilter,
    geneFilter,
  });
};

export const getAllele = async (name: string): Promise<db_Allele> => {
  const filter: FilterGroup<AlleleFieldName> = {
    filters: [[['Name', { Equal: name }]]],
    orderBy: [],
  };
  const res = await getFilteredAlleles(filter);
  return getSingleRecordOrThrow(
    res,
    `Unable to find any alleles with the name: ${name}`
  );
};

export const insertAllele = async (allele: Allele): Promise<void> => {
  await insertDbAllele(allele.generateRecord());
};

export const insertDbAllele = async (record: db_Allele): Promise<void> => {
  if (record.sysGeneName === null && record.variationName === null)
    throw Error(
      'You need to specify an allele OR a variation when creating this allele'
    );
  else if (record.sysGeneName !== null && record.variationName !== null)
    throw Error('An allele can only belong to a gene OR a variation, not both');

  await invoke('insert_allele', { allele: record });
};

// Changes an allele's non-key columns; its name picks the row. Same
// gene-or-variation rule as inserting.
export const updateDbAllele = async (record: db_Allele): Promise<void> => {
  if (record.sysGeneName === null && record.variationName === null)
    throw Error('An allele needs a gene OR a variation');
  else if (record.sysGeneName !== null && record.variationName !== null)
    throw Error('An allele can only belong to a gene OR a variation, not both');

  await invoke('update_allele', { allele: record });
};

/**
 * Imports a CSV/TSV file into this table in one transaction. Rows already in
 * the table are kept as they are; the result says how many rows the file held
 * and how many were new.
 */
export const insertAllelesFromFile = async (
  path: string
): Promise<db_TableImport> => {
  return await invoke('insert_alleles_from_file', { path });
};

export const deleteFilteredAlleles = async (
  filter: FilterGroup<AlleleFieldName>
): Promise<void> => {
  await invoke('delete_filtered_alleles', { filter });
};

export const deleteAllele = async (allele: db_Allele): Promise<void> => {
  const filter: FilterGroup<AlleleFieldName> = {
    filters: [[['Name', { Equal: allele.name }]]],
    orderBy: [],
  };

  await deleteFilteredAlleles(filter);
};

export const getUnusedAlleleNames = async (): Promise<string[]> => {
  return await invoke('get_unused_allele_names');
};
