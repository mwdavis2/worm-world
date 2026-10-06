// Checks the GENERATED lin-15 / marker data (data/lin_15/*.csv, from
// scripts/build-lin-15.mjs) against the app's own code: each strain's stored
// genotype is what Strain.toString builds, each strain is viable with every
// phenotype resolved, and the temperature-sensitive and rescued alleles behave.
// lon-2(e678) and bli-4(e937) come from data/balancer_alleles.
import { readFileSync } from 'fs';
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
const both = (file: string): Row[] => [
  ...readCsv(`data/balancer_alleles/${file}`),
  ...readCsv(`data/lin_15/${file}`),
];
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
  both('variations.csv').map((row) => [
    row.alleleName,
    new Variation({
      name: row.alleleName,
      chromosome: row.chromosome as ChromosomeName,
      physLoc: num(row.physLoc),
      geneticLoc: num(row.geneticLoc),
    }),
  ])
);
const phenotypes = new Map<string, Phenotype>(
  both('phenotypes.csv').map((row) => [
    `${row.name}|${row.wild}`,
    new Phenotype({
      name: row.name,
      shortName: row.short_name,
      wild: row.wild === '1',
      lethal: row.lethal === '1',
    }),
  ])
);
const phenotypeOf = (name: string, wild: string): Phenotype => {
  const found = phenotypes.get(`${name}|${wild}`);
  if (found === undefined) throw new Error(`missing phenotype ${name}`);
  return found;
};

const exprRows = both('allele_exprs.csv');
const relationRows = both('expr_relations.csv');
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
          requiredPhenotypes: [],
          requiredConditions: relationsOf(expr)
            .filter(
              (rel) => rel.altering_condition !== '' && rel.is_suppressing === '0'
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
const alleles = new Map<string, Allele>(
  both('alleles.csv')
    // oxIs644 is not in the repo's data (it exists only in the live database)
    .filter((row) => row.name !== 'oxIs644')
    .map(makeAllele)
);

const strainRows = readCsv('data/lin_15/strains.csv');
const strainAlleleRows = readCsv('data/lin_15/strain_alleles.csv');
const buildStrain = (name: string): Strain =>
  new Strain({
    name,
    allelePairs: strainAlleleRows
      .filter((row) => row.strainName === name)
      .map((row) => {
        const allele = alleles.get(row.alleleName);
        if (allele === undefined)
          throw new Error(`${name}: missing allele ${row.alleleName}`);
        return allele.toHomo();
      }),
  });
const nonWildNames = (strain: Strain, conditions: string[]): string[] =>
  strain
    .getExprPhenotypes([], new Set(conditions))
    .filter((phenotype) => !phenotype.wild)
    .map((phenotype) => phenotype.name);

describe('generated lin-15 and marker strains', () => {
  test('there are six strains, every allele on both homologs', () => {
    expect(strainRows.map((row) => row.name)).toEqual([
      'EG1306',
      'EG1000',
      'EG1020',
      '154',
      '155',
      'DA438',
    ]);
    strainAlleleRows.forEach((row) =>
      expect([row.isOnTop, row.isOnBot]).toEqual(['true', 'true'])
    );
  });

  test.each(strainRows.map((row) => [row.name, row.genotype]))(
    '%s: the stored genotype is the one the app builds',
    (name, genotype) => {
      expect(buildStrain(name).toString()).toBe(genotype);
    }
  );

  test.each(strainRows.map((row) => [row.name]))(
    '%s: is viable, with every phenotype resolved',
    (name) => {
      const strain = buildStrain(name);
      expect(strain.isLethal()).toBe(false);
      expect(strain.getUnresolvedExprPhenotypes([], new Set(['25C']))).toEqual(
        []
      );
    }
  );
});

describe('temperature-sensitive alleles', () => {
  test.each([
    ['n765ts', 'Lin-15'],
    ['e1368ts', 'Daf-2'],
  ])('%s expresses %s only at 25C', (allele, phenotype) => {
    const strain = new Strain({
      allelePairs: [alleles.get(allele)?.toHomo() as never],
    });
    expect(nonWildNames(strain, [])).not.toContain(phenotype);
    expect(nonWildNames(strain, ['25C'])).toContain(phenotype);
  });

  test('DA438 shows Daf-2 only at 25C, and its other phenotypes always', () => {
    const strain = buildStrain('DA438');
    expect(nonWildNames(strain, [])).not.toContain('Daf-2');
    expect(nonWildNames(strain, ['25C'])).toContain('Daf-2');
    expect(nonWildNames(strain, [])).toEqual(
      expect.arrayContaining(['Bli-4', 'Rol-6', 'Vab-7', 'Unc-31', 'Dpy-11', 'Lon-2'])
    );
  });

  test('oxIs12 rescues lin-15(n765ts) at 25C', () => {
    const mutantOnly = new Strain({
      allelePairs: [alleles.get('n765ts')?.toHomo() as never],
    });
    expect(nonWildNames(mutantOnly, ['25C'])).toContain('Lin-15');
    expect(nonWildNames(buildStrain('EG1306'), ['25C'])).not.toContain(
      'Lin-15'
    );
  });
});

describe('unc-119 alleles and the oxIs transgenes', () => {
  test.each(['ed3', 'ed4', 'ed9'])(
    'unc-119(%s) expresses Unc-119 and oxIs363 rescues it',
    (allele) => {
      const mutant = alleles.get(allele)?.toHomo() as never;
      expect(nonWildNames(new Strain({ allelePairs: [mutant] }), [])).toContain(
        'Unc-119'
      );
      const rescued = new Strain({
        allelePairs: [mutant, alleles.get('oxIs363')?.toHomo() as never],
      });
      expect(nonWildNames(rescued, [])).not.toContain('Unc-119');
    }
  );

  test('the transgenes carry their markers', () => {
    const names = (allele: string): string[] =>
      (alleles.get(allele)?.alleleExpressions ?? []).map(
        (expr) => expr.expressingPhenotype.name
      );
    expect(names('oxIs12')).toEqual(
      expect.arrayContaining(['Punc-47::GFP', 'Lin-15'])
    );
    expect(names('oxIs363')).toEqual(
      expect.arrayContaining(['Punc-122::GFP', 'Unc-119'])
    );
  });

  test('oxIs12 sits 1 cM left of lin-15 on X', () => {
    const lin15 = Number(
      readCsv('src-tauri/seed/genes.csv').find(
        (row) => row.sysName === 'ZK678.1&ZK662.4'
      )?.geneticLoc
    );
    expect(variations.get('oxIs12')?.geneticLoc).toBeCloseTo(lin15 - 1, 3);
  });
});
