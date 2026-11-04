import { type Gamete } from 'models/frontend/Strain/Strain';

/**
 * A gamete as its alleles, chromosome by chromosome (separated by ";"): "+" for
 * a wild copy and "0" for an absent X, for example "a1 +; b1" or "0".
 */
export const gameteLabel = (gamete: Gamete): string =>
  gamete.chromosomes
    .map((chromosome) =>
      chromosome
        .map((allele) =>
          allele.isAbsent() ? '0' : allele.isWild() ? '+' : allele.name
        )
        .join(' ')
    )
    .join('; ');
