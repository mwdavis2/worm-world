import { type AllelePair } from 'models/frontend/AllelePair/AllelePair';
import { type ChromosomePair } from 'models/frontend/ChromosomePair/ChromosomePair';

/**
 * What a chromosome is drawn as: its allele pairs (columns) in display order,
 * plus `[` / `]` marks (`open` / `close`) around the columns that sit inside a
 * rearrangement's region (a balancer or a translocation half). Shared by the
 * strain card and the SVG/PNG export so the two can't drift apart.
 */
export type ChromosomeLayoutItem =
  | { kind: 'pair'; pair: AllelePair }
  | { kind: 'open' }
  | { kind: 'close' };

const isRearrangementPair = (pair: AllelePair): boolean =>
  [pair.top, pair.bot].some(
    (allele) => !allele.isWild() && allele.hasRearrangementRange()
  );

// Where a rearrangement's own column belongs: the left edge (start) of the
// range its variation marks.
const rangeStartOf = (pair: AllelePair): number =>
  Math.min(
    ...[pair.top, pair.bot]
      .filter((allele) => !allele.isWild() && allele.hasRearrangementRange())
      .map((allele) =>
        Math.min(...(allele.variation?.recombination ?? [Infinity]))
      )
  );

/**
 * The columns of a chromosome in display order. The other columns keep their
 * genetic order. A rearrangement's own column sits at the left edge of the
 * region it marks - just before the first column at or past the start of its
 * range - and a bracket pair surrounds each run of columns whose physical
 * position lies inside a rearrangement's range (a column with no known
 * position counts as outside, and never moves a rearrangement column). This is
 * display only: the chromosome's own pair order, which meiosis relies on, is
 * not touched. A chromosome with no rearrangement, and the Ex
 * pseudo-chromosome, are returned as they are.
 */
export const getChromosomeLayout = (
  chromPair: ChromosomePair
): ChromosomeLayoutItem[] => {
  const asPairs = (pairs: AllelePair[]): ChromosomeLayoutItem[] =>
    pairs.map((pair) => ({ kind: 'pair', pair }));
  const ranges = chromPair.isEca() ? [] : chromPair.getRearrangementRanges();
  if (ranges.length === 0) return asPairs(chromPair.allelePairs);

  const isInside = (pair: AllelePair): boolean => {
    const physPos = pair.top.getPhysPosition();
    return (
      physPos !== undefined &&
      ranges.some(([start, end]) => start <= physPos && physPos <= end)
    );
  };

  // Rearrangement columns waiting for their place, leftmost range first.
  const pending = chromPair.allelePairs
    .filter(isRearrangementPair)
    .sort((a, b) => rangeStartOf(a) - rangeStartOf(b));
  const items: ChromosomeLayoutItem[] = [];
  let open = false;
  chromPair.allelePairs
    .filter((pair) => !isRearrangementPair(pair))
    .forEach((pair) => {
      const physPos = pair.top.getPhysPosition();
      // A rearrangement column goes in just before the first column at or
      // past the start of its range - and before that column's bracket.
      if (physPos !== undefined) {
        while (pending.length > 0 && rangeStartOf(pending[0]) <= physPos) {
          if (open) {
            items.push({ kind: 'close' });
            open = false;
          }
          items.push({ kind: 'pair', pair: pending.shift() as AllelePair });
        }
      }
      const inside = isInside(pair);
      if (inside && !open) items.push({ kind: 'open' });
      if (!inside && open) items.push({ kind: 'close' });
      open = inside;
      items.push({ kind: 'pair', pair });
    });
  if (open) items.push({ kind: 'close' });
  pending.forEach((pair) => items.push({ kind: 'pair', pair }));
  return items;
};
