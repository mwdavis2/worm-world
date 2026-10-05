// Strain <-> notation loci, and picking the child of a re-run cross that a
// notation describes (todo #5). The text layer is notationText.ts.
import { Sex } from 'models/enums';
import { type Allele } from 'models/frontend/Allele/Allele';
import { AllelePair } from 'models/frontend/AllelePair/AllelePair';
import { ChromosomePair } from 'models/frontend/ChromosomePair/ChromosomePair';
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
      loci.push({ top: pair.top.name, bot: pair.bot.name });
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

const nonWildNames = (alleles: Allele[]): string[] =>
  alleles
    .filter((allele) => !allele.isWild())
    .map((allele) => allele.name)
    .sort();

const sameNames = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((name, i) => name === b[i]);

/** A copy of the strain without its X pair, to compare everything else. */
const withoutX = (strain: Strain): Strain => {
  const copy = strain.clone();
  copy.chromPairMap.delete('X');
  return copy;
};

/** A copy whose X pair has its two homologs swapped. */
const withFlippedX = (strain: Strain): Strain => {
  const copy = strain.clone();
  const x = copy.chromPairMap.get('X');
  if (x !== undefined)
    copy.chromPairMap.set(
      'X',
      new ChromosomePair(
        x.allelePairs.map((pair) => {
          const flipped = pair.clone();
          flipped.flip();
          return flipped;
        })
      )
    );
  return copy;
};

/**
 * Which of the children of a re-run cross is the one a notation describes?
 * A re-run cross produces hermaphrodites only, so sex is ignored in the match:
 * - a hermaphrodite target matches the child with the same genotype;
 * - a male target (hemizygous X) matches a child whose autosomes match and
 *   whose X has one homolog carrying exactly the target's X alleles; that
 *   homolog is put on top and the child is made a male, as `toggleSex()` does.
 * The first match wins. Returns undefined when no child fits.
 */
export const findMatchingChild = (
  children: Strain[],
  target: Strain
): Strain | undefined => {
  if (target.sex !== Sex.Male)
    return children.find((child) => child.equals(target));

  const wantedX = nonWildNames(
    target.chromPairMap.get('X')?.allelePairs.map((pair) => pair.top) ?? []
  );
  const targetRest = withoutX(target);
  for (const child of children) {
    if (!withoutX(child).equals(targetRest)) continue;
    const x = child.chromPairMap.get('X');
    const top = nonWildNames(x?.getTop() ?? []);
    const bot = nonWildNames(x?.getBot() ?? []);
    if (sameNames(top, wantedX)) return child.toggleSex();
    if (sameNames(bot, wantedX)) return withFlippedX(child).toggleSex();
  }
  return undefined;
};
