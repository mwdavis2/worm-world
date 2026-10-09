// Strain <-> notation loci, and picking the child of a re-run cross that a
// notation describes (todo #5). The text layer is notationText.ts.
import { Sex } from 'models/enums';
import { type Allele } from 'models/frontend/Allele/Allele';
import { AllelePair } from 'models/frontend/AllelePair/AllelePair';
import { Strain } from 'models/frontend/Strain/Strain';
import { type NotationLocus } from './notationText';

const WILD = '+';
const NO_SECOND_X = '0';

export class NotationGenotypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotationGenotypeError';
  }
}

/**
 * The loci of a strain, in chromosome then genetic order: every non-wild allele
 * pair as "top/bottom". The X is always represented - `+/+` for a hermaphrodite
 * with nothing tracked, `+/0` for such a male - and a male's X alleles are
 * written `allele/0` (hemizygous), whatever is stored in the second slot.
 */
export const strainToLoci = (strain: Strain): NotationLocus[] => {
  const isMale = strain.sex === Sex.Male;
  const loci: NotationLocus[] = [];
  let wroteX = false;
  strain.getSortedChromPairs().forEach((chromPair) => {
    if (chromPair.isX() && isMale) {
      chromPair.allelePairs.forEach((pair) => {
        if (pair.top.isWild()) return;
        loci.push({ top: pair.top.name, bot: NO_SECOND_X });
        wroteX = true;
      });
      return;
    }
    chromPair.simplify().allelePairs.forEach((pair) => {
      // An extrachromosomal array has no second copy: written bare.
      if (chromPair.isEca()) loci.push({ top: pair.top.name });
      else loci.push({ top: pair.top.name, bot: pair.bot.name });
      if (chromPair.isX()) wroteX = true;
    });
  });
  if (!wroteX) loci.push({ top: WILD, bot: isMale ? NO_SECOND_X : WILD });
  return loci;
};

/**
 * Builds the strain a list of loci describes. `alleles` maps every allele name
 * used to its allele (the caller looks them up); an unknown name is an error. A
 * `0` second position makes the strain a male, as `Strain.toggleSex()` does:
 * the listed X alleles stay on the top, the other X is wild.
 */
export const lociToStrain = (
  loci: NotationLocus[],
  alleles: Map<string, Allele>
): Strain => {
  const lookup = (name: string): Allele => {
    const allele = alleles.get(name);
    if (allele === undefined)
      throw new NotationGenotypeError(`Unknown allele "${name}"`);
    return allele;
  };

  const isMale = loci.some((locus) => locus.bot === NO_SECOND_X);
  const pairs: AllelePair[] = [];
  loci.forEach(({ top, bot }) => {
    if (bot === undefined) {
      // A bare name is an extrachromosomal array.
      const array = lookup(top);
      if (!array.isEca())
        throw new NotationGenotypeError(
          `"${top}" is not an extrachromosomal array - write it as top/bottom`
        );
      pairs.push(new AllelePair({ top: array, bot: array.toWild() }));
      return;
    }
    if (top === WILD && (bot === WILD || bot === NO_SECOND_X)) return;
    if (top === NO_SECOND_X || (bot === NO_SECOND_X && top === WILD))
      throw new NotationGenotypeError(`"${top}/${bot}" is not a valid locus`);
    if (bot === NO_SECOND_X) {
      const allele = lookup(top);
      if (allele.getChromName() !== 'X')
        throw new NotationGenotypeError(
          `"${top}/0" - only X alleles can have no second copy`
        );
      pairs.push(new AllelePair({ top: allele, bot: allele.toWild() }));
    } else if (top === WILD) {
      const allele = lookup(bot);
      pairs.push(new AllelePair({ top: allele.toWild(), bot: allele }));
    } else if (bot === WILD) {
      const allele = lookup(top);
      pairs.push(new AllelePair({ top: allele, bot: allele.toWild() }));
    } else pairs.push(new AllelePair({ top: lookup(top), bot: lookup(bot) }));
  });

  let strain: Strain;
  try {
    strain = new Strain({ allelePairs: pairs });
  } catch (error) {
    throw new NotationGenotypeError(
      error instanceof Error ? error.message : 'The loci do not make a strain'
    );
  }
  if (!isMale) return strain;
  // A hermaphrodite becomes a male with the listed alleles on its one X.
  return strain.toggleSex();
};

/** A copy of the strain without its X pair, to compare everything else. */
const withoutX = (strain: Strain): Strain => {
  const copy = strain.clone();
  copy.chromPairMap.delete('X');
  return copy;
};

/** Whether the strain's X carries any allele that is not wild-type. */
const tracksX = (strain: Strain): boolean =>
  !(strain.chromPairMap.get('X')?.isWild() ?? true);

/**
 * Which of the children of a re-run cross is the one a notation describes?
 * A cross produces hermaphrodite and male children (a male's X is his mother's
 * X alone), so the target is matched on sex and genotype:
 * - the child with the same sex and genotype, the first one if several;
 * - a male target that tracks nothing on its X, when the cross has no X data at
 *   all (so its children carry no sex): the child with the same autosomes,
 *   made a male.
 * Returns the child's index and the strain to use for it, or undefined when no
 * child fits.
 */
export const matchChild = (
  children: Strain[],
  target: Strain
): { index: number; strain: Strain } | undefined => {
  const exact = children.findIndex((child) => child.equals(target));
  if (exact !== -1) return { index: exact, strain: children[exact] };

  if (target.sex === Sex.Male && !tracksX(target)) {
    const targetRest = withoutX(target);
    const index = children.findIndex(
      (child) =>
        !child.chromPairMap.has('X') &&
        withoutX(child).equals(targetRest, false, true)
    );
    if (index !== -1) return { index, strain: children[index].toggleSex() };
  }
  return undefined;
};

/** The strain `matchChild` picks (see there), or undefined. */
export const findMatchingChild = (
  children: Strain[],
  target: Strain
): Strain | undefined => matchChild(children, target)?.strain;
