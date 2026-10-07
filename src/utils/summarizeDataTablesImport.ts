import { type db_TableImport } from 'models/db/db_TableImport';

/**
 * A short human summary of a data tables zip import, one line per table. Rows
 * that were already in the database are kept as they are, and counted.
 */
export const summarizeDataTablesImport = (report: db_TableImport[]): string => {
  if (report.length === 0)
    return 'No table files were found in that zip (expected names like genes.csv or alleles.csv)';
  const added = report.reduce((sum, table) => sum + table.inserted, 0);
  const lines = report.map((table) => {
    const kept = table.read - table.inserted;
    return `${table.table}: ${table.inserted} added${
      kept > 0 ? `, kept your existing ${kept}` : ''
    }`;
  });
  return [
    `Imported ${added} new row${added === 1 ? '' : 's'} from ${
      report.length
    } table${report.length === 1 ? '' : 's'}`,
    ...lines,
  ].join('\n');
};
