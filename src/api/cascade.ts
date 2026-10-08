import { invoke } from '@tauri-apps/api/tauri';
import { type db_CascadeTable } from 'models/db/db_CascadeTable';
import { type db_DependentRows } from 'models/db/db_DependentRows';

/** What deleting the row would also delete (only tables with rows to go) */
export const getDeleteImpact = async (
  table: db_CascadeTable,
  key: string[]
): Promise<db_DependentRows[]> => {
  return await invoke('get_delete_impact', { table, key });
};

/**
 * Deletes the row and everything that depends on it in one transaction.
 * Returns how many rows of the row's own table were deleted (0 if it was gone).
 */
export const deleteWithDependents = async (
  table: db_CascadeTable,
  key: string[]
): Promise<number> => {
  return await invoke('delete_with_dependents', { table, key });
};
