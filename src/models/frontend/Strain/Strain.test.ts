import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import * as alleles from 'models/frontend/Allele/Allele.mock';
import { Allele } from 'models/frontend/Allele/Allele';
import { AllelePair } from 'models/frontend/AllelePair/AllelePair';
import { Strain, type Gamete } from 'models/frontend/Strain/Strain';
import * as strains from 'models/frontend/Strain/Strain.mock';
import { expect, test, describe } from 'vitest';
import {
  ChromosomePair,
  chromsEqual,
} from 'models/frontend/ChromosomePair/ChromosomePair';
import { Phenotype } from 'models/frontend/Phenotype/Phenotype';
import { Condition } from 'models/frontend/Condition/Condition';
import { Variation } from 'models/frontend/Variation/Variation';
import { Gene } from 'models/frontend/Gene/Gene';
import {
  AlleleExpression,
  type AlleleExpressionState,
  type Zygosity,
} from 'models/frontend/AlleleExpression/AlleleExpression';
import { Sex } from 'models/enums';
import { type ChromosomeName } from 'models/db/filter/db_ChromosomeName';

const PRECISION = 6;

function testGametes(actuals: Gamete[], expecteds: Gamete[]): void {
  expect(actuals).toHaveLength(expecteds.length);

  for (let i = 0; i < actuals.length; i++) {
    const expected = expecteds[i];
    const actual = actuals[i];
    expect(
      actual.chromosomes.every((actualChrom, idx) => {
        return chromsEqual(actualChrom, expected.chromosomes[idx]);
      })
    ).toBe(true);
    expect(actual.prob).toBeCloseTo(expected.prob, PRECISION);
  }
}

function testStrains(actualStrains: Strain[], expectedStrains: Strain[]): void {
  expect(actualStrains).toHaveLength(expectedStrains.length);

  for (let i = 0; i < actualStrains.length; i++) {
    const expected = expectedStrains[i];
    const actual = actualStrains[i];
    expect(actual.equals(expected)).toBe(true);
    expect(actual.probability).toBeCloseTo(expected.probability, PRECISION);
  }
}

beforeEach(() => {
  mockIPC((cmd, _) => {
    if (cmd === 'get_filtered_strain_alleles') return [];
  });
});

afterAll(() => {
  clearMocks();
});

describe('strain', () => {
  test('ctor creates correct genotype', () => {
    const strain1 = new Strain({
      allelePairs: [
        alleles.ed3.toWild().toHomo(), // irrelevant to genotype
        alleles.e138.toBotHet(), // Physically first
        alleles.e1282.toTopHet(),
      ],
    });

    expect(strain1.genotype).toEqual('unc-24(e138) +/+ dpy-10(e1282) IV.');
  });

  test('.equals() returns true for strains with homozygous pairs', () => {
    const allelePairs: AllelePair[] = [alleles.e204.toHomo()];
    const strain1 = new Strain({ allelePairs });
    const strain2 = new Strain({ allelePairs });

    expect(strain1.equals(strain2)).toBe(true);
    expect(strain2.equals(strain1)).toBe(true);
  });

  test('.equals() returns true for strains with heterozygous pairs', () => {
    const pairs1: AllelePair[] = [alleles.e204.toTopHet()];
    const pairs2: AllelePair[] = [alleles.e204.toBotHet()];
    const strain1 = new Strain({ allelePairs: pairs1 });
    const strain2 = new Strain({ allelePairs: pairs2 });

    expect(strain1.equals(strain2)).toBe(true);
    expect(strain2.equals(strain1)).toBe(true);
  });

  test('.equals() returns true for complex, multi-chromosomal strains', () => {
    const strainPairs1: AllelePair[] = [
      // Chromosome I
      alleles.oxTi302.toHomo(),
      alleles.jsSi1949.toBotHet(),
      // Chromosome II
      alleles.oxTi75.toHomo(),
      alleles.cn64.toBotHet(),
      alleles.oxSi1168.toBotHet(),
      // Chromosome III
      alleles.ox802.toTopHet(),
      alleles.e873.toTopHet(),
      alleles.ed3.toHomo(),
    ];

    const strain1 = new Strain({ allelePairs: strainPairs1 });
    const strain2 = new Strain({ allelePairs: [...strainPairs1] });

    expect(strain1.equals(strain2)).toBe(true);
    expect(strain2.equals(strain1)).toBe(true);
  });

  test('.equals() returns true for complex strains with flipped chroms', () => {
    const strainPairs1: AllelePair[] = [
      // Chromosome I
      alleles.oxTi302.toHomo(),
      alleles.jsSi1949.toBotHet(),
      // Chromosome II
      alleles.oxTi75.toHomo(),
      alleles.cn64.toBotHet(),
      alleles.oxSi1168.toBotHet(),
      // Chromosome III
      alleles.ox802.toTopHet(),
      alleles.e873.toTopHet(),
      alleles.ed3.toHomo(),
    ];

    const strainPairs2: AllelePair[] = [
      // Chromosome I
      alleles.oxTi302.toHomo(),
      alleles.jsSi1949.toTopHet(), // note the flip here
      // Chromosome II
      alleles.oxTi75.toHomo(),
      alleles.cn64.toTopHet(),
      alleles.oxSi1168.toTopHet(),
      // Chromosome III
      alleles.ox802.toBotHet(),
      alleles.e873.toBotHet(),
      alleles.ed3.toHomo(),
    ];

    const strain1 = new Strain({ allelePairs: strainPairs1 });
    const strain2 = new Strain({ allelePairs: strainPairs2 });

    expect(strain1.equals(strain2)).toBe(true);
    expect(strain2.equals(strain1)).toBe(true);
  });

  test('.equals() returns false for strains with different homozygous pairs', () => {
    const strain1Pairs: AllelePair[] = [alleles.e204.toHomo()];
    const strain2Pairs: AllelePair[] = [alleles.ox802.toHomo()];
    const strain1 = new Strain({ allelePairs: strain1Pairs });
    const strain2 = new Strain({ allelePairs: strain2Pairs });

    expect(strain1.equals(strain2)).toBe(false);
    expect(strain2.equals(strain1)).toBe(false);
  });

  test('.equals() returns false for strains with inconsistently flipped pairs in same chromosome', () => {
    const strainPairs1: AllelePair[] = [
      // Chromosome I
      alleles.oxTi302.toHomo(),
      alleles.jsSi1949.toBotHet(),
      // Chromosome II
      alleles.oxTi75.toHomo(),
      alleles.cn64.toBotHet(),
      alleles.oxSi1168.toBotHet(),
    ];
    const strainPairs2: AllelePair[] = [
      // Chromosome I
      alleles.oxTi302.toHomo(),
      alleles.jsSi1949.toBotHet(),
      // Chromosome II
      alleles.oxTi75.toHomo(),
      alleles.cn64.toTopHet(), // flipped this pair, without flipping the next pair
      alleles.oxSi1168.toBotHet(),
    ];

    const strain1 = new Strain({ allelePairs: strainPairs1 });
    const strain2 = new Strain({ allelePairs: strainPairs2 });

    expect(strain1.equals(strain2)).toBe(false);
    expect(strain2.equals(strain1)).toBe(false);
  });

  test('.clone() creates new instance', () => {
    const strain = new Strain({ allelePairs: [alleles.e204.toHomo()] });
    const clone = strain.clone();

    expect(strain).not.toBe(clone); // distinct objects
    expect(strain.equals(clone)).toBe(true); // data remains the same
  });

  test('.clone() creates new instance from complex strain', () => {
    const pairs: AllelePair[] = [
      // Chromosome I
      alleles.oxTi302.toHomo(),
      alleles.jsSi1949.toBotHet(),
      // Chromosome II
      alleles.oxTi75.toHomo(),
      alleles.cn64.toBotHet(),
      alleles.oxSi1168.toBotHet(),
      // Chromosome III
      alleles.ox802.toTopHet(),
      alleles.e873.toTopHet(),
      alleles.ed3.toHomo(),
    ];
    const strain = new Strain({ allelePairs: pairs });
    const clone = strain.clone();

    expect(strain).not.toBe(clone); // distinct objects
    expect(strain.equals(clone)).toBe(true); // data remains the same
  });

  test('fillWildsFrom() fills nothing when appropriate', () => {
    const before = new Strain({
      allelePairs: [alleles.ed3.toTopHet()],
    });

    const after = before.clone();
    after.fillWildsFrom(before);

    expect(after).toEqual(before);
  });

  test('fillWildsFrom() is idempotent', () => {
    const strain = new Strain({
      allelePairs: [alleles.ed3.toTopHet(), alleles.md299.toWild().toHomo()],
    });

    const before = strain.clone();
    strain.fillWildsFrom(strain);
    expect(before.equals(strain));
  });

  test('fillWildsFrom() fills gaps', () => {
    const strain1 = new Strain({
      allelePairs: [alleles.ed3.toTopHet()],
    });

    const strain2 = new Strain({
      allelePairs: [alleles.md299.toTopHet()],
    });

    strain1.fillWildsFrom(strain2);

    const expected = new Strain({
      allelePairs: [alleles.ed3.toTopHet(), alleles.md299.toWild().toHomo()],
    });

    expect(strain1.equals(expected)).toBe(true);
  });

  test('(De)serializes', () => {
    const strain = new Strain({
      allelePairs: [
        // chrom II
        alleles.oxTi75.toTopHet(),
        alleles.cn64.toHomo(),
        // chrom IV
        alleles.ox802.toTopHet(),
      ],
    });
    const str = strain.toJSON();
    const strainBack = Strain.fromJSON(str);
    expect(strainBack).toEqual(strain);
    expect(strainBack.toJSON).toBeDefined();
    expect(strainBack.chromPairMap).toBeInstanceOf(Map);

    const chromPair = strainBack.chromPairMap?.get('IV');
    expect(chromPair).toEqual(new ChromosomePair([alleles.ox802.toTopHet()]));
    expect(chromPair?.toJSON).toBeDefined();
  });
});

describe('Cross algorithm', () => {
  test('.meiosis() on empty.', () => {
    const gametesEmptyWild = strains.emptyWild.meiosis();
    const expected: Gamete[] = [{ chromosomes: [], prob: 1.0 }];
    expect(gametesEmptyWild).toEqual(expected);
  });

  test('.meiosis() on homozygous.', () => {
    const gametesTN64 = strains.TN64.meiosis();
    const expected: Gamete[] = [{ chromosomes: [[alleles.cn64]], prob: 1.0 }];
    expect(gametesTN64).toEqual(expected);
  });

  test('.meiosis() on heterozygous.', () => {
    const gametes = new Strain({
      allelePairs: [alleles.ed3.toTopHet(), alleles.md299.toTopHet()],
    }).meiosis();
    const expected: Gamete[] = [
      { chromosomes: [[alleles.ed3], [alleles.md299]], prob: 0.25 },
      {
        chromosomes: [[alleles.ed3], [alleles.md299.toWild()]],
        prob: 0.25,
      },
      {
        chromosomes: [[alleles.ed3.toWild()], [alleles.md299]],
        prob: 0.25,
      },
      {
        chromosomes: [[alleles.ed3.toWild()], [alleles.md299.toWild()]],
        prob: 0.25,
      },
    ];
    testGametes(gametes, expected);
  });

  test('fertilize() empty case', async () => {
    const gametes1: Gamete[] = [{ chromosomes: [], prob: 1.0 }];
    const gametes2: Gamete[] = [{ chromosomes: [], prob: 1.0 }];
    const zygotes = await Strain.fertilize(gametes1, gametes2);
    const expected = [new Strain({ allelePairs: [] })];

    testStrains(zygotes, expected);
  });

  test('fertilize() homozygous', async () => {
    const gametes: Gamete[] = [{ chromosomes: [[alleles.cn64]], prob: 1.0 }];
    const zygotes = await Strain.fertilize(gametes);
    const expected: Strain[] = [strains.TN64];

    testStrains(zygotes, expected);
  });

  test('cross between homozygous and wild strain', async () => {
    const homoPairs: AllelePair[] = [alleles.e204.toHomo()];
    const wildPairs: AllelePair[] = [alleles.e204.toWild().toHomo()];

    const homoStrain = new Strain({ allelePairs: homoPairs });
    const wildStrain = new Strain({ allelePairs: wildPairs });
    const crossStrains = await homoStrain.crossWith(wildStrain);
    testStrains(crossStrains, strains.homoWildCross);
  });

  test('cross of homozygous and heterozygous strains', async () => {
    const hetPairs: AllelePair[] = [alleles.e204.toTopHet()];
    const homoPairs: AllelePair[] = [alleles.ox802.toHomo()];

    const hetStrain = new Strain({ allelePairs: hetPairs });
    const homoStrain = new Strain({ allelePairs: homoPairs });
    const crossStrains = await homoStrain.crossWith(hetStrain);
    testStrains(crossStrains, strains.homoHetCross);
  });

  test('self-cross of homozygous pair returns same child strain', async () => {
    const allelePairs: AllelePair[] = [alleles.e204.toHomo()];
    const strain = new Strain({ allelePairs });
    const crossStrains = await strain.selfCross();
    testStrains(crossStrains, strains.homozygousCross);
  });

  test('self-cross of heterozygous pair returns correct strains', async () => {
    const allelePairs: AllelePair[] = [alleles.e204.toTopHet()];
    const strain = new Strain({ allelePairs });
    const crossStrains = await strain.selfCross();
    testStrains(crossStrains, strains.heterozygousCross);
  });

  test('self-cross of chromosome with homozygous and heterozygous pairs', async () => {
    const allelePairs: AllelePair[] = [
      alleles.e204.toHomo(),
      alleles.ox802.toBotHet(),
    ];
    const strain = new Strain({ allelePairs });
    const crossStrains = await strain.selfCross();
    testStrains(crossStrains, strains.homoHetSelfCross);
  });

  test('intermediate self-cross on single chromosome', async () => {
    const allelePairs: AllelePair[] = [
      alleles.e204.toTopHet(),
      alleles.ox802.toBotHet(),
    ];

    const strain = new Strain({ allelePairs });
    const crossStrains = await strain.selfCross();
    testStrains(crossStrains, strains.intermediateSelfCross);
  });

  test('simple self-cross of het alleles on different chromosomes', async () => {
    const allelePairs: AllelePair[] = [
      alleles.ed3.toTopHet(), // chrom III
      alleles.md299.toTopHet(), // chrom X
    ];
    const strain = new Strain({ allelePairs });
    const crossStrains = await strain.selfCross();
    testStrains(crossStrains, strains.difChromSimpleSelfCross);
  });

  test('advanced self-cross on multiple chromosomes', async () => {
    const allelePairs: AllelePair[] = [
      // chrom II
      alleles.cn64.toTopHet(),
      alleles.oxTi75.toTopHet(),
      // chrom III
      alleles.ed3.toTopHet(),
      // chrom IV
      alleles.e53.toHomo(),
      alleles.e204.toTopHet(),
    ];
    const strain = new Strain({ allelePairs });
    const crossStrains = await strain.selfCross();

    expect(crossStrains.length).toBe(90);

    const probSum = crossStrains.reduce(
      (prev, curr) => prev + curr.probability,
      0
    );
    expect(probSum).toBeCloseTo(1.0);

    // test all strains >= 0.1%
    testStrains(
      crossStrains.filter((strain) => strain.probability >= 0.001),
      strains.partialAdvancedSelfCross
    );
  });

  test('cross on multiple chromosomes', async () => {
    const allelePairs1: AllelePair[] = [
      // chrom II
      alleles.oxTi75.toTopHet(),
      alleles.cn64.toTopHet(),
      // chrom IV
      alleles.ox802.toTopHet(),
    ];
    const allelePairs2: AllelePair[] = [
      // chrom III
      alleles.ox11000.toHomo(),
      // chrom IV
      alleles.e53.toHomo(),
      alleles.e204.toTopHet(),
    ];
    const strain1 = new Strain({ allelePairs: allelePairs1 });
    const strain2 = new Strain({ allelePairs: allelePairs2 });
    const crossStrains = await strain1.crossWith(strain2);

    testStrains(crossStrains, strains.intermediateCross);
  });

  test('ECA cross', async () => {
    const strain1 = new Strain({
      allelePairs: [alleles.oxEx2254.toTopHet(), alleles.oxEx219999.toTopHet()],
    });
    const strain2 = new Strain({
      allelePairs: [alleles.oxEx2254.toTopHet()],
    });
    const crossStrains = await strain1.crossWith(strain2);
    testStrains(crossStrains, strains.ecaCross);
  });

  test('.meiosis() excludes the Ex pseudo-chromosome', () => {
    const gametes = new Strain({
      allelePairs: [alleles.e204.toTopHet(), alleles.oxEx2254.toTopHet()],
    }).meiosis();
    const expected: Gamete[] = [
      { chromosomes: [[alleles.e204]], prob: 0.5 },
      { chromosomes: [[alleles.e204.toWild()]], prob: 0.5 },
    ];
    testGametes(gametes, expected);
  });

  test('self-cross of a single Ex array at a non-50% loss rate', async () => {
    // oxEx200 has percentLoss: 30 -> transmission prob 0.7
    const strain = new Strain({ allelePairs: [alleles.oxEx200.toTopHet()] });
    const crossStrains = await strain.selfCross();
    const expected: Strain[] = [
      new Strain({
        allelePairs: [alleles.oxEx200.toTopHet()],
        probability: 0.7,
      }),
      new Strain({ allelePairs: [], probability: 0.3 }),
    ];
    testStrains(crossStrains, expected);
  });

  test('self-cross of three independent Ex arrays at different loss rates', async () => {
    // oxEx100/200/300 have percentLoss 10/30/40 -> transmission probs 0.9/0.7/0.6
    const strain = new Strain({
      allelePairs: [
        alleles.oxEx100.toTopHet(),
        alleles.oxEx200.toTopHet(),
        alleles.oxEx300.toTopHet(),
      ],
    });
    const crossStrains = await strain.selfCross();
    const expected: Strain[] = [
      new Strain({
        allelePairs: [
          alleles.oxEx100.toTopHet(),
          alleles.oxEx200.toTopHet(),
          alleles.oxEx300.toTopHet(),
        ],
        probability: 0.378,
      }),
      new Strain({
        allelePairs: [alleles.oxEx100.toTopHet(), alleles.oxEx200.toTopHet()],
        probability: 0.252,
      }),
      new Strain({
        allelePairs: [alleles.oxEx100.toTopHet(), alleles.oxEx300.toTopHet()],
        probability: 0.162,
      }),
      new Strain({
        allelePairs: [alleles.oxEx100.toTopHet()],
        probability: 0.108,
      }),
      new Strain({
        allelePairs: [alleles.oxEx200.toTopHet(), alleles.oxEx300.toTopHet()],
        probability: 0.042,
      }),
      new Strain({
        allelePairs: [alleles.oxEx200.toTopHet()],
        probability: 0.028,
      }),
      new Strain({
        allelePairs: [alleles.oxEx300.toTopHet()],
        probability: 0.018,
      }),
      new Strain({ allelePairs: [], probability: 0.012 }),
    ];
    testStrains(crossStrains, expected);
  });

  test('self-cross of an Ex array with no percentLoss recorded is always transmitted', async () => {
    const strain = new Strain({ allelePairs: [alleles.oxEx12345.toTopHet()] });
    const crossStrains = await strain.selfCross();
    const expected: Strain[] = [
      new Strain({
        allelePairs: [alleles.oxEx12345.toTopHet()],
        probability: 1,
      }),
    ];
    testStrains(crossStrains, expected);
  });

  test('self-cross mixing a null-percentLoss array with a real-rate array', async () => {
    const strain = new Strain({
      allelePairs: [
        alleles.oxEx12345.toTopHet(), // no percentLoss -> always transmitted
        alleles.oxEx200.toTopHet(), // percentLoss: 30 -> transmission prob 0.7
      ],
    });
    const crossStrains = await strain.selfCross();
    const expected: Strain[] = [
      new Strain({
        allelePairs: [alleles.oxEx12345.toTopHet(), alleles.oxEx200.toTopHet()],
        probability: 0.7,
      }),
      new Strain({
        allelePairs: [alleles.oxEx12345.toTopHet()],
        probability: 0.3,
      }),
    ];
    testStrains(crossStrains, expected);
  });

  test('cross with an Ex array present in only one parent', async () => {
    const strain1 = new Strain({
      allelePairs: [alleles.oxEx100.toTopHet()], // percentLoss: 10 -> prob 0.9
    });
    const strain2 = new Strain({
      allelePairs: [alleles.oxEx300.toTopHet()], // percentLoss: 40 -> prob 0.6
    });
    const crossStrains = await strain1.crossWith(strain2);
    const expected: Strain[] = [
      new Strain({
        allelePairs: [alleles.oxEx100.toTopHet(), alleles.oxEx300.toTopHet()],
        probability: 0.54,
      }),
      new Strain({
        allelePairs: [alleles.oxEx100.toTopHet()],
        probability: 0.36,
      }),
      new Strain({
        allelePairs: [alleles.oxEx300.toTopHet()],
        probability: 0.06,
      }),
      new Strain({ allelePairs: [], probability: 0.04 }),
    ];
    testStrains(crossStrains, expected);
  });

  test('Ex array segregates independently alongside a regular chromosomal pair', async () => {
    const strain = new Strain({
      allelePairs: [
        alleles.e204.toTopHet(),
        alleles.oxEx300.toTopHet(), // percentLoss: 40 -> transmission prob 0.6
      ],
    });
    const crossStrains = await strain.selfCross();
    const expected: Strain[] = [
      new Strain({
        allelePairs: [alleles.e204.toTopHet(), alleles.oxEx300.toTopHet()],
        probability: 0.3,
      }),
      new Strain({
        allelePairs: [alleles.e204.toTopHet()],
        probability: 0.2,
      }),
      new Strain({
        allelePairs: [alleles.e204.toHomo(), alleles.oxEx300.toTopHet()],
        probability: 0.15,
      }),
      new Strain({
        allelePairs: [
          alleles.e204.toWild().toHomo(),
          alleles.oxEx300.toTopHet(),
        ],
        probability: 0.15,
      }),
      new Strain({
        allelePairs: [alleles.e204.toHomo()],
        probability: 0.1,
      }),
      new Strain({
        allelePairs: [alleles.e204.toWild().toHomo()],
        probability: 0.1,
      }),
    ];
    testStrains(crossStrains, expected);
  });

  test('should output a single child for wild-wild crosses', async () => {
    const wildStrain1 = new Strain({ allelePairs: [] });
    const wildStrain2 = wildStrain1.clone();
    const selfCrossStrains = await wildStrain1.selfCross();
    const wildToWildCrossStrains = await wildStrain1.crossWith(wildStrain2);

    testStrains(selfCrossStrains, strains.wildToWildCross);
    testStrains(wildToWildCrossStrains, strains.wildToWildCross);
  });
});

describe('getExprPhenotypes() - backlog #11 second half', () => {
  const phen = (name: string, wild: boolean): Phenotype =>
    new Phenotype({ name, shortName: name, wild });
  const cond = (name: string): Condition => new Condition({ name });

  const alleleWithExpr = (
    name: string,
    exprs: Array<Partial<AlleleExpressionState> & { dominance: Zygosity }>,
    variation: Partial<{ chromosome: ChromosomeName }> = {}
  ): Allele => {
    const allele = new Allele({
      name,
      variation: new Variation({ name, ...variation }),
    });
    allele.alleleExpressions = exprs.map(
      (e) =>
        new AlleleExpression({
          alleleName: name,
          expressingPhenotype: phen('unnamed', false),
          requiredPhenotypes: [],
          suppressingPhenotypes: [],
          requiredConditions: [],
          suppressingConditions: [],
          ...e,
        })
    );
    return allele;
  };

  test('zygosity exact match: a "2" row only expresses homozygous', () => {
    const p = phen('dumpy', false);
    const mut = alleleWithExpr('mut1', [
      { dominance: '2', expressingPhenotype: p },
    ]);
    const het = new Strain({ allelePairs: [mut.toTopHet()] });
    const homo = new Strain({ allelePairs: [mut.toHomo()] });
    expect(het.getExprPhenotypes().map((x) => x.name)).not.toContain('dumpy');
    expect(homo.getExprPhenotypes().map((x) => x.name)).toContain('dumpy');
  });

  test('zygosity "1or2" matches either heterozygous or homozygous', () => {
    const p = phen('roller', false);
    const mut = alleleWithExpr('mut2', [
      { dominance: '1or2', expressingPhenotype: p },
    ]);
    const het = new Strain({ allelePairs: [mut.toTopHet()] });
    const homo = new Strain({ allelePairs: [mut.toHomo()] });
    expect(het.getExprPhenotypes().map((x) => x.name)).toContain('roller');
    expect(homo.getExprPhenotypes().map((x) => x.name)).toContain('roller');
  });

  test('a "0" row expresses for a wild-type-homozygous locus tracked via a parent', () => {
    const p = phen('non-dumpy', true);
    const mut = alleleWithExpr('mut3', [
      { dominance: '0', expressingPhenotype: p },
    ]);
    const wildStrain = new Strain({ allelePairs: [mut.toWild().toHomo()] });
    expect(wildStrain.getExprPhenotypes([mut]).map((x) => x.name)).toContain(
      'non-dumpy'
    );
  });

  test('a "0" row is reachable via a direct parent allele the genotype itself does not carry', () => {
    const p = phen('non-dumpy', true);
    const mut = alleleWithExpr('mut4', [
      { dominance: '0', expressingPhenotype: p },
    ]);
    // This genotype has no pair at all for mut4's locus - only a parent does.
    const child = new Strain({ allelePairs: [] });
    expect(child.getExprPhenotypes([mut]).map((x) => x.name)).toContain(
      'non-dumpy'
    );
    // Without the parent allele passed in, it's not evaluated at all.
    expect(child.getExprPhenotypes([]).map((x) => x.name)).not.toContain(
      'non-dumpy'
    );
  });

  test('male hemizygous X-linked copy counts as "2", not "1"', () => {
    const p = phen('unc', false);
    const mut = alleleWithExpr(
      'mut5',
      [{ dominance: '2', expressingPhenotype: p }],
      { chromosome: 'X' }
    );
    const maleHemi = new Strain({
      sex: Sex.Male,
      allelePairs: [mut.toTopHet()],
    });
    expect(maleHemi.getExprPhenotypes().map((x) => x.name)).toContain('unc');
  });

  test('condition requirement: blocked until the condition is active', () => {
    const p = phen('resistant', false);
    const tet = cond('tetracycline');
    const mut = alleleWithExpr('mut6', [
      {
        dominance: '2',
        expressingPhenotype: p,
        requiredConditions: [tet],
      },
    ]);
    const strain = new Strain({ allelePairs: [mut.toHomo()] });
    expect(
      strain.getExprPhenotypes([], new Set()).map((x) => x.name)
    ).not.toContain('resistant');
    expect(
      strain.getExprPhenotypes([], new Set(['tetracycline'])).map((x) => x.name)
    ).toContain('resistant');
  });

  test('condition suppression: blocked once the condition is active', () => {
    const p = phen('sensitive', true);
    const heat = cond('37C');
    const mut = alleleWithExpr('mut7', [
      {
        dominance: '2',
        expressingPhenotype: p,
        suppressingConditions: [heat],
      },
    ]);
    const strain = new Strain({ allelePairs: [mut.toHomo()] });
    expect(
      strain.getExprPhenotypes([], new Set()).map((x) => x.name)
    ).toContain('sensitive');
    expect(
      strain.getExprPhenotypes([], new Set(['37C'])).map((x) => x.name)
    ).not.toContain('sensitive');
  });

  test('phenotype requirement: B only expresses once A does', () => {
    const phenA = phen('phenA', false);
    const phenB = phen('phenB', false);
    const alleleA = alleleWithExpr('alleleA', [
      { dominance: '2', expressingPhenotype: phenA },
    ]);
    const alleleB = alleleWithExpr('alleleB', [
      {
        dominance: '2',
        expressingPhenotype: phenB,
        requiredPhenotypes: [phenA],
      },
    ]);
    const bothExpressed = new Strain({
      allelePairs: [alleleA.toHomo(), alleleB.toHomo()],
    });
    const onlyB = new Strain({ allelePairs: [alleleB.toHomo()] });
    expect(bothExpressed.getExprPhenotypes().map((x) => x.name)).toEqual(
      expect.arrayContaining(['phenA', 'phenB'])
    );
    expect(onlyB.getExprPhenotypes().map((x) => x.name)).not.toContain('phenB');
  });

  test('phenotype suppression: B is blocked once A expresses', () => {
    const phenA = phen('phenA2', false);
    const phenB = phen('phenB2', false);
    const alleleA = alleleWithExpr('alleleA2', [
      { dominance: '2', expressingPhenotype: phenA },
    ]);
    const alleleB = alleleWithExpr('alleleB2', [
      {
        dominance: '2',
        expressingPhenotype: phenB,
        suppressingPhenotypes: [phenA],
      },
    ]);
    const bothPresent = new Strain({
      allelePairs: [alleleA.toHomo(), alleleB.toHomo()],
    });
    const onlyB = new Strain({ allelePairs: [alleleB.toHomo()] });
    expect(bothPresent.getExprPhenotypes().map((x) => x.name)).not.toContain(
      'phenB2'
    );
    expect(onlyB.getExprPhenotypes().map((x) => x.name)).toContain('phenB2');
  });

  test('multi-level dependency chain resolves in dependency order (C requires B requires A)', () => {
    const phenA = phen('phenA3', false);
    const phenB = phen('phenB3', false);
    const phenC = phen('phenC3', false);
    const alleleA = alleleWithExpr('alleleA3', [
      { dominance: '2', expressingPhenotype: phenA },
    ]);
    const alleleB = alleleWithExpr('alleleB3', [
      {
        dominance: '2',
        expressingPhenotype: phenB,
        requiredPhenotypes: [phenA],
      },
    ]);
    const alleleC = alleleWithExpr('alleleC3', [
      {
        dominance: '2',
        expressingPhenotype: phenC,
        requiredPhenotypes: [phenB],
      },
    ]);
    const allThree = new Strain({
      allelePairs: [alleleA.toHomo(), alleleB.toHomo(), alleleC.toHomo()],
    });
    const namesAll = allThree.getExprPhenotypes().map((x) => x.name);
    expect(namesAll).toEqual(
      expect.arrayContaining(['phenA3', 'phenB3', 'phenC3'])
    );

    // Without A, neither B nor C can ever resolve true.
    const missingA = new Strain({
      allelePairs: [alleleB.toHomo(), alleleC.toHomo()],
    });
    const namesMissingA = missingA.getExprPhenotypes().map((x) => x.name);
    expect(namesMissingA).not.toContain('phenB3');
    expect(namesMissingA).not.toContain('phenC3');
  });

  test('a circular phenotype dependency resolves to neither expressed, without hanging', () => {
    const phenA = phen('cycleA', false);
    const phenB = phen('cycleB', false);
    const alleleA = alleleWithExpr('cycleAlleleA', [
      {
        dominance: '2',
        expressingPhenotype: phenA,
        requiredPhenotypes: [phenB],
      },
    ]);
    const alleleB = alleleWithExpr('cycleAlleleB', [
      {
        dominance: '2',
        expressingPhenotype: phenB,
        requiredPhenotypes: [phenA],
      },
    ]);
    const strain = new Strain({
      allelePairs: [alleleA.toHomo(), alleleB.toHomo()],
    });
    const names = strain.getExprPhenotypes().map((x) => x.name);
    expect(names).not.toContain('cycleA');
    expect(names).not.toContain('cycleB');
    expect(strain.getUnresolvedExprPhenotypes().map((x) => x.name)).toEqual(
      expect.arrayContaining(['cycleA', 'cycleB'])
    );
  });

  test('a require/suppress cycle (A requires B, B suppressed by A) resolves as unknown, not order-dependent', () => {
    const phenA = phen('cycleA2', false);
    const phenB = phen('cycleB2', false);
    const alleleA = alleleWithExpr('cycleAlleleA2', [
      {
        dominance: '2',
        expressingPhenotype: phenA,
        requiredPhenotypes: [phenB],
      },
    ]);
    const alleleB = alleleWithExpr('cycleAlleleB2', [
      {
        dominance: '2',
        expressingPhenotype: phenB,
        suppressingPhenotypes: [phenA],
      },
    ]);
    // Build the strain with alleles in both orders - since alleleExpressions
    // are iterated via a Map of tracked alleles, insertion order could
    // previously flip which phenotype "won" a race to be marked expressed
    // first. Both orders must agree: neither phenotype is established true
    // or false - both stay genuinely unknown.
    const strainAB = new Strain({
      allelePairs: [alleleA.toHomo(), alleleB.toHomo()],
    });
    const strainBA = new Strain({
      allelePairs: [alleleB.toHomo(), alleleA.toHomo()],
    });
    [strainAB, strainBA].forEach((strain) => {
      const expressedNames = strain.getExprPhenotypes().map((x) => x.name);
      expect(expressedNames).not.toContain('cycleA2');
      expect(expressedNames).not.toContain('cycleB2');
      const unresolvedNames = strain
        .getUnresolvedExprPhenotypes()
        .map((x) => x.name);
      expect(unresolvedNames).toEqual(
        expect.arrayContaining(['cycleA2', 'cycleB2'])
      );
    });
  });

  test('a phenotype referenced only as a conditional, with no expressing row, resolves false (not unknown)', () => {
    const phantom = phen('phantom', false);
    const real = phen('realPhen', false);
    const allele = alleleWithExpr('alleleReq', [
      {
        dominance: '2',
        expressingPhenotype: real,
        requiredPhenotypes: [phantom],
      },
    ]);
    const strain = new Strain({ allelePairs: [allele.toHomo()] });
    expect(strain.getExprPhenotypes().map((x) => x.name)).not.toContain(
      'realPhen'
    );
    expect(
      strain.getUnresolvedExprPhenotypes().map((x) => x.name)
    ).not.toContain('realPhen');
  });

  test('non-circular dependency chains resolve correctly regardless of allele order (order independence)', () => {
    const phenA = phen('orderA', false);
    const phenB = phen('orderB', false);
    const alleleA = alleleWithExpr('orderAlleleA', [
      { dominance: '2', expressingPhenotype: phenA },
    ]);
    const alleleB = alleleWithExpr('orderAlleleB', [
      {
        dominance: '2',
        expressingPhenotype: phenB,
        suppressingPhenotypes: [phenA],
      },
    ]);
    const strainAB = new Strain({
      allelePairs: [alleleA.toHomo(), alleleB.toHomo()],
    });
    const strainBA = new Strain({
      allelePairs: [alleleB.toHomo(), alleleA.toHomo()],
    });
    [strainAB, strainBA].forEach((strain) => {
      const names = strain.getExprPhenotypes().map((x) => x.name);
      expect(names).toContain('orderA');
      expect(names).not.toContain('orderB');
      expect(strain.getUnresolvedExprPhenotypes()).toHaveLength(0);
    });
  });
});

describe('getExprPhenotypes() - gene-level "2 copies (lof)" (Zygosity \'5\')', () => {
  const phen = (name: string, wild: boolean): Phenotype =>
    new Phenotype({ name, shortName: name, wild });

  const geneAlleleWithExpr = (
    alleleName: string,
    geneSysName: string,
    exprs: Array<Partial<AlleleExpressionState> & { dominance: Zygosity }>
  ): Allele => {
    const allele = new Allele({
      name: alleleName,
      gene: new Gene({ sysName: geneSysName }),
    });
    allele.alleleExpressions = exprs.map(
      (e) =>
        new AlleleExpression({
          alleleName,
          expressingPhenotype: phen('unnamed', false),
          requiredPhenotypes: [],
          suppressingPhenotypes: [],
          requiredConditions: [],
          suppressingConditions: [],
          ...e,
        })
    );
    return allele;
  };

  test('getZygosity treats each side of a trans pair of 2 different non-wild alleles as 1 copy, not 0', () => {
    const alleleA = geneAlleleWithExpr('transAlleleA', 'unc-119', []);
    const alleleB = geneAlleleWithExpr('transAlleleB', 'unc-119', []);
    const strain = new Strain({
      allelePairs: [new AllelePair({ top: alleleA, bot: alleleB })],
    });
    expect(strain.getZygosity('transAlleleA')).toBe('1');
    expect(strain.getZygosity('transAlleleB')).toBe('1');
  });

  test('a plain "1" row correctly resolves for each side of a trans pair (the pre-existing bug this fixes)', () => {
    const phenX = phen('phenX1', false);
    const phenY = phen('phenY1', false);
    const alleleA = geneAlleleWithExpr('transAlleleA1', 'unc-119', [
      { dominance: '1', expressingPhenotype: phenX },
    ]);
    const alleleB = geneAlleleWithExpr('transAlleleB1', 'unc-119', [
      { dominance: '1', expressingPhenotype: phenY },
    ]);
    const strain = new Strain({
      allelePairs: [new AllelePair({ top: alleleA, bot: alleleB })],
    });
    const names = strain.getExprPhenotypes().map((x) => x.name);
    expect(names).toContain('phenX1');
    expect(names).toContain('phenY1');
  });

  test('a plain "2" row does not resolve for a trans compound het of 2 different alleles (each only 1 copy)', () => {
    const phenX = phen('phenX', false);
    const phenY = phen('phenY', false);
    const alleleA = geneAlleleWithExpr('lofAlleleA', 'unc-119', [
      { dominance: '2', expressingPhenotype: phenX },
    ]);
    const alleleB = geneAlleleWithExpr('lofAlleleB', 'unc-119', [
      { dominance: '2', expressingPhenotype: phenY },
    ]);
    const strain = new Strain({
      allelePairs: [new AllelePair({ top: alleleA, bot: alleleB })],
    });
    const names = strain.getExprPhenotypes().map((x) => x.name);
    expect(names).not.toContain('phenX');
    expect(names).not.toContain('phenY');
  });

  test('a "5" row resolves for a trans compound het of 2 different LOF alleles of the same gene, same phenotype', () => {
    const p = phen('Unc', false);
    const alleleA = geneAlleleWithExpr('lofAlleleA2', 'unc-119', [
      { dominance: '5', expressingPhenotype: p },
    ]);
    const alleleB = geneAlleleWithExpr('lofAlleleB2', 'unc-119', [
      { dominance: '5', expressingPhenotype: p },
    ]);
    const strain = new Strain({
      allelePairs: [new AllelePair({ top: alleleA, bot: alleleB })],
    });
    expect(strain.getExprPhenotypes().map((x) => x.name)).toContain('Unc');
  });

  test('a "5" row still resolves for a literal homozygote of the same allele', () => {
    const p = phen('Unc2', false);
    const allele = geneAlleleWithExpr('lofAlleleHomo', 'unc-119', [
      { dominance: '5', expressingPhenotype: p },
    ]);
    const strain = new Strain({ allelePairs: [allele.toHomo()] });
    expect(strain.getExprPhenotypes().map((x) => x.name)).toContain('Unc2');
  });

  test('a "5" row does not resolve if the trans partner has no "5" row at all', () => {
    const p = phen('Unc3', false);
    const alleleA = geneAlleleWithExpr('lofAlleleA3', 'unc-119', [
      { dominance: '5', expressingPhenotype: p },
    ]);
    const alleleB = geneAlleleWithExpr('lofAlleleB3', 'unc-119', [
      { dominance: '2', expressingPhenotype: p },
    ]);
    const strain = new Strain({
      allelePairs: [new AllelePair({ top: alleleA, bot: alleleB })],
    });
    expect(strain.getExprPhenotypes().map((x) => x.name)).not.toContain('Unc3');
  });

  test('a "5" row does not resolve if the trans partner\'s "5" row is for a different phenotype', () => {
    const phenP = phen('UncP', false);
    const phenQ = phen('UncQ', false);
    const alleleA = geneAlleleWithExpr('lofAlleleA4', 'unc-119', [
      { dominance: '5', expressingPhenotype: phenP },
    ]);
    const alleleB = geneAlleleWithExpr('lofAlleleB4', 'unc-119', [
      { dominance: '5', expressingPhenotype: phenQ },
    ]);
    const strain = new Strain({
      allelePairs: [new AllelePair({ top: alleleA, bot: alleleB })],
    });
    const names = strain.getExprPhenotypes().map((x) => x.name);
    expect(names).not.toContain('UncP');
    expect(names).not.toContain('UncQ');
  });

  test('a "5" row does not resolve against a single wild-type-paired copy', () => {
    const p = phen('Unc4', false);
    const allele = geneAlleleWithExpr('lofAlleleHet', 'unc-119', [
      { dominance: '5', expressingPhenotype: p },
    ]);
    const strain = new Strain({ allelePairs: [allele.toTopHet()] });
    expect(strain.getExprPhenotypes().map((x) => x.name)).not.toContain('Unc4');
  });
});
