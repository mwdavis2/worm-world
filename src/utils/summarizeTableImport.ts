import { type db_TableImport } from 'models/db/db_TableImport';

/**
 * What an import of one table's file did, in a sentence: how many rows were
 * added, and how many of the file's rows were already there (and kept as they
 * were, not overwritten).
 */
export const summarizeTableImport = (
  title: string,
  report: db_TableImport
): string => {
  const kept = report.read - report.inserted;
  if (report.read === 0) return `No rows were found in that file for ${title}`;
  if (report.inserted === 0)
    return `Nothing new: all ${report.read} row${
      report.read === 1 ? ' was' : 's were'
    } already in ${title}, so your existing ${
      report.read === 1 ? 'row was' : 'rows were'
    } kept`;
  const added = `Added ${report.inserted} new row${
    report.inserted === 1 ? '' : 's'
  } to ${title}`;
  return kept > 0
    ? `${added}; ${kept} more ${
        kept === 1 ? 'was' : 'were'
      } already there, so your existing ${
        kept === 1 ? 'row was' : 'rows were'
      } kept`
    : added;
};
