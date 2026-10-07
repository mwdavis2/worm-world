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
// e1107 (tra-3), e12 (dpy-9), ox1059 (kin-4), oxIs644, oxTi302, oxTi75,
// oxSi1168 and oxEx2254 exist only in the live database, so the test supplies
// stand-ins for them (recessive and rescued, as in the database).
const STAND_INS: Record<string, Row[]> = {
  'variations.csv': [
    { alleleName: 'oxIs644', chromosome: 'IV', physLoc: '', geneticLoc: '0' },
    {
      alleleName: 'oxTi302',
      chromosome: 'I',
      physLoc: '10166156',
      geneticLoc: '',
    },
    {
      alleleName: 'oxTi75',
      chromosome: 'II',
      physLoc: '5448561',
      geneticLoc: '',
    },
    {
      alleleName: 'oxSi1168',
      chromosome: 'II',
      physLoc: '8420158',
      geneticLoc: '',
    },
    { alleleName: 'oxEx2254', chromosome: 'Ex', physLoc: '', geneticLoc: '' },
  ],
  'phenotypes.csv': [
    { name: 'Tra-3', wild: '0', short_name: 'Tra-3', lethal: '0' },
    { name: 'tra-3', wild: '1', short_name: 'tra-3', lethal: '' },
    { name: 'Dpy-9', wild: '0', short_name: 'Dpy-9', lethal: '0' },
    { name: 'dpy-9', wild: '1', short_name: 'dpy-9', lethal: '' },
    { name: 'mCherry', wild: '0', short_name: 'mCherry', lethal: '0' },
    {
      name: 'mScarlet(coel)',
      wild: '0',
      short_name: 'mScarlet(coel)',
      lethal: '0',
    },
    {
      name: 'YFP(pharynx)',
      wild: '0',
      short_name: 'YFP(pharynx)',
      lethal: '0',
    },
  ],
  'alleles.csv': [
    {
      name: 'oxIs644',
      contents: '',
      sysGeneName: '',
      variationName: 'oxIs644',
    },
    { name: 'e1107', contents: '', sysGeneName: 'LLC1.1', variationName: '' },
    { name: 'e12', contents: '', sysGeneName: 'T21D12.2', variationName: '' },
    { name: 'ox1059', contents: '', sysGeneName: 'C10C6.1', variationName: '' },
    {
      name: 'oxTi302',
      contents: '',
      sysGeneName: '',
      variationName: 'oxTi302',
    },
    { name: 'oxTi75', contents: '', sysGeneName: '', variationName: 'oxTi75' },
    {
      name: 'oxSi1168',
      contents: '',
      sysGeneName: '',
      variationName: 'oxSi1168',
    },
    {
      name: 'oxEx2254',
      contents: '',
      sysGeneName: '',
      variationName: 'oxEx2254',
    },
  ],
  'allele_exprs.csv': [
    {
      alleleName: 'e1107',
      expressingPhenotypeName: 'Tra-3',
      expressingPhenotypeWild: '0',
      dominance: '4',
    },
    {
      alleleName: 'e12',
      expressingPhenotypeName: 'Dpy-9',
      expressingPhenotypeWild: '0',
      dominance: '4',
    },
    {
      alleleName: 'oxTi302',
      expressingPhenotypeName: 'mCherry',
      expressingPhenotypeWild: '0',
      dominance: '2',
    },
    {
      alleleName: 'oxEx2254',
      expressingPhenotypeName: 'Flp',
      expressingPhenotypeWild: '1',
      dominance: '2',
    },
    {
      alleleName: 'oxEx2254',
      expressingPhenotypeName: 'mScarlet(coel)',
      expressingPhenotypeWild: '0',
      dominance: '2',
    },
  ],
  'expr_relations.csv': [
    {
      allele_name: 'e1107',
      expressing_phenotype_name: 'Tra-3',
      expressing_phenotype_wild: '0',
      altering_phenotype_name: 'tra-3',
      altering_phenotype_wild: '1',
      altering_condition: '',
      is_suppressing: '1',
    },
    {
      allele_name: 'e12',
      expressing_phenotype_name: 'Dpy-9',
      expressing_phenotype_wild: '0',
      altering_phenotype_name: 'dpy-9',
      altering_phenotype_wild: '1',
      altering_condition: '',
      is_suppressing: '1',
    },
  ],
};
const both = (file: string): Row[] => [
  ...readCsv(`data/balancer_alleles/${file}`),
  ...readCsv(`data/translocations/${file}`),
  ...readCsv(`data/lin_15/${file}`),
  ...(STAND_INS[file] ?? []),
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
      femaleSterile: row.female_sterile === '1',
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
const alleles = new Map<string, Allele>(both('alleles.csv').map(makeAllele));

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
        if (row.isOnTop === 'true' && row.isOnBot === 'true')
          return allele.toHomo();
        return row.isOnTop === 'true' ? allele.toTopHet() : allele.toBotHet();
      }),
  });
const nonWildNames = (strain: Strain, conditions: string[]): string[] =>
  strain
    .getExprPhenotypes([], new Set(conditions))
    .filter((phenotype) => !phenotype.wild)
    .map((phenotype) => phenotype.name);

describe('generated lin-15 and marker strains', () => {
  test('there are 23 strains; only the array strains and the nT1 strain have a one-homolog allele', () => {
    expect(strainRows.map((row) => row.name)).toEqual([
      'EG1306',
      'EG5071',
      'EG9934',
      'EG1000',
      'EG1020',
      '154',
      '155',
      'DA438',
      'NK785',
      'EG3123',
      'CB3988',
      'CB2223',
      'EG10401',
      'EG10402',
      'EG10403',
      'EG10404',
      'EG10405',
      'EG10406',
      'EG10105',
      'EG10114',
      'EG9965',
      'EG7841',
      'EG7764',
    ]);
    const heterozygous = new Set(
      strainAlleleRows
        .filter((row) => row.isOnTop !== row.isOnBot)
        .map((row) => row.strainName)
    );
    expect([...heterozygous]).toEqual(['NK785', 'CB3988', 'EG10105']);
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
      expect.arrayContaining([
        'Bli-4',
        'Rol-6',
        'Vab-7',
        'Unc-31',
        'Dpy-11',
        'Lon-2',
      ])
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

describe('the second batch of strains', () => {
  test('dpy-4(e1166sd) is weak at one copy, strong at two, and rescued by the wild type', () => {
    const one = new Strain({
      allelePairs: [alleles.get('e1166sd')?.toTopHet() as never],
    });
    const two = new Strain({
      allelePairs: [alleles.get('e1166sd')?.toHomo() as never],
    });
    expect(nonWildNames(one, [])).toEqual(['Dpy-4(weak)']);
    expect(nonWildNames(two, [])).toEqual(['Dpy-4(strong)']);
  });

  test('dpy-13(ox496) carries NeoR and resists neomycin only on the drug', () => {
    const row = both('alleles.csv').find((r) => r.name === 'ox496');
    expect(row?.contents).toBe('[NeoR]');
    const strain = new Strain({
      allelePairs: [alleles.get('ox496')?.toHomo() as never],
    });
    expect(nonWildNames(strain, [])).toContain('Dpy-13');
    expect(strain.isLethal([], new Set(['Neomycin']))).toBe(false);
    expect(nonWildNames(strain, ['Neomycin'])).toContain('NeomycinR');
  });

  test('qyEx127 rescues unc-119(ed4) and marks the animal with Pced-5::GFP', () => {
    const strain = buildStrain('NK785');
    expect(strain.toString()).toBe('unc-119(ed4) III; qyEx127/+ Ex.');
    expect(nonWildNames(strain, [])).not.toContain('Unc-119');
    expect(nonWildNames(strain, [])).toContain('Pced-5::GFP');
  });

  test('CB3988 is tra-3(e1107) over the whole nT1 translocation', () => {
    const strain = buildStrain('CB3988');
    expect(strain.toString()).toBe(
      'nT1(IV) egl-18(nT1vul) +/+ + tra-3(e1107) IV; nT1(V)/+ V.'
    );
    expect(strain.isLethal()).toBe(false);
  });
});

describe('the alleles that had no phenotype', () => {
  test.each([
    ['e138', 'Unc-24'],
    ['hd43', 'Fbl-1'],
    ['e1415', 'Dpy-20'],
  ])(
    '%s is a recessive %s: shown when homozygous, not when heterozygous',
    (allele, phenotype) => {
      const homo = new Strain({
        allelePairs: [alleles.get(allele)?.toHomo() as never],
      });
      const het = new Strain({
        allelePairs: [alleles.get(allele)?.toTopHet() as never],
      });
      expect(nonWildNames(homo, [])).toContain(phenotype);
      expect(nonWildNames(het, [])).not.toContain(phenotype);
    }
  );

  test('n498 is semidominant: weak at one copy, strong at two', () => {
    const copies = (strain: Strain): string[] => nonWildNames(strain, []);
    const one = new Strain({
      allelePairs: [alleles.get('n498')?.toTopHet() as never],
    });
    const two = new Strain({
      allelePairs: [alleles.get('n498')?.toHomo() as never],
    });
    expect(copies(one)).toEqual(['Unc-43_paralyzed(weak)']);
    expect(copies(two)).toEqual(['Unc-43_paralyzed']);
  });

  test('hd43 is female sterile and e1415 (unlike e1282) is not temperature sensitive', () => {
    expect(phenotypeOf('Fbl-1', '0').femaleSterile).toBe(true);
    const only = (allele: string): Strain =>
      new Strain({ allelePairs: [alleles.get(allele)?.toHomo() as never] });
    expect(nonWildNames(only('e1415'), [])).toContain('Dpy-20');
    expect(nonWildNames(only('e1282'), [])).not.toContain('Dpy-20');
    expect(nonWildNames(only('e1282'), ['25C'])).toContain('Dpy-20');
  });
});

describe('the demo-dataset strains', () => {
  const shown = (strain: string, conditions: string[] = []): string[] =>
    nonWildNames(buildStrain(strain), conditions);

  test('oxIs644 is dark alone and shows citrine::NLS only with Flp from oxEx2254', () => {
    expect(shown('EG9934')).not.toContain('Peft-3::citrine::NLS');
    expect(shown('EG10105')).toContain('Peft-3::citrine::NLS');
  });

  test('EG10105: oxEx2254 rescues unc-119(ed3) and marks with mScarlet', () => {
    expect(shown('EG10105')).not.toContain('Unc-119');
    expect(shown('EG10105')).toContain('mScarlet(coel)');
  });

  test('oxEx2254 carries NeoR and rescues on neomycin', () => {
    const names = (alleles.get('oxEx2254')?.alleleExpressions ?? []).map(
      (expr) => expr.expressingPhenotype.name
    );
    expect(names).toContain('NeomycinR');
    expect(names).toContain('Unc-119');
  });

  test('oxTi302 rescues unc-119(ed3) and oxTi75 rescues unc-18(md299)', () => {
    expect(shown('EG7841')).not.toContain('Unc-119');
    expect(shown('EG7841')).toContain('mCherry');
    expect(shown('EG7764')).not.toContain('Unc-18');
    expect(shown('EG7764')).toContain('Peft-3::GFP::H2B');
  });

  test('oxSi1168 has no phenotype of its own, so EG9965 still shows Unc-119', () => {
    expect(shown('EG9965')).toContain('Unc-119');
    expect(shown('EG9965')).toContain('Pmyo-2::nls-CyOFP');
  });

  test('F53A2.9(oxTi1127) carries its contents text', () => {
    const row = both('alleles.csv').find((r) => r.name === 'oxTi1127');
    expect(row?.contents).toContain('Cas9');
    expect(row?.contents).toContain('lox2272');
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

  test('EG5071 is unc-119(ed3) rescued by oxIs363, inserted at the cxTi10882 site', () => {
    const strain = buildStrain('EG5071');
    expect(strain.toString()).toBe('unc-119(ed3) III; oxIs363 IV.');
    expect(nonWildNames(strain, [])).not.toContain('Unc-119');
    expect(nonWildNames(strain, [])).toContain('Punc-122::GFP');
    expect(variations.get('oxIs363')?.physLoc).toBe(4_237_767);
  });

  test('EG9934 is oxIs644 on IV over lin-15(n765ts) on X, rescued at 25C', () => {
    const strain = buildStrain('EG9934');
    expect(strain.toString()).toBe('oxIs644 IV; lin-15(n765ts) X.');
    expect(nonWildNames(strain, ['25C'])).not.toContain('Lin-15');
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
