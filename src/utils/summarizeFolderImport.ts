import { type db_TableImport } from 'models/db/db_TableImport';

/** A short human summary of a folder import, one line per table. */
export const summarizeFolderImport = (report: db_TableImport[]): string => {
  if (report.length === 0)
    return 'No table files were found in that folder (expected names like genes.csv or alleles.csv)';
  const added = report.reduce((sum, table) => sum + table.inserted, 0);
  const lines = report.map((table) => {
    const skipped = table.read - table.inserted;
    return `${table.table}: ${table.inserted} added${
      skipped > 0 ? `, ${skipped} already there` : ''
    }`;
  });
  return [
    `Imported ${added} new row${added === 1 ? '' : 's'} from ${
      report.length
    } table${report.length === 1 ? '' : 's'}`,
    ...lines,
  ].join('\n');
};
