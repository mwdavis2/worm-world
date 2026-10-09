import { Sex } from 'models/enums';
import { type Allele } from 'models/frontend/Allele/Allele';
import { type Strain } from 'models/frontend/Strain/Strain';

/**
 * The alleles on a hermaphrodite's bottom X that are not also on its top X,
 * which a male made from it leaves off (he keeps the top X). Empty for a male
 * or when the bottom X carries nothing the top does not.
 */
export const allelesLeftOffMale = (strain: Strain): string[] => {
  if (strain.sex !== Sex.Hermaphrodite) return [];
  const x = strain.chromPairMap.get('X');
  const named = (alleles: Allele[]): string[] =>
    alleles
      .filter((allele) => !allele.isWild() && !allele.isAbsent())
      .map((allele) => allele.name);
  const kept = new Set(named(x?.getTop() ?? []));
  // an allele on both X's (a homozygote) is not lost
  return [...new Set(named(x?.getBot() ?? []))].filter(
    (name) => !kept.has(name)
  );
};

/** What to tell the user when a toggle to male leaves alleles off, or undefined. */
export const leftOffMaleMessage = (strain: Strain): string | undefined => {
  const names = allelesLeftOffMale(strain);
  if (names.length === 0) return undefined;
  const list = names.join(', ');
  return `${list} ${names.length === 1 ? 'is' : 'are'} on the other X, so ${
    names.length === 1 ? 'it is' : 'they are'
  } left off the male, who keeps the top X. Toggling back restores ${
    names.length === 1 ? 'it' : 'them'
  }.`;
};
