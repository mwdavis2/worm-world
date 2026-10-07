import { describe, expect, test } from 'vitest';
import { type db_TableImport } from 'models/db/db_TableImport';
import { summarizeTableImport } from 'utils/summarizeTableImport';

const report = (read: number, inserted: number): db_TableImport => ({
  table: 'genes',
  read,
  inserted,
});

describe('summarizeTableImport', () => {
  test('all rows new', () => {
    expect(summarizeTableImport('Genes', report(5, 5))).toBe(
      'Added 5 new rows to Genes'
    );
    expect(summarizeTableImport('Genes', report(1, 1))).toBe(
      'Added 1 new row to Genes'
    );
  });

  test('some rows were already there and are kept', () => {
    expect(summarizeTableImport('Alleles', report(10, 7))).toBe(
      'Added 7 new rows to Alleles; 3 more were already there, so your existing rows were kept'
    );
    expect(summarizeTableImport('Alleles', report(2, 1))).toBe(
      'Added 1 new row to Alleles; 1 more was already there, so your existing row was kept'
    );
  });

  test('nothing new', () => {
    expect(summarizeTableImport('Strains', report(4, 0))).toBe(
      'Nothing new: all 4 rows were already in Strains, so your existing rows were kept'
    );
    expect(summarizeTableImport('Strains', report(1, 0))).toBe(
      'Nothing new: all 1 row was already in Strains, so your existing row was kept'
    );
  });

  test('an empty file', () => {
    expect(summarizeTableImport('Strains', report(0, 0))).toBe(
      'No rows were found in that file for Strains'
    );
  });
});
