import { invoke } from '@tauri-apps/api';
import { type DbTableName } from 'utils/dbErrors';

/**
 * Writes a whole data table to `path` as a CSV file in the format its importer
 * reads (so the file can be imported again). Resolves to how many rows were
 * written. The cross design and task tables cannot be exported this way.
 */
export const exportTableCsv = async (
  table: DbTableName,
  path: string
): Promise<number> => await invoke('export_table_csv', { table, path });
