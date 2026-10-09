// The absent allele: the "0" of a male's `x1/0`, a real allele that is not
// wild and is never a copy to cross with.
import { describe, expect, test } from 'vitest';
import { Allele } from 'models/frontend/Allele/Allele';
import { AllelePair } from 'models/frontend/AllelePair/AllelePair';
import { ChromosomePair } from 'models/frontend/ChromosomePair/ChromosomePair';
import { AlleleExpression } from 'models/frontend/AlleleExpression/AlleleExpression';
import { Phenotype } from 'models/frontend/Phenotype/Phenotype';
import { Strain } from 'models/frontend/Strain/Strain';
import { Variation } from 'models/frontend/Variation/Variation';
import { Sex } from 'models/enums';

const x1 = new Allele({
  name: 'x1',
  variation: new Variation({ name: 'x1', chromosome: 'X', geneticLoc: 1 }),
});
const x2 = new Allele({
  name: 'x2',
  variation: new Variation({ name: 'x2', chromosome: 'X', geneticLoc: 3 }),
});

const withExpr = (
  allele: Allele,
  dominance: '0' | '2' | '5',
  phenotype: Phenotype
): Allele => {
  allele.alleleExpressions = [
    new AlleleExpression({
      alleleName: allele.name,
      expressingPhenotype: phenotype,
      requiredPhenotypes: [],
      suppressingPhenotypes: [],
      requiredConditions: [],
      suppressingConditions: [],
      dominance,
    }),
  ];
  return allele;
};

describe('Allele', () => {
  test('the absent allele is its own thing: not wild, not a mutant copy', () => {
    const absent = x1.toAbsent();
    expect(absent.isAbsent()).toBe(true);
    expect(absent.isWild()).toBe(false);
    expect(absent.name).toBe('0');
    expect(x1.isAbsent()).toBe(false);
    expect(x1.toWild().isAbsent()).toBe(false);
    // it keeps its locus, as a wild allele does
    expect(absent.variation).toBe(x1.variation);
  });
});

describe('AllelePair', () => {
  const male = new AllelePair({ top: x1, bot: x1.toAbsent() });
  test('a single-X pair is hemizygous, not a heterozygote or a homozygote', () => {
    expect(male.isHemizygous()).toBe(true);
    expect(male.isHomo()).toBe(false);
    expect(male.isWildHet()).toBe(false);
    expect(male.isWild()).toBe(false);
  });

  test('a male with a wild X has a wild pair (nothing tracked)', () => {
    const wildMale = new AllelePair({
      top: x1.toWild(),
      bot: x1.toAbsent(),
    });
    expect(wildMale.isHemizygous()).toBe(true);
    expect(wildMale.isWild()).toBe(true);
  });

  test('an ordinary heterozygote and homozygote are unchanged', () => {
    expect(x1.toTopHet().isHemizygous()).toBe(false);
    expect(x1.toTopHet().isWildHet()).toBe(true);
    expect(x1.toHomo().isWild()).toBe(false);
  });
});

describe('ChromosomePair', () => {
  test('building from one chromosome gives the absent X as the second', () => {
    const pair = ChromosomePair.buildFromChroms([x1, x2], undefined);
    expect(pair.allelePairs.map((p) => p.bot.name)).toEqual(['0', '0']);
    expect(pair.allelePairs.every((p) => p.isHemizygous())).toBe(true);
  });

  test('a gamete with no X goes on the bottom, whichever side it was given', () => {
    const absent = [x1.toAbsent(), x2.toAbsent()];
    const pair = ChromosomePair.buildFromChroms(absent, [x1, x2]);
    expect(pair.allelePairs.map((p) => p.top.name)).toEqual(['x1', 'x2']);
    expect(pair.allelePairs.map((p) => p.bot.name)).toEqual(['0', '0']);
  });

  test('simplify never swaps the pairs of the chromosome it came from', () => {
    // wild on top at the first locus: simplify flips its copy to put the mutant on top
    const pair = new ChromosomePair([x1.toBotHet(), x2.toBotHet()]);
    const before = pair.allelePairs.map((p) => `${p.top.name}/${p.bot.name}`);
    const simplified = pair.simplify();
    expect(simplified.allelePairs.map((p) => p.top.name)).toEqual(['x1', 'x2']);
    expect(pair.allelePairs.map((p) => `${p.top.name}/${p.bot.name}`)).toEqual(
      before
    );
  });

  test('a male X pair prints with a 0', () => {
    const pair = ChromosomePair.buildFromChroms([x1], undefined);
    expect(pair.toString()).toContain('/0');
  });
});

describe('a male strain', () => {
  const unc = new Phenotype({ name: 'unc', shortName: 'unc', wild: false });
  const wildType = new Phenotype({
    name: 'non-unc',
    shortName: 'wt',
    wild: true,
  });

  test('a single mutant X counts as two copies for a recessive X-linked phenotype', () => {
    const allele = withExpr(new Allele({ ...x1, name: 'x1r' }), '2', unc);
    const maleStrain = new Strain({
      allelePairs: [allele.toTopHet()],
    }).toggleSex();
    expect(maleStrain.sex).toBe(Sex.Male);
    expect(maleStrain.getZygosity('x1r')).toBe('2');
    expect(
      maleStrain.getExprPhenotypes().map((p) => p.getUniqueName())
    ).toContain('unc');
    const hermStrain = new Strain({ allelePairs: [allele.toTopHet()] });
    expect(hermStrain.getZygosity('x1r')).toBe('1');
    expect(
      hermStrain.getExprPhenotypes().map((p) => p.getUniqueName())
    ).not.toContain('unc');
  });

  test('a male with a wild X has zygosity 0 and shows the wild-type row', () => {
    const allele = withExpr(new Allele({ ...x1, name: 'x1w' }), '0', wildType);
    const wildMale = new Strain({
      sex: Sex.Male,
      allelePairs: [allele.toWild().toHomo()],
    });
    expect(wildMale.getZygosity('x1w')).toBe('0');
    expect(
      wildMale.getExprPhenotypes([allele]).map((p) => p.getUniqueName())
    ).toContain('non-unc (wild)');
  });

  test('a male does not carry the absent placeholder as an allele', () => {
    const maleStrain = new Strain({ allelePairs: [x1.toTopHet()] }).toggleSex();
    expect(maleStrain.getNonWildAlleles().map((a) => a.name)).toEqual(['x1']);
    expect(maleStrain.getHetAlleles().map((a) => a.name)).toEqual(['x1']);
  });

  test('copying keeps the single X', () => {
    const maleStrain = new Strain({ allelePairs: [x1.toTopHet()] }).toggleSex();
    expect(maleStrain.clone().getAllelePairs()[0].isHemizygous()).toBe(true);
    expect(maleStrain.toMale().getAllelePairs()[0].isHemizygous()).toBe(true);
    expect(maleStrain.toString()).toContain('0');
  });

  test('a strain given a single-X pair is a male whatever sex it was asked to be', () => {
    const pair = new AllelePair({ top: x1, bot: x1.toAbsent() });
    expect(new Strain({ allelePairs: [pair] }).sex).toBe(Sex.Male);
  });
});
