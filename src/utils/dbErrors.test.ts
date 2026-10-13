import { describe, expect, test } from 'vitest';
import {
  actionPrefix,
  describeDbError,
  duplicateSentence,
} from 'utils/dbErrors';

const sqlx = (text: string): { Insert: string } => ({
  Insert: `error returned from database: (code: 2067) ${text}`,
});

describe('describeDbError', () => {
  test.each([
    [
      'UNIQUE constraint failed: genes.systematic_name',
      'A gene named "G1" already exists.',
      'G1',
    ],
    [
      'UNIQUE constraint failed: alleles.name',
      'An allele named "ox1" already exists.',
      'ox1',
    ],
    [
      'UNIQUE constraint failed: strains.name',
      'A strain named "EG1" already exists.',
      'EG1',
    ],
    [
      'UNIQUE constraint failed: conditions.name',
      'A condition named "25C" already exists.',
      '25C',
    ],
    [
      'UNIQUE constraint failed: phenotypes.name, phenotypes.wild',
      'A phenotype "Unc" with this wild-type setting already exists.',
      'Unc',
    ],
    [
      'UNIQUE constraint failed: allele_exprs.allele_name, allele_exprs.expressing_phenotype_name, allele_exprs.expressing_phenotype_wild',
      'This allele already has this phenotype. Edit its copy number instead.',
      undefined,
    ],
    [
      'UNIQUE constraint failed: strain_alleles.strain_name, strain_alleles.allele_name',
      'This strain already has this allele.',
      undefined,
    ],
  ])('%s', (raw, expected, label) => {
    const described = describeDbError(sqlx(raw), {
      action: 'add',
      label,
    });
    expect(described.message).toBe(expected);
    expect(described.details).toContain(raw);
  });

  test('an unnamed duplicate still reads as a sentence', () => {
    expect(
      describeDbError(sqlx('UNIQUE constraint failed: genes.systematic_name'), {
        action: 'add',
      }).message
    ).toBe('A gene with this name already exists.');
  });

  test('a foreign-key failure on add says what is missing, by table', () => {
    const fk = {
      Insert:
        'error returned from database: (code: 787) FOREIGN KEY constraint failed',
    };
    expect(
      describeDbError(fk, { action: 'add', table: 'alleles' }).message
    ).toBe('The gene or variation does not exist. Add it first.');
    expect(
      describeDbError(fk, { action: 'add', table: 'allele_conversions' })
        .message
    ).toContain('driver phenotype does not exist');
    expect(describeDbError(fk, { action: 'add', table: 'genes' }).message).toBe(
      'Something this row refers to does not exist. Add it first.'
    );
    expect(describeDbError(fk, { action: 'add' }).details).toContain(
      'FOREIGN KEY'
    );
  });

  test('a foreign-key failure on delete says the row is still used', () => {
    const fk = {
      Delete:
        'error returned from database: (code: 787) FOREIGN KEY constraint failed',
    };
    expect(
      describeDbError(fk, { action: 'delete', table: 'alleles' }).message
    ).toBe("Other rows still use this one, so it can't be deleted.");
  });

  test('a missing required value names the field', () => {
    expect(
      describeDbError(
        {
          Insert:
            'error returned from database: (code: 1299) NOT NULL constraint failed: variations.allele_name',
        },
        { action: 'add' }
      ).message
    ).toBe('Allele name is required.');
  });

  test('a check failure is a range message', () => {
    expect(
      describeDbError(
        {
          Insert:
            'error returned from database: (code: 275) CHECK constraint failed: percent_conversion >= 0 AND percent_conversion <= 100',
        },
        { action: 'add' }
      ).message
    ).toBe('The percent converted must be between 0 and 100.');
  });

  test('a file that cannot be read says which line', () => {
    const described = describeDbError(
      {
        BulkInsert:
          'Found 2 invalid row(s); first error: CSV deserialize error: record 3 (line: 4, byte: 81): field 3: invalid digit found in string',
      },
      { action: 'import' }
    );
    expect(described.message).toBe(
      '2 rows in the file could not be read. Line 4 has a value that cannot be read: a number was expected.'
    );
    expect(described.details).toContain('Found 2 invalid row(s)');
  });

  test('a sentence the app wrote itself passes through with no details', () => {
    const plain = describeDbError(
      {
        Insert:
          "The product 'b' must be an allele of the same gene or variation as the source 'a'",
      },
      { action: 'add' }
    );
    expect(plain.details).toBeUndefined();
    expect(plain.message).toContain('same gene or variation');
    expect(describeDbError(new Error('boom'), { action: 'edit' })).toEqual({
      message: 'boom',
    });
  });
});

describe('duplicateSentence and actionPrefix', () => {
  test('read well for every table', () => {
    expect(duplicateSentence('variations', 'oxSi1')).toBe(
      'A variation named "oxSi1" already exists.'
    );
    expect(duplicateSentence('allele_conversions')).toBe(
      'This conversion rule already exists.'
    );
    expect(actionPrefix({ action: 'add', table: 'strains' })).toBe(
      'Unable to add the strain'
    );
    expect(actionPrefix({ action: 'import' })).toBe('Nothing was imported');
  });
});
