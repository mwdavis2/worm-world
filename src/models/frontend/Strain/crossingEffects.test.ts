// Crossing effects: phenotypes that block a card's left (male), right (female)
// or bottom (self) crossing rectangle, or make a hermaphrodite produce males
// (Him). A card learns them the way it learns it is lethal, and the cross
// filter lists them without hiding anything by default.
import { describe, expect, test } from 'vitest';
import { type Node } from 'reactflow';
import { Allele } from 'models/frontend/Allele/Allele';
import { AlleleExpression } from 'models/frontend/AlleleExpression/AlleleExpression';
import { Phenotype } from 'models/frontend/Phenotype/Phenotype';
import { Strain } from 'models/frontend/Strain/Strain';
import {
  crossingBlockMessage,
  isCrossingBlocked,
} from 'models/frontend/Strain/crossingEffects';
import {
  FEMALE_CROSSING_DEFECTIVE,
  HIM,
  MALE_CROSSING_DEFECTIVE,
  NO_CROSSING_EFFECTS,
  SELF_CROSSING_DEFECTIVE,
  StrainFilter,
} from 'models/frontend/StrainFilter/StrainFilter';
import { Variation } from 'models/frontend/Variation/Variation';
import { Sex } from 'models/enums';

// An allele whose phenotype carries the given crossing effects, shown with
// one or two copies
const alleleWith = (
  name: string,
  effects: Partial<Phenotype>,
  chromosome: 'II' | 'X' = 'II'
): Allele => {
  const allele = new Allele({
    name,
    variation: new Variation({ name, chromosome }),
  });
  allele.alleleExpressions = [
    new AlleleExpression({
      alleleName: name,
      expressingPhenotype: new Phenotype({
        name: `${name}-pheno`,
        shortName: name,
        wild: false,
        ...effects,
      }),
      requiredPhenotypes: [],
      suppressingPhenotypes: [],
      requiredConditions: [],
      suppressingConditions: [],
      dominance: '2',
    }),
  ];
  return allele;
};

// two copies, so the phenotype shows
const homozygous = (allele: Allele): Strain =>
  new Strain({ allelePairs: [allele.toHomo()] });

const sterile = alleleWith('ster', {
  femaleCrossingDefective: true,
  selfCrossingDefective: true,
});
const maleDefective = alleleWith('md', { maleCrossingDefective: true }, 'X');
const him = alleleWith('him5', { him: true });
const plain = alleleWith('plain', {});

describe('a card learns its crossing effects like it learns it is lethal', () => {
  test('each flag comes from an expressed phenotype', () => {
    const card = homozygous(sterile);
    card.refreshCardInfo();
    expect(card.femaleCrossingDefective).toBe(true);
    expect(card.selfCrossingDefective).toBe(true);
    expect(card.maleCrossingDefective).toBe(false);
    expect(card.him).toBe(false);

    const himCard = homozygous(him);
    himCard.refreshCardInfo();
    expect(himCard.him).toBe(true);
    expect(himCard.femaleCrossingDefective).toBe(false);
  });

  test('a phenotype not expressed (one copy of a two-copy phenotype) sets nothing', () => {
    const card = new Strain({ allelePairs: [sterile.toTopHet()] });
    card.refreshCardInfo();
    expect(card.femaleCrossingDefective).toBe(false);
    expect(card.selfCrossingDefective).toBe(false);
  });

  test('copying a card keeps the flags it was given', () => {
    const card = homozygous(sterile);
    card.refreshCardInfo();
    const copy = new Strain({ ...card, isParent: true });
    expect(copy.femaleCrossingDefective).toBe(true);
    expect(copy.clone().selfCrossingDefective).toBe(true);
  });
});

describe('which rectangle a flag blocks', () => {
  const herm = homozygous(sterile);
  herm.refreshCardInfo();
  const male = homozygous(maleDefective).toggleSex();
  male.refreshCardInfo();

  test('a sterile hermaphrodite cannot be the mother or self', () => {
    expect(isCrossingBlocked(herm, 'female')).toBe(true);
    expect(isCrossingBlocked(herm, 'self')).toBe(true);
    // a hermaphrodite is never the male parent
    expect(isCrossingBlocked(herm, 'male')).toBe(false);
  });

  test('a male crossing defective male cannot be the father', () => {
    expect(male.sex).toBe(Sex.Male);
    expect(isCrossingBlocked(male, 'male')).toBe(true);
    expect(isCrossingBlocked(male, 'female')).toBe(false);
  });

  test('a card with no effects is never blocked, and ignoring effects unblocks all', () => {
    const free = homozygous(plain);
    free.refreshCardInfo();
    expect(isCrossingBlocked(free, 'self')).toBe(false);
    expect(isCrossingBlocked(herm, 'female', true)).toBe(false);
    expect(isCrossingBlocked(male, 'male', true)).toBe(false);
    expect(crossingBlockMessage(herm, 'self', true)).toBeUndefined();
  });

  test('the message names what is blocked and how to cross anyway', () => {
    const message = crossingBlockMessage(herm, 'female') ?? '';
    expect(message).toContain('female crossing defective');
    expect(message).toContain('Ignore crossing effects');
    expect(crossingBlockMessage(herm, 'self')).toContain('self');
  });
});

describe('the crossing-effects filter', () => {
  const node = (strain: Strain, id: string): Node<Strain> => ({
    id,
    data: strain,
    position: { x: 0, y: 0 },
  });
  const sterileCard = homozygous(sterile);
  const himCard = homozygous(him);
  const freeCard = homozygous(plain);

  test('starts empty, so nothing is hidden by default', () => {
    const filter = new StrainFilter();
    expect(filter.crossing.size).toBe(0);
    expect(filter.isEmpty()).toBe(true);
    expect(sterileCard.passesFilter(filter)).toBe(true);
    expect(freeCard.passesFilter(filter)).toBe(true);
  });

  test("a child's groups are its effects, or 'No crossing effects'", () => {
    expect(sterileCard.crossingEffectGroups()).toEqual([
      FEMALE_CROSSING_DEFECTIVE,
      SELF_CROSSING_DEFECTIVE,
    ]);
    expect(himCard.crossingEffectGroups()).toEqual([HIM]);
    expect(freeCard.crossingEffectGroups()).toEqual([NO_CROSSING_EFFECTS]);
  });

  test('narrows to children with any ticked effect', () => {
    const filter = new StrainFilter({
      crossing: new Set([SELF_CROSSING_DEFECTIVE, HIM]),
    });
    expect(sterileCard.passesFilter(filter)).toBe(true);
    expect(himCard.passesFilter(filter)).toBe(true);
    expect(freeCard.passesFilter(filter)).toBe(false);
    const none = new StrainFilter({ crossing: new Set([NO_CROSSING_EFFECTS]) });
    expect(freeCard.passesFilter(none)).toBe(true);
    expect(sterileCard.passesFilter(none)).toBe(false);
  });

  test('is offered only when some child has an effect', () => {
    const offered = StrainFilter.getFilterOptions([
      node(sterileCard, 'a'),
      node(freeCard, 'b'),
    ]);
    expect(offered.crossing).toEqual(
      new Set([
        FEMALE_CROSSING_DEFECTIVE,
        SELF_CROSSING_DEFECTIVE,
        NO_CROSSING_EFFECTS,
      ])
    );
    const none = StrainFilter.getFilterOptions([node(freeCard, 'c')]);
    expect(none.crossing.size).toBe(0);
  });

  test('counts in isEmpty and describe, clones, and survives a round trip; old designs load empty', () => {
    const filter = new StrainFilter({
      crossing: new Set([MALE_CROSSING_DEFECTIVE]),
    });
    expect(filter.isEmpty()).toBe(false);
    expect(filter.describe(false, false)).toEqual([
      `Crossing effects: ${MALE_CROSSING_DEFECTIVE}`,
    ]);
    expect(filter.clone().crossing).toEqual(filter.crossing);
    expect(StrainFilter.fromJSON(filter.toJSON()).crossing).toEqual(
      filter.crossing
    );
    const old = JSON.stringify({ alleleNames: [], viability: [], sex: [] });
    expect(StrainFilter.fromJSON(old).crossing.size).toBe(0);
  });
});
