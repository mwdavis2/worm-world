// Allele conversions: in a germline that expresses a driver phenotype (Cre,
// Flp, ...) each copy of a source allele becomes its product allele with the
// rule's chance. The alleles here are made up for the tests.
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { type db_Allele } from 'models/db/db_Allele';
import { type db_Variation } from 'models/db/db_Variation';
import { type ChromosomeName } from 'models/db/filter/db_ChromosomeName';
import { NodeType, Sex } from 'models/enums';
import { Allele } from 'models/frontend/Allele/Allele';
import { AlleleConversion } from 'models/frontend/AlleleConversion/AlleleConversion';
import { AlleleExpression } from 'models/frontend/AlleleExpression/AlleleExpression';
import { AllelePair } from 'models/frontend/AllelePair/AllelePair';
import { Phenotype } from 'models/frontend/Phenotype/Phenotype';
import {
  conversionOutcomes,
  MAX_GERMLINE_VARIANTS,
  Strain,
} from 'models/frontend/Strain/Strain';
import { Variation } from 'models/frontend/Variation/Variation';
import { getCardPhenotypes } from 'models/frontend/CrossDesign/motherPhenotypes';
import { StrainFilter } from 'models/frontend/StrainFilter/StrainFilter';
import { type Edge, type Node } from 'reactflow';

const variationOf = (
  name: string,
  chromosome: ChromosomeName,
  physLoc = 1000
): Variation =>
  new Variation({ name, chromosome, physLoc, geneticLoc: physLoc / 1000 });

const dbVariation = (v: Variation): db_Variation => ({
  alleleName: v.name,
  chromosome: v.chromosome ?? null,
  physLoc: v.physLoc ?? null,
  geneticLoc: v.geneticLoc ?? null,
  recombSuppressor: null,
  isLocationReference: false,
  percentLoss: null,
});

const rule = (
  productName: string,
  percentConversion = 100,
  driverName = 'Cre'
): AlleleConversion =>
  new AlleleConversion({
    productName,
    driverName,
    driverWild: true,
    percentConversion,
  });

const creExpr = (alleleName: string): AlleleExpression =>
  new AlleleExpression({
    alleleName,
    expressingPhenotype: new Phenotype({
      name: 'Cre',
      shortName: 'Cre',
      wild: true,
    }),
    requiredPhenotypes: [],
    suppressingPhenotypes: [],
    requiredConditions: [],
    suppressingConditions: [],
    dominance: '1or2',
  });

// the floxed allele and its product are alleles of one variation, on III
const flox = variationOf('vFlox', 'III');
const floxed = (conversions: AlleleConversion[]): Allele =>
  new Allele({ name: 'floxed', variation: flox, conversions });
// a transgene whose germline expresses Cre
const creLine = new Allele({
  name: 'creLine',
  variation: variationOf('vCre', 'IV'),
  alleleExpressions: [creExpr('creLine')],
});

/** the database as the cross sees it: the product alleles it loads by name */
const mockDatabase = (
  products: Array<{ allele: db_Allele; variation: Variation }>,
  conversions: Record<string, unknown[]> = {}
): void => {
  mockIPC((cmd, args) => {
    const filter = (args as { filter?: { filters: unknown[][][] } }).filter;
    const wanted = JSON.stringify(filter?.filters ?? []);
    switch (cmd) {
      case 'get_filtered_strain_alleles':
        return [];
      case 'get_filtered_alleles':
        return products
          .filter((p) => wanted.includes(`"${p.allele.name}"`))
          .map((p) => p.allele);
      case 'get_filtered_variations':
        return products
          .filter((p) => wanted.includes(`"${p.variation.name}"`))
          .map((p) => dbVariation(p.variation));
      case 'get_filtered_allele_conversions': {
        const found = Object.keys(conversions).find((name) =>
          wanted.includes(`"${name}"`)
        );
        return found === undefined ? [] : conversions[found];
      }
      default:
        return [];
    }
  });
};

const excisedRecord = {
  allele: {
    name: 'excised',
    contents: null,
    sysGeneName: null,
    variationName: 'vFlox',
  } satisfies db_Allele,
  variation: flox,
};

describe('conversionOutcomes', () => {
  test('one rule: converts with its chance, else stays', () => {
    expect(conversionOutcomes([rule('p', 40)])).toEqual([
      { productName: 'p', prob: 0.4 },
      { productName: undefined, prob: 0.6 },
    ]);
  });

  test('100% leaves no chance of staying', () => {
    expect(conversionOutcomes([rule('p', 100)])).toEqual([
      { productName: 'p', prob: 1 },
    ]);
  });

  test('two rules apply in order, each on what the one before left', () => {
    const outcomes = conversionOutcomes([rule('b', 50, 'Flp'), rule('a', 50)]);
    // sorted by product: a first (50%), then b (50% of the remaining 50%)
    expect(outcomes).toEqual([
      { productName: 'a', prob: 0.5 },
      { productName: 'b', prob: 0.25 },
      { productName: undefined, prob: 0.25 },
    ]);
  });

  test('two drivers for the same product combine as independent chances', () => {
    const outcomes = conversionOutcomes([
      rule('p', 50, 'Cre'),
      rule('p', 50, 'Flp'),
    ]);
    expect(outcomes).toEqual([
      { productName: 'p', prob: 0.75 },
      { productName: undefined, prob: 0.25 },
    ]);
  });
});

describe('crossing with conversions', () => {
  beforeEach(() => {
    mockDatabase([excisedRecord]);
  });
  afterEach(() => {
    clearMocks();
  });

  const allele = floxed([rule('excised')]);
  const homo = (extra: Allele[] = []): Strain =>
    new Strain({
      allelePairs: [allele.toHomo(), ...extra.map((a) => a.toHomo())],
    });

  test('without a rule nothing changes', async () => {
    const plain = new Strain({ allelePairs: [floxed([]).toTopHet()] });
    const children = await plain.selfCross();
    // three classes, 1/4, 1/2 and 1/4, none of them with a product
    expect(children).toHaveLength(3);
    expect(children.every((c) => !c.toString().includes('excised'))).toBe(true);
    expect(
      children.map((c) => c.probability ?? 0).sort((a, b) => a - b)
    ).toEqual([0.25, 0.25, 0.5]);
  });

  test('a rule whose driver is not expressed does nothing', async () => {
    const children = await homo().selfCross();
    expect(children).toHaveLength(1);
    expect(children[0].toString()).not.toContain('excised');
    expect(children[0].probability).toBe(1);
  });

  test('with the driver expressed, every copy converts at 100%', async () => {
    const children = await homo([creLine]).selfCross();
    expect(children).toHaveLength(1);
    const alleleNames = children[0].getAlleles().map((a) => a.name);
    expect(alleleNames.filter((n) => n === 'excised')).toHaveLength(2);
    expect(alleleNames).not.toContain('floxed');
    expect(children[0].probability).toBeCloseTo(1);
  });

  test('at 50% a homozygote selfed gives 1/4 source, 1/2 mixed, 1/4 product', async () => {
    const half = floxed([rule('excised', 50)]);
    const parent = new Strain({
      allelePairs: [half.toHomo(), creLine.toHomo()],
    });
    const children = await parent.selfCross();
    const byProduct = (n: number): number =>
      children
        .filter(
          (c) => c.getAlleles().filter((a) => a.name === 'excised').length === n
        )
        .reduce((sum, c) => sum + (c.probability ?? 0), 0);
    expect(byProduct(0)).toBeCloseTo(0.25);
    expect(byProduct(1)).toBeCloseTo(0.5);
    expect(byProduct(2)).toBeCloseTo(0.25);
  });

  test('only the parent whose germline expresses the driver converts its own copies', async () => {
    // a hermaphrodite with floxed and Cre, crossed to a wild male
    const herm = new Strain({
      allelePairs: [allele.toHomo(), creLine.toTopHet()],
    });
    const male = new Strain({ allelePairs: [], sex: Sex.Male });
    const children = await herm.crossWith(male);
    const withProduct = children.filter((c) =>
      c.getAlleles().some((a) => a.name === 'excised')
    );
    expect(withProduct.length).toBeGreaterThan(0);
    expect(children.every((c) => !c.toString().includes('floxed'))).toBe(true);

    // the same floxed hermaphrodite with a Cre MALE: her germline has no Cre
    const creMale = new Strain({
      allelePairs: [creLine.toTopHet()],
      sex: Sex.Male,
    });
    const plainHerm = new Strain({ allelePairs: [allele.toHomo()] });
    const other = await plainHerm.crossWith(creMale);
    expect(other.every((c) => !c.toString().includes('excised'))).toBe(true);
  });

  test('a driver given through the cross context activates the rule', async () => {
    const parent = homo();
    const without = await parent.selfCross();
    expect(without[0].toString()).not.toContain('excised');
    const driven = await parent.selfCross(new Set(['Cre (wild)']));
    expect(driven[0].getAlleles().map((a) => a.name)).toContain('excised');

    // and a context that does not list the driver switches it off even when
    // the parent's own genotype would have expressed it
    const cre = homo([creLine]);
    const off = await cre.selfCross(new Set());
    expect(off[0].toString()).not.toContain('excised');
  });

  test('a male X-linked source is one hemizygous copy, and the absent X never converts', async () => {
    const xVariation = variationOf('vFloxX', 'X');
    const xFloxed = new Allele({
      name: 'floxedX',
      variation: xVariation,
      conversions: [rule('excisedX', 50)],
    });
    mockDatabase([
      {
        allele: {
          name: 'excisedX',
          contents: null,
          sysGeneName: null,
          variationName: 'vFloxX',
        },
        variation: xVariation,
      },
    ]);
    const male = new Strain({
      allelePairs: [new AllelePair({ top: xFloxed, bot: xFloxed.toAbsent() })],
      sex: Sex.Male,
    });
    const herm = new Strain({ allelePairs: [] });
    const children = await male.crossWith(herm, {
      thisPhenotypes: new Set(['Cre (wild)']),
    });
    const hermaphrodites = children.filter((c) => c.sex === Sex.Hermaphrodite);
    const sons = children.filter((c) => c.sex === Sex.Male);
    // his X reaches half the children, converted half of the time: 1/4 each
    expect(
      hermaphrodites
        .filter((c) => c.getAlleles().some((a) => a.name === 'floxedX'))
        .reduce((sum, c) => sum + (c.probability ?? 0), 0)
    ).toBeCloseTo(0.25);
    expect(
      hermaphrodites
        .filter((c) => c.getAlleles().some((a) => a.name === 'excisedX'))
        .reduce((sum, c) => sum + (c.probability ?? 0), 0)
    ).toBeCloseTo(0.25);
    // sons get no X from him, so nothing of his converts into them
    expect(
      sons.every((c) => c.getAlleles().every((a) => a.name !== 'excisedX'))
    ).toBe(true);
  });

  test('an extrachromosomal array converts like any copy', async () => {
    const exVariation = variationOf('vEx', 'Ex');
    const array = new Allele({
      name: 'oxEx1',
      variation: exVariation,
      conversions: [rule('oxEx1d')],
    });
    mockDatabase([
      {
        allele: {
          name: 'oxEx1d',
          contents: null,
          sysGeneName: null,
          variationName: 'vEx',
        },
        variation: exVariation,
      },
    ]);
    const parent = new Strain({
      allelePairs: [array.toTopHet(), creLine.toHomo()],
    });
    const children = await parent.crossWith(new Strain({ allelePairs: [] }), {
      thisPhenotypes: new Set(['Cre (wild)']),
    });
    const names = children.flatMap((c) => c.getAlleles().map((a) => a.name));
    expect(names).toContain('oxEx1d');
    expect(names).not.toContain('oxEx1');
  });

  test('a product that has rules of its own does not convert again in the same cross', async () => {
    mockDatabase([excisedRecord], {
      excised: [
        {
          sourceAllele: 'excised',
          productAllele: 'again',
          driverPhenotypeName: 'Cre',
          driverPhenotypeWild: true,
          percentConversion: 100,
          description: null,
        },
      ],
    });
    const children = await homo([creLine]).selfCross();
    const alleleNames = children[0].getAlleles().map((a) => a.name);
    expect(alleleNames).toContain('excised');
    expect(alleleNames).not.toContain('again');
  });

  test('too many convertible copies in one parent is refused with a reason', async () => {
    const loci = Array.from({ length: 5 }, (_, i) => {
      const v = variationOf(`vMany${i}`, 'III', 2000 + i * 100);
      return new Allele({
        name: `many${i}`,
        variation: v,
        conversions: [rule(`many${i}p`, 50)],
      });
    });
    const parent = new Strain({
      allelePairs: [...loci.map((a) => a.toHomo()), creLine.toHomo()],
    });
    expect(MAX_GERMLINE_VARIANTS).toBe(256);
    await expect(parent.selfCross()).rejects.toThrow(
      /too many convertible alleles/
    );
  });

  // Maternally loaded Cre as the placeholder pattern: the child expresses
  // "Cre-loaded" because its mother expresses Cre, and that phenotype is the
  // driver of its own germline rule. The editor passes what each parent card
  // expresses (with its mother), so the rule fires for the child's own cross.
  test("a driver that exists only through the parent's mother converts through the editor's phenotype sets", async () => {
    const loaded = new Phenotype({
      name: 'Cre-loaded',
      shortName: 'Cre-loaded',
      wild: false,
    });
    const placeholder = new AlleleExpression({
      alleleName: 'floxed',
      expressingPhenotype: loaded,
      requiredPhenotypes: [],
      suppressingPhenotypes: [],
      requiredConditions: [],
      suppressingConditions: [],
      maternalRequiredPhenotypes: [
        new Phenotype({ name: 'Cre', shortName: 'Cre', wild: true }),
      ],
      dominance: '1or2',
    });
    const loadedFloxed = new Allele({
      name: 'floxed',
      variation: flox,
      alleleExpressions: [placeholder],
      conversions: [
        new AlleleConversion({
          productName: 'excised',
          driverName: 'Cre-loaded',
          driverWild: false,
          percentConversion: 100,
        }),
      ],
    });
    const motherStrain = new Strain({
      allelePairs: [loadedFloxed.toHomo(), creLine.toTopHet()],
    });
    const childStrain = new Strain({
      allelePairs: [loadedFloxed.toHomo()],
      isChild: true,
    });
    const nodes: Node[] = [
      {
        id: 'p',
        type: NodeType.Strain,
        position: { x: 0, y: 0 },
        data: motherStrain,
      },
      {
        id: 'm',
        type: NodeType.Self,
        position: { x: 0, y: 0 },
        data: new StrainFilter(),
      },
      {
        id: 'c',
        type: NodeType.Strain,
        position: { x: 0, y: 0 },
        parentNode: 'm',
        data: childStrain,
      },
    ];
    const edges: Edge[] = [{ id: 'e', source: 'p', target: 'm' }];

    const set = getCardPhenotypes(nodes[2] as Node<Strain>, nodes, edges);
    expect(set.has('Cre-loaded')).toBe(true);

    // on its own, with no mother, the child does not express the driver
    const alone = await childStrain.selfCross();
    expect(alone[0].toString()).not.toContain('excised');
    // with what the graph says it expresses, its germline converts
    const converted = await childStrain.selfCross(set);
    expect(converted[0].getAlleles().map((a) => a.name)).toContain('excised');
  });
});
