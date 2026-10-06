import { invoke } from '@tauri-apps/api/tauri';
import { type db_TableImport } from 'models/db/db_TableImport';

/**
 * Imports every table file found in the folder (genes.csv, variations.csv, ...)
 * in dependency order and in one transaction: if anything fails, nothing is
 * imported. Resolves to one entry per file that was found.
 */
export const importFolder = async (path: string): Promise<db_TableImport[]> => {
  return await invoke('import_folder', { path });
};
