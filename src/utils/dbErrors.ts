import { getErrorMessage } from 'utils/getErrorMessage';

/**
 * Database errors reach the app as raw SQLite text, for example
 * "error returned from database: (code: 2067) UNIQUE constraint failed:
 * genes.systematic_name". `describeDbError` turns that into a plain sentence,
 * keeping the original text for a "Details" line. Messages the app wrote itself
 * (already plain) pass through untouched, with no Details.
 */

export type DbTableName =
  | 'genes'
  | 'variations'
  | 'alleles'
  | 'phenotypes'
  | 'conditions'
  | 'allele_exprs'
  | 'expr_relations'
  | 'allele_conversions'
  | 'strains'
  | 'strain_alleles';

export type DbAction = 'add' | 'edit' | 'delete' | 'import';

export interface DbErrorContext {
  action: DbAction;
  /** The table being written, which says what a foreign-key failure points at */
  table?: DbTableName;
  /** The row's name (the gene, allele or strain name), when it has one */
  label?: string;
  /** Opening words for an error that could not be translated, replacing the default (e.g. "Unable to save strain") */
  prefix?: string;
}

export interface DescribedDbError {
  /** A plain sentence */
  message: string;
  /** The original database text, when the sentence replaces it */
  details?: string;
}

/** What a row of each table is called in a sentence */
const NOUN: Record<DbTableName, string> = {
  genes: 'gene',
  variations: 'variation',
  alleles: 'allele',
  phenotypes: 'phenotype',
  conditions: 'condition',
  allele_exprs: 'allele phenotype',
  expr_relations: 'phenotype relationship',
  allele_conversions: 'allele conversion',
  strains: 'strain',
  strain_alleles: 'strain allele',
};

/** What a row of each table points at; a missing one fails an insert */
const POINTS_AT: Record<DbTableName, string> = {
  genes: 'something it refers to',
  variations: 'something it refers to',
  alleles: 'The gene or variation does not exist.',
  phenotypes: 'something it refers to',
  conditions: 'something it refers to',
  allele_exprs: 'The allele or the phenotype does not exist.',
  expr_relations:
    'The allele, the phenotype or the condition it names does not exist.',
  allele_conversions:
    'The source allele, the product allele or the driver phenotype does not exist.',
  strains: 'something it refers to',
  strain_alleles: 'The strain or the allele does not exist.',
};

const isTable = (name: string): name is DbTableName => name in NOUN;

/** "A gene", "An allele" */
const aOrAn = (noun: string): string => (/^[aeiou]/i.test(noun) ? 'An' : 'A');

const sentenceCase = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1);

/** "allele_name" -> "Allele name" */
const columnLabel = (column: string): string =>
  sentenceCase(column.replace(/_/g, ' '));

/**
 * The sentence for a duplicate row of `table`; used for a database failure and
 * for a pre-check before anything is written.
 */
export const duplicateSentence = (
  table: DbTableName,
  label?: string
): string => {
  const noun = NOUN[table];
  switch (table) {
    case 'phenotypes':
      return label !== undefined
        ? `A phenotype "${label}" with this wild-type setting already exists.`
        : 'A phenotype with this name and wild-type setting already exists.';
    case 'allele_exprs':
      return 'This allele already has this phenotype. Edit its copy number instead.';
    case 'expr_relations':
      return 'This phenotype relationship already exists.';
    case 'strain_alleles':
      return 'This strain already has this allele.';
    case 'allele_conversions':
      return 'This conversion rule already exists.';
    default:
      return label !== undefined
        ? `${aOrAn(noun)} ${noun} named "${label}" already exists.`
        : `${aOrAn(noun)} ${noun} with this name already exists.`;
  }
};

const SQLX_PREFIX = /^error returned from database: \(code: \d+\)\s*/;

/** The sentence for a file that could not be read row by row */
const describeCsvProblem = (reason: string): string => {
  const located =
    /record (\d+) \(line: (\d+), byte: \d+\): (?:field (\d+): )?(.*)$/.exec(
      reason
    );
  if (located === null) return reason;
  const [, , line, , what] = located;
  const meaning = /invalid digit|invalid float literal|number/i.test(what)
    ? 'a number was expected'
    : /true|false|bool/i.test(what)
    ? 'true or false was expected'
    : what;
  return `Line ${line} has a value that cannot be read: ${meaning}.`;
};

/**
 * @param e what the failed call threw (a `{ Insert: "..." }` object or an Error)
 * @param context what was being done, and to which table and row
 */
export const describeDbError = (
  e: unknown,
  context: DbErrorContext
): DescribedDbError => {
  const raw = getErrorMessage(e);
  const text = raw.replace(SQLX_PREFIX, '');

  const imported = /^Found (\d+) invalid rows?\(s\); first error: (.*)$/s.exec(
    text
  );
  if (imported !== null) {
    const count = Number(imported[1]);
    return {
      message: `${count} row${
        count === 1 ? '' : 's'
      } in the file could not be read. ${describeCsvProblem(imported[2])}`,
      details: raw,
    };
  }

  const unique = /UNIQUE constraint failed: (.+)$/.exec(text);
  if (unique !== null) {
    const table = unique[1].split(',')[0].trim().split('.')[0];
    const label = context.label;
    return {
      message: isTable(table)
        ? duplicateSentence(table, label)
        : 'This row already exists.',
      details: raw,
    };
  }

  if (text.includes('FOREIGN KEY constraint failed')) {
    if (context.action === 'delete')
      return {
        message: "Other rows still use this one, so it can't be deleted.",
        details: raw,
      };
    const points =
      context.table !== undefined ? POINTS_AT[context.table] : undefined;
    return {
      message:
        points?.endsWith('.') === true
          ? `${points} Add it first.`
          : 'Something this row refers to does not exist. Add it first.',
      details: raw,
    };
  }

  const missing = /NOT NULL constraint failed: \w+\.(\w+)/.exec(text);
  if (missing !== null)
    return {
      message: `${columnLabel(missing[1])} is required.`,
      details: raw,
    };

  if (text.includes('CHECK constraint failed')) {
    return {
      message: text.includes('percent_conversion')
        ? 'The percent converted must be between 0 and 100.'
        : 'A value is outside the range this field allows.',
      details: raw,
    };
  }

  // Already a sentence the app wrote (or an error we do not know): keep it
  return { message: text };
};

/** The opening words of a toast for an error that could not be translated */
export const actionPrefix = (context: DbErrorContext): string => {
  if (context.prefix !== undefined) return context.prefix;
  const noun = context.table !== undefined ? NOUN[context.table] : 'record';
  switch (context.action) {
    case 'add':
      return `Unable to add the ${noun}`;
    case 'edit':
      return `Unable to save the ${noun}`;
    case 'delete':
      return `Unable to delete the ${noun}`;
    case 'import':
      return 'Nothing was imported';
  }
};
