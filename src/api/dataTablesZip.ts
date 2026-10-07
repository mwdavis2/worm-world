import { invoke } from '@tauri-apps/api/tauri';
import { type db_CrossDesign } from 'models/db/db_CrossDesign';
import { type db_DesignBundleSummary } from 'models/db/db_DesignBundleSummary';
import { type db_TableImport } from 'models/db/db_TableImport';

/**
 * Imports every table file in the zip archive (genes.csv, variations.csv, ...)
 * in dependency order and in one transaction: if anything fails, nothing is
 * imported. Resolves to one entry per table file that was found. A cross design
 * (the design of a design bundle) is added in the same transaction.
 */
export const importDataTablesZip = async (
  path: string,
  crossDesign?: db_CrossDesign
): Promise<db_TableImport[]> => {
  return await invoke('import_data_tables_zip', {
    path,
    crossDesign: crossDesign ?? null,
  });
};

/** The design JSON inside a design bundle, or null for a plain data tables zip. */
export const readBundleDesign = async (
  path: string
): Promise<string | null> => {
  return await invoke('read_bundle_design', { path });
};

/**
 * Writes the design JSON and the data table rows its strains and alleles refer
 * to as a zip bundle at `path`.
 */
export const exportDesignBundle = async (
  path: string,
  designJson: string,
  strainNames: string[],
  alleleNames: string[]
): Promise<db_DesignBundleSummary> => {
  return await invoke('export_design_bundle', {
    path,
    designJson,
    strainNames,
    alleleNames,
  });
};
