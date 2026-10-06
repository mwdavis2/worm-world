// Checks the GENERATED mIn1 folder (data/mIn1/*.csv, from scripts/build-min1.mjs)
// against the app's own code: the stored genotype is what Strain.toString
// builds, the strain is viable, and the alleles behave as described.
import { readdirSync, readFileSync } from 'fs';
import { describe, expect, test } from 'vitest';
import { Allele } from 'models/frontend/Allele/Allele';
import {
  AlleleExpression,
  dominanceToZygosity,
} from 'models/frontend/AlleleExpression/AlleleExpression';
import { Condition } from 'models/frontend/Condition/Condition';
import { Gene } from 'models/frontend/Gene/Gene';
import { Phenotype } from 'models/frontend/Phenotype/Phenotype';
import { Strain } from 'models/frontend/Strain/Strain';
import { Variation } from 'models/frontend/Variation/Variation';
import { type ChromosomeName } from 'models/db/filter/db_ChromosomeName';

type Row = Record<string, string>;

const readCsv = (path: string): Row[] => {
  const [header, ...rows] = readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => line.split(','));
  return rows.map((row) => {
    expect(row.length, `${path}: ${row.join(',')}`).toBe(header.length);
    return Object.fromEntries(header.map((name, i) => [name, row[i]]));
  });
};
// e1107 (tra-3), e12 (dpy-9), ox1059 (kin-4), oxIs644, oxTi302, oxTi75,
// oxSi1168 and oxEx2254 exist only in the live database, so the test supplies
// stand-ins for them (recessive and rescued, as in the database).
const dir = (file: string): Row[] => readCsv(`data/mIn1/${file}`);
const num = (value: string): number | undefined =>
  value === '' ? undefined : Number(value);
const genes = new Map<string, Gene>(
  readCsv('src-tauri/seed/genes.csv').map((row) => [
    row.sysName,
    new Gene({
      sysName: row.sysName,
      descName: row.descName === '' ? undefined : row.descName,
      chromosome: row.chromosome as ChromosomeName,
      physLoc: Number(row.physLoc),
      geneticLoc: Number(row.geneticLoc),
    }),
  ])
);
const variations = new Map<string, Variation>(
  dir('variations.csv').map((row) => [
    row.alleleName,
    new Variation({
      name: row.alleleName,
      chromosome: row.chromosome as ChromosomeName,
      physLoc: num(row.physLoc),
      geneticLoc: num(row.geneticLoc),
      recombination:
        row.recombSuppressorStart === ''
          ? undefined
          : [
              Number(row.recombSuppressorStart),
              Number(row.recombSuppressorEnd),
            ],
    }),
  ])
);
const phenotypes = new Map<string, Phenotype>(
  dir('phenotypes.csv').map((row) => [
    `${row.name}|${row.wild}`,
    new Phenotype({
      name: row.name,
      shortName: row.short_name,
      wild: row.wild === '1',
      lethal: row.lethal === '1',
      femaleSterile: row.female_sterile === '1',
    }),
  ])
);
const phenotypeOf = (name: string, wild: string): Phenotype => {
  const found = phenotypes.get(`${name}|${wild}`);
  if (found === undefined) throw new Error(`missing phenotype ${name}`);
  return found;
};

const exprRows = dir('allele_exprs.csv');
const relationRows = dir('expr_relations.csv');
const makeAllele = (row: Row): [string, Allele] => {
  const relationsOf = (expr: Row): Row[] =>
    relationRows.filter(
      (rel) =>
        rel.allele_name === row.name &&
        rel.expressing_phenotype_name === expr.expressingPhenotypeName &&
        rel.expressing_phenotype_wild === expr.expressingPhenotypeWild
    );
  const expressions = exprRows
    .filter((expr) => expr.alleleName === row.name)
    .map(
      (expr) =>
        new AlleleExpression({
          alleleName: row.name,
          expressingPhenotype: phenotypeOf(
            expr.expressingPhenotypeName,
            expr.expressingPhenotypeWild
          ),
          requiredPhenotypes: relationsOf(expr)
            .filter(
              (rel) =>
                rel.altering_phenotype_name !== '' && rel.is_suppressing === '0'
            )
            .map((rel) =>
              phenotypeOf(
                rel.altering_phenotype_name,
                rel.altering_phenotype_wild
              )
            ),
          requiredConditions: relationsOf(expr)
            .filter(
              (rel) =>
                rel.altering_condition !== '' && rel.is_suppressing === '0'
            )
            .map((rel) => new Condition({ name: rel.altering_condition })),
          suppressingPhenotypes: relationsOf(expr)
            .filter(
              (rel) =>
                rel.altering_phenotype_name !== '' && rel.is_suppressing === '1'
            )
            .map((rel) =>
              phenotypeOf(
                rel.altering_phenotype_name,
                rel.altering_phenotype_wild
              )
            ),
          suppressingConditions: [],
          dominance: dominanceToZygosity(Number(expr.dominance)),
        })
    );
  return [
    row.name,
    new Allele({
      name: row.name,
      gene: row.sysGeneName === '' ? undefined : genes.get(row.sysGeneName),
      variation:
        row.variationName === ''
          ? undefined
          : variations.get(row.variationName),
      alleleExpressions: expressions,
    }),
  ];
};
const alleles = new Map<string, Allele>(dir('alleles.csv').map(makeAllele));

const strainRows = dir('strains.csv');
const strainAlleleRows = dir('strain_alleles.csv');
const strain = new Strain({
  name: strainRows[0].name,
  allelePairs: strainAlleleRows.map((row) => {
    const allele = alleles.get(row.alleleName);
    if (allele === undefined)
      throw new Error(`missing allele ${row.alleleName}`);
    return allele.toHomo();
  }),
});
const nonWildNames = (s: Strain): string[] =>
  s
    .getExprPhenotypes()
    .filter((phenotype) => !phenotype.wild)
    .map((phenotype) => phenotype.name);
const alone = (allele: string, het: boolean): Strain =>
  new Strain({
    allelePairs: [
      (het
        ? alleles.get(allele)?.toTopHet()
        : alleles.get(allele)?.toHomo()) as never,
    ],
  });

describe('the mIn1[dpy-10(e128) mIs14] folder', () => {
  test('mIn1 covers the sequenced breakpoints and sits at their midpoint', () => {
    const mIn1 = variations.get('mIn1');
    expect(mIn1?.recombination).toEqual([3_553_628, 12_704_681]);
    expect(mIn1?.chromosome).toBe('II');
    expect(Math.abs((mIn1?.physLoc ?? 0) - 8_129_154.5)).toBeLessThan(1);
  });

  test('the stored genotype is the one the app builds', () => {
    expect(strainRows).toHaveLength(1);
    expect(strainRows[0].name).toBe('mIn1[dpy-10(e128) mIs14]');
    expect(strain.toString()).toBe(strainRows[0].genotype);
  });

  test('the strain is homozygous and viable with every phenotype resolved', () => {
    strainAlleleRows.forEach((row) => {
      expect([row.isOnTop, row.isOnBot]).toEqual(['true', 'true']);
    });
    expect(strain.isLethal()).toBe(false);
    expect(strain.getUnresolvedExprPhenotypes()).toEqual([]);
  });

  test('dpy-10(e128) is a recessive Dpy-10, shown only when homozygous', () => {
    expect(nonWildNames(alone('e128', false))).toEqual(['Dpy-10']);
    expect(nonWildNames(alone('e128', true))).toEqual([]);
  });

  test('mIs14 is dimmer at one copy than at two', () => {
    expect(nonWildNames(alone('mIs14', true))).toEqual(['Pmyo-2::GFP(weak)']);
    expect(nonWildNames(alone('mIs14', false))).toEqual(['Pmyo-2::GFP']);
  });

  test('the strain shows Dpy-10 and the bright pharyngeal GFP', () => {
    expect(nonWildNames(strain).sort()).toEqual(['Dpy-10', 'Pmyo-2::GFP']);
  });

  test('the folder is named for the tables the importer looks for', () => {
    expect(readdirSync('data/mIn1').sort()).toEqual([
      'allele_exprs.csv',
      'alleles.csv',
      'expr_relations.csv',
      'phenotypes.csv',
      'strain_alleles.csv',
      'strains.csv',
      'variations.csv',
    ]);
  });
});
