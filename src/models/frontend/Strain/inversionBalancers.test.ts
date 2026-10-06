// Checks the GENERATED inversion balancers (data/inversion_balancers/*.csv,
// from scripts/build-inversion-balancers.mjs) against the app's own code: each
// strain's stored genotype is what Strain.toString builds, each strain is viable
// with every phenotype resolved, and each balancer is a single range from its
// left gene to its right gene.
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
const dir = (file: string): Row[] =>
  readCsv(`data/inversion_balancers/${file}`);

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

const num = (value: string): number | undefined =>
  value === '' ? undefined : Number(value);

const variationRows = dir('variations.csv');
const variations = new Map<string, Variation>(
  variationRows.map((row) => [
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
const alleles = new Map<string, Allele>(
  dir('alleles.csv').map((row) => {
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
            suppressingPhenotypes: relationRows
              .filter(
                (rel) =>
                  rel.allele_name === row.name &&
                  rel.expressing_phenotype_name ===
                    expr.expressingPhenotypeName &&
                  rel.expressing_phenotype_wild ===
                    expr.expressingPhenotypeWild &&
                  rel.is_suppressing === '1'
              )
              .map((rel) =>
                phenotypeOf(
                  rel.altering_phenotype_name,
                  rel.altering_phenotype_wild
                )
              ),
            requiredConditions: [],
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
  })
);

const strainRows = dir('strains.csv');
const strainAlleleRows = dir('strain_alleles.csv');

// A strain as stored: a pair on both homologs when isOnBot, else top only.
const buildStrain = (name: string): Strain =>
  new Strain({
    name,
    allelePairs: strainAlleleRows
      .filter((row) => row.strainName === name)
      .map((row) => {
        const allele = alleles.get(row.alleleName);
        if (allele === undefined)
          throw new Error(`${name}: missing allele ${row.alleleName}`);
        expect(row.isOnTop).toBe('true');
        return row.isOnBot === 'true' ? allele.toHomo() : allele.toTopHet();
      }),
  });

const TABLE_1: Array<[string, string, string]> = [
  ['tmC20', 'F53G12.8', 'sre-23'],
  ['tmC18', 'gsp-3', 'dnj-27'],
  ['tmC27', 'ile-1', 'dkf-1'],
  ['tmC6', 'ZK1240.1', 'asm-1'],
  ['tmC29', 'hlh-4', 'ttr-52'],
  ['tmC25', 'kvs-5', 'unc-8'],
  ['tmC5', 'C01B10.3', 'unc-31'],
  ['tmC9', 'mec-3', 'lgc-52'],
  ['tmC16', 'flp-34', 'T10H9.8'],
  ['tmC3', 'unc-83', 'lon-3'],
  ['tmC12', 'unc-23', 'C01G10.10'],
  ['tmC30', 'Y102A11A.6', 'mec-10'],
  ['tmC24', 'mec-10', 'F59F4.2'],
];
const geneByName = (name: string): Gene => {
  const found = [...genes.values()].filter(
    (gene) => gene.sysName === name || gene.descName === name
  );
  expect(found.length, name).toBeGreaterThanOrEqual(1);
  return found[0];
};

describe('inversion balancer ranges', () => {
  test.each(TABLE_1)(
    '%s covers the region from %s to %s',
    (balancer, left, right) => {
      const variation = variations.get(balancer);
      const [l, r] = [
        geneByName(left).physLoc ?? 0,
        geneByName(right).physLoc ?? 0,
      ];
      expect(variation?.recombination).toEqual([
        Math.min(l, r),
        Math.max(l, r),
      ]);
      // Placed at the midpoint of its range
      const [start, end] = variation?.recombination ?? [0, 0];
      expect(
        Math.abs((variation?.physLoc ?? 0) - (start + end) / 2)
      ).toBeLessThan(1);
    }
  );
});

describe('generated inversion balancer strains', () => {
  test('there are 25 strains, each with its balancer and a Pmyo-2 marker', () => {
    expect(strainRows).toHaveLength(25);
    strainRows.forEach((row) => {
      const strain = buildStrain(row.name);
      const names = strain.getNonWildAlleles().map((allele) => allele.name);
      expect(
        names.some((name) => /^tmC\d+$/.test(name)),
        row.name
      ).toBe(true);
      const markers = strain
        .getNonWildAlleles()
        .flatMap((allele) => allele.alleleExpressions)
        .map((expr) => expr.expressingPhenotype.name);
      expect(
        markers.some((marker) => marker.startsWith('Pmyo-2::')),
        row.name
      ).toBe(true);
    });
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

  test('the unc-9 deletion is rescued by the array', () => {
    // Unc-9 is expressed by tm9719 alone but not with the wild-type-expressing array
    const without = buildStrain('FX30194');
    const withArray = buildStrain('FX30252');
    const names = (strain: Strain): string[] =>
      strain
        .getExprPhenotypes()
        .filter((phenotype) => !phenotype.wild)
        .map((phenotype) => phenotype.name);
    expect(names(without)).toContain('Unc-9');
    expect(names(withArray)).not.toContain('Unc-9');
  });
});
