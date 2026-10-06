import { describe, expect, test } from 'vitest';
import { summarizeFolderImport } from 'utils/summarizeFolderImport';

describe('summarizeFolderImport', () => {
  test('says so when no table files were found', () => {
    expect(summarizeFolderImport([])).toMatch(/No table files/);
  });

  test('lists each table with what was added and what already existed', () => {
    const text = summarizeFolderImport([
      { table: 'variations', read: 3, inserted: 3 },
      { table: 'alleles', read: 5, inserted: 2 },
    ]);
    expect(text).toContain('Imported 5 new rows from 2 tables');
    expect(text).toContain('variations: 3 added');
    expect(text).toContain('alleles: 2 added, 3 already there');
    expect(text).not.toContain('variations: 3 added, ');
  });

  test('uses singular wording for one row from one table', () => {
    expect(
      summarizeFolderImport([{ table: 'genes', read: 1, inserted: 1 }])
    ).toContain('Imported 1 new row from 1 table');
  });
});
