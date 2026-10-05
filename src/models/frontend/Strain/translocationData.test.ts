// Checks the GENERATED translocation data (data/translocations/*.csv, from
// scripts/build-translocations.mjs) against the real phenotype resolver, for
// every family and variant: build alleles from the CSV rows, then check all
// nine copy-number combinations of the two halves.
import { readFileSync } from 'fs';
import { describe, expect, test } from 'vitest';
import { Allele } from 'models/frontend/Allele/Allele';
import {
  AlleleExpression,
  dominanceToZygosity,
} from 'models/frontend/AlleleExpression/AlleleExpression';
import { type AllelePair } from 'models/frontend/AllelePair/AllelePair';
import { Phenotype } from 'models/frontend/Phenotype/Phenotype';
import { Strain } from 'models/frontend/Strain/Strain';
import { Variation } from 'models/frontend/Variation/Variation';
import { type ChromosomeName } from 'models/db/filter/db_ChromosomeName';

const readCsv = (file: string): Array<Record<string, string>> => {
  const [header, ...rows] = readFileSync(`data/translocations/${file}`, 'utf8')
    .trim()
    .split('\n')
    .map((line) => line.split(','));
  return rows.map((row) => {
    expect(row.length, `${file}: ${row.join(',')}`).toBe(header.length);
    return Object.fromEntries(header.map((name, i) => [name, row[i]]));
  });
};

const variationRows = readCsv('variations.csv');
const phenotypeRows = readCsv('phenotypes.csv');
const alleleRows = readCsv('alleles.csv');
const exprRows = readCsv('allele_exprs.csv');
const relationRows = readCsv('expr_relations.csv');

const phenotypes = new Map<string, Phenotype>(
  phenotypeRows.map((row) => [
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

const variations = new Map<string, Variation>(
  variationRows.map((row) => [
    row.alleleName,
    new Variation({
      name: row.alleleName,
      chromosome: row.chromosome as ChromosomeName,
      physLoc: Number(row.physLoc),
      geneticLoc: Number(row.geneticLoc),
      recombination: [
        Number(row.recombSuppressorStart),
        Number(row.recombSuppressorEnd),
      ],
    }),
  ])
);

const alleles = new Map<string, Allele>(
  alleleRows.map((row) => {
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
        variation: variations.get(row.variationName),
        contents: row.contents === '' ? undefined : row.contents,
        alleleExpressions: expressions,
      }),
    ];
  })
);

// Group each variant's two halves: "eT1[let-500(s2165)](III)" -> label
// "eT1[let-500(s2165)]", chromosome III.
const variants = new Map<string, Allele[]>();
alleles.forEach((allele, name) => {
  const label = /^(.*)\((?:IV|V|III|II|I|X)\)$/.exec(name)?.[1] ?? name;
  variants.set(label, [...(variants.get(label) ?? []), allele]);
});

const withCopies = (halves: Allele[], copies: number[]): Strain =>
  new Strain({
    allelePairs: halves.flatMap((allele, i) =>
      copies[i] === 0
        ? []
        : [copies[i] === 1 ? allele.toTopHet() : allele.toHomo()]
    ),
  });

const isVariantLethal = (allele: Allele): boolean =>
  allele.alleleExpressions.some((expr) =>
    expr.expressingPhenotype.name.endsWith(' homozygous lethal')
  );

describe('generated translocation data', () => {
  // The bracket variants (eT1[let-500(s2165)] ...) are entered as strains with
  // real alleles, not generated, so each family is just its plain balancer.
  test('has every family as a plain balancer, and no bracket variants', () => {
    expect([...variants.keys()].sort()).toEqual(
      ['eT1', 'nT1', 'hT2', 'szT1', 'hT3', 'mT1', 'hT1'].sort()
    );
  });

  const twoHalf = [...variants.entries()].filter(
    ([, halves]) => halves.length === 2
  );

  test.each(twoHalf)(
    '%s: lethal exactly when the halves are unequal or its own lethal allele is homozygous',
    (_label, halves) => {
      [0, 1, 2].forEach((c1) => {
        [0, 1, 2].forEach((c2) => {
          const strain = withCopies(halves, [c1, c2]);
          const ownLethal = halves.some(
            (half, i) => isVariantLethal(half) && [c1, c2][i] === 2
          );
          expect(
            strain.isLethal(),
            `${halves.map((h) => h.name).join(' / ')} copies ${c1},${c2}`
          ).toBe(c1 !== c2 || ownLethal);
          expect(strain.getUnresolvedExprPhenotypes()).toEqual([]);
        });
      });
    }
  );

  test('every half sits at the boundary of its suppressed range, inside the chromosome', () => {
    variations.forEach((variation) => {
      const [start, end] = variation.recombination ?? [0, 0];
      expect([start, end]).toContain(variation.physLoc);
      expect(variation.geneticLoc).toBeDefined();
    });
  });

  test('copy markers are wild, so they never show on a card', () => {
    const eT1 = alleles.get('eT1(III)');
    const strain = new Strain({
      allelePairs: [
        eT1?.toTopHet() as AllelePair,
        alleles.get('eT1(V)')?.toTopHet() as AllelePair,
      ],
    });
    strain.refreshCardInfo();
    expect(strain.exprPhenotypeNames).toEqual([]);
  });
});
