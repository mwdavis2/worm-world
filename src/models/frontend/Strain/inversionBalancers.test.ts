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
const dir = (file: string): Row[] =>
  readCsv(`data/inversion_balancers/${file}`);

const genes = new Map<string, Gene>(
  [
    ...readCsv('src-tauri/seed/genes.csv'),
    ...readCsv('data/wormbase/uncloned_genes.csv'),
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
            requiredConditions: relationRows
              .filter(
                (rel) =>
                  rel.allele_name === row.name &&
                  rel.expressing_phenotype_name ===
                    expr.expressingPhenotypeName &&
                  rel.expressing_phenotype_wild ===
                    expr.expressingPhenotypeWild &&
                  rel.altering_condition !== '' &&
                  rel.is_suppressing === '0'
              )
              .map((rel) => new Condition({ name: rel.altering_condition })),
            suppressingPhenotypes: relationRows
              .filter(
                (rel) =>
                  rel.allele_name === row.name &&
                  rel.expressing_phenotype_name ===
                    expr.expressingPhenotypeName &&
                  rel.expressing_phenotype_wild ===
                    expr.expressingPhenotypeWild &&
                  rel.altering_phenotype_name !== '' &&
                  rel.is_suppressing === '1'
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

const strainRows = dir('strains.csv');
const strainAlleleRows = dir('strain_alleles.csv');

// A strain as stored: an allele on both homologs, on the top only, or on the
// bottom only. `forceHomozygous` builds the homozygous version of any strain.
const buildStrain = (name: string, forceHomozygous = false): Strain =>
  new Strain({
    name,
    allelePairs: strainAlleleRows
      .filter((row) => row.strainName === name)
      .map((row) => {
        const allele = alleles.get(row.alleleName);
        if (allele === undefined)
          throw new Error(`${name}: missing allele ${row.alleleName}`);
        if (
          forceHomozygous ||
          (row.isOnTop === 'true' && row.isOnBot === 'true')
        )
          return allele.toHomo();
        return row.isOnTop === 'true' ? allele.toTopHet() : allele.toBotHet();
      }),
  });

const dejimaStrains = strainRows.filter((row) => /^FX\d+$/.test(row.name));

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

describe('the classical balancers', () => {
  test.each([['sC4', 'unc-76', 'rol-9']])(
    '%s covers the region from %s to %s',
    (balancer, left, right) => {
      const [l, r] = [
        geneByName(left).physLoc ?? 0,
        geneByName(right).physLoc ?? 0,
      ];
      expect(variations.get(balancer)?.recombination).toEqual([
        Math.min(l, r),
        Math.max(l, r),
      ]);
    }
  );

  test.each([
    ['sC1', [323_321, 4_641_137]],
    ['mnC1', [4_904_692, 14_909_258]],
    ['qC1', [1_286_123, 13_737_951]],
  ])('%s covers its sequenced breakpoints', (balancer, range) => {
    expect(variations.get(balancer)?.recombination).toEqual(range);
  });

  test('the balancer alleles are named as the strains write them', () => {
    expect(alleles.get('sC4(s2172)')?.variation?.name).toBe('sC4');
    expect(alleles.get('sC1(s2023)')?.variation?.name).toBe('sC1');
  });

  test('sC4(s2172) is homozygous lethal on its own, sC1(s2023) is not', () => {
    const lethalAs = (name: string): boolean =>
      new Strain({
        allelePairs: [alleles.get(name)?.toHomo() as never],
      }).isLethal();
    expect(lethalAs('sC4(s2172)')).toBe(true);
    expect(lethalAs('sC1(s2023)')).toBe(false);
  });

  test('CGC51 is homozygous and the other three are balancer-over-partner heterozygotes', () => {
    const rowsOf = (name: string): Row[] =>
      strainAlleleRows.filter((row) => row.strainName === name);
    rowsOf('CGC51').forEach((row) => {
      expect([row.isOnTop, row.isOnBot]).toEqual(['true', 'true']);
    });
    ['BC4586', 'CGC43', 'BG99'].forEach((name) => {
      const onTop = rowsOf(name).filter((row) => row.isOnTop === 'true');
      const onBot = rowsOf(name).filter((row) => row.isOnBot === 'true');
      expect(onTop.length, name).toBeGreaterThan(0);
      expect(onBot.length, name).toBeGreaterThan(0);
      // nothing is on both homologs
      expect(rowsOf(name).some((row) => row.isOnTop === row.isOnBot)).toBe(
        false
      );
    });
  });

  test('the partner alleles are on the other homolog from the balancer', () => {
    const side = (strain: string, allele: string): string => {
      const row = strainAlleleRows.find(
        (r) => r.strainName === strain && r.alleleName === allele
      );
      return row?.isOnTop === 'true' ? 'top' : 'bottom';
    };
    expect(side('BC4586', 'sC4(s2172)')).toBe('top');
    expect(side('BC4586', 'e428')).toBe('top');
    expect(side('BC4586', 'e911')).toBe('bottom');
    expect(side('BC4586', 'sc148')).toBe('bottom');
    expect(side('CGC43', 'mnC1')).toBe('top');
    expect(side('CGC43', 'e120')).toBe('bottom');
    expect(side('BG99', 'qC1')).toBe('top');
    expect(side('BG99', 'q267')).toBe('bottom');
  });

  test('the transgenes carry their marker and neomycin resistance', () => {
    ['umnIs32', 'umnIs41'].forEach((name) => {
      const phenotypeNames = (alleles.get(name)?.alleleExpressions ?? []).map(
        (expr) => expr.expressingPhenotype.name
      );
      expect(phenotypeNames).toContain('NeomycinR');
      expect(phenotypeNames.some((p) => p.startsWith('Pmyo-2::'))).toBe(true);
    });
    expect(
      alleles
        .get('umnIs41')
        ?.alleleExpressions.map((e) => e.expressingPhenotype.name)
    ).toContain('Pmyo-2::mKate2');
  });
});

describe('generated inversion balancer strains', () => {
  test('there are 25 Dejima strains, each with its balancer and a Pmyo-2 marker', () => {
    expect(dejimaStrains).toHaveLength(25);
    dejimaStrains.forEach((row) => {
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
