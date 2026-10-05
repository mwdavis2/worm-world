// Checks the GENERATED balancer strains (data/balancer_strains/*.csv, from
// scripts/build-balancer-strains.mjs) against the app's own code: each strain's
// stored genotype text must be what Strain.toString builds, and each strain -
// a balancer over wild type with its real alleles - must be viable with every
// phenotype resolved.
import { readFileSync } from 'fs';
import { describe, expect, test } from 'vitest';
import { Allele } from 'models/frontend/Allele/Allele';
import {
  AlleleExpression,
  dominanceToZygosity,
} from 'models/frontend/AlleleExpression/AlleleExpression';
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
const readAll = (file: string, dirs: string[]): Row[] =>
  dirs.flatMap((dir) => readCsv(`${dir}/${file}`));

const DATA = ['data/translocations', 'data/balancer_alleles'];

const genes = new Map<string, Gene>(
  [
    ...readCsv('src-tauri/seed/genes.csv'),
    ...readCsv('data/wormbase/placeholder_genes.csv'),
  ].map((row) => [
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
  readAll('variations.csv', DATA).map((row) => [
    row.alleleName,
    new Variation({
      name: row.alleleName,
      chromosome: row.chromosome as ChromosomeName,
      physLoc: Number(row.physLoc),
      geneticLoc: Number(row.geneticLoc),
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
  readAll('phenotypes.csv', DATA).map((row) => [
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

const exprRows = readAll('allele_exprs.csv', DATA);
const relationRows = readAll('expr_relations.csv', DATA);

const alleles = new Map<string, Allele>(
  readAll('alleles.csv', DATA).map((row) => {
    const expressions = exprRows
      .filter((expr) => expr.alleleName === row.name)
      .map((expr) => {
        const suppressing = relationRows
          .filter(
            (rel) =>
              rel.allele_name === row.name &&
              rel.expressing_phenotype_name === expr.expressingPhenotypeName &&
              rel.expressing_phenotype_wild === expr.expressingPhenotypeWild &&
              rel.is_suppressing === '1'
          )
          .map((rel) =>
            phenotypeOf(
              rel.altering_phenotype_name,
              rel.altering_phenotype_wild
            )
          );
        return new AlleleExpression({
          alleleName: row.name,
          expressingPhenotype: phenotypeOf(
            expr.expressingPhenotypeName,
            expr.expressingPhenotypeWild
          ),
          requiredPhenotypes: [],
          suppressingPhenotypes: suppressing,
          requiredConditions: [],
          suppressingConditions: [],
          dominance: dominanceToZygosity(Number(expr.dominance)),
        });
      });
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
  })
);
// dpy-10(e128) is an existing allele, not generated with the others.
alleles.set(
  'e128',
  new Allele({
    name: 'e128',
    gene: genes.get('T14B4.7'),
    alleleExpressions: [],
  })
);

const strainRows = readCsv('data/balancer_strains/strains.csv');
const strainAlleleRows = readCsv('data/balancer_strains/strain_alleles.csv');

// The strain as stored: every allele on top, and on the bottom too when the
// strain is homozygous. `forceHomozygous` builds the homozygous version of any
// strain, to ask whether that homozygote would be lethal.
const buildStrain = (name: string, forceHomozygous = false): Strain =>
  new Strain({
    name,
    allelePairs: strainAlleleRows
      .filter((row) => row.strainName === name)
      .map((row) => {
        const allele = alleles.get(row.alleleName);
        if (allele === undefined)
          throw new Error(`${name}: missing allele ${row.alleleName}`);
        expect(row.isOnTop).toBe('true');
        return forceHomozygous || row.isOnBot === 'true'
          ? allele.toHomo()
          : allele.toTopHet();
      }),
  });

const isStoredHomozygous = (name: string): boolean => {
  const flags = strainAlleleRows
    .filter((row) => row.strainName === name)
    .map((row) => row.isOnBot);
  // All of a strain's alleles are homozygous, or none is.
  expect(new Set(flags).size, name).toBe(1);
  return flags[0] === 'true';
};

describe('generated balancer strains', () => {
  test('there is a strain for every balancer family', () => {
    const names = strainRows.map((row) => row.name);
    ['eT1', 'nT1', 'hT2', 'szT1', 'hT3', 'mT1', 'hT1'].forEach((family) => {
      expect(names, family).toContain(family);
    });
    expect(new Set(names).size).toBe(names.length);
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
      expect(strain.getUnresolvedExprPhenotypes()).toEqual([]);
    }
  );

  test.each(strainRows.map((row) => [row.name]))(
    '%s: is homozygous unless the homozygote would be lethal',
    (name) => {
      expect(isStoredHomozygous(name)).toBe(
        !buildStrain(name, true).isLethal()
      );
    }
  );
});
