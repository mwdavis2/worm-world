// Looks notation's allele names up in the database (todo #5 decode).
import { getAllele } from 'api/allele';
import { Allele } from 'models/frontend/Allele/Allele';
import { NotationGenotypeError } from './notationGenotype';

/**
 * The alleles for a set of names, keyed by name. A name the database does not
 * have is an error that lists every such name.
 */
export const resolveAlleles = async (
  names: Iterable<string>
): Promise<Map<string, Allele>> => {
  const found = new Map<string, Allele>();
  const missing: string[] = [];
  await Promise.all(
    [...names].map(async (name) => {
      const record = await getAllele(name).catch(() => undefined);
      if (record === undefined) missing.push(name);
      else found.set(name, await Allele.createFromRecord(record));
    })
  );
  if (missing.length > 0)
    throw new NotationGenotypeError(
      `Unknown allele${missing.length === 1 ? '' : 's'}: ${missing
        .sort()
        .map((name) => `"${name}"`)
        .join(', ')}`
    );
  return found;
};
