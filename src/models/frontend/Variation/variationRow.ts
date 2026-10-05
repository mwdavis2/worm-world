import { type db_Variation } from 'models/db/db_Variation';
import { interpolateGeneticLoc } from 'utils/geneticLocation';

/**
 * A variation as the Variations data table shows and edits it: the stored
 * suppressed range - one [start, end] pair - split into two plain number
 * columns, so each can be shown, edited, filtered and sorted on its own.
 */
export type VariationRow = Omit<db_Variation, 'recombSuppressor'> & {
  recombSuppressorStart: number | null;
  recombSuppressorEnd: number | null;
};

export const toVariationRow = (variation: db_Variation): VariationRow => {
  const { recombSuppressor, ...rest } = variation;
  return {
    ...rest,
    recombSuppressorStart: recombSuppressor?.[0] ?? null,
    recombSuppressorEnd: recombSuppressor?.[1] ?? null,
  };
};

/**
 * Back to the stored shape. The range is both numbers or neither: giving only
 * one, or a start that isn't before the end, is an error.
 */
export const toDbVariation = (row: VariationRow): db_Variation => {
  const {
    recombSuppressorStart: start,
    recombSuppressorEnd: end,
    ...rest
  } = row;
  if (start === null && end === null)
    return { ...rest, recombSuppressor: null };
  if (start === null || end === null)
    throw new Error(
      'Enter both a start and an end for the suppressed range, or leave both empty'
    );
  if (start >= end)
    throw new Error('The suppressed range must start before it ends');
  return { ...rest, recombSuppressor: [start, end] };
};

// Chromosomes with a genetic map to interpolate on; arrays (Ex) and the
// mitochondrial genome have none.
const MAPPED_CHROMOSOMES = ['I', 'II', 'III', 'IV', 'V', 'X'];

/**
 * A row with a physical position but no genetic position gets one worked out
 * from the Genes table (the same interpolation the New Allele dialog uses),
 * since crossovers only ever use the genetic position. Returns the row
 * unchanged if it already has one, has no physical position, or is on a
 * chromosome without a genetic map. `filled` says whether one was added.
 */
export const withDerivedGeneticLoc = async (
  row: VariationRow
): Promise<{ row: VariationRow; filled: boolean }> => {
  if (
    row.geneticLoc !== null ||
    row.physLoc === null ||
    row.chromosome === null ||
    !MAPPED_CHROMOSOMES.includes(row.chromosome)
  )
    return { row, filled: false };
  const geneticLoc = await interpolateGeneticLoc(row.chromosome, row.physLoc);
  return {
    row: { ...row, geneticLoc: Math.round(geneticLoc * 100) / 100 },
    filled: true,
  };
};
