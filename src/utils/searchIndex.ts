import { getFilteredAllelesWithGeneFilter } from 'api/allele';
import { getGenes } from 'api/gene';
import { type db_Allele } from 'models/db/db_Allele';
import { type db_Gene } from 'models/db/db_Gene';
import { searchIndexVersion } from 'utils/searchIndexStale';

/**
 * The gene and allele search boxes search names held in memory: the genes
 * table is about 47,000 short names, which is far quicker to search in the
 * page than to ask the database about on every keystroke. That is what lets
 * the boxes answer from the first character with no pause. The names load on
 * first use (the boxes warm them as they open) and reload after anything that
 * writes genes or alleles marks them stale (`markSearchIndexStale`).
 */

/** At most this many matches are listed; the box says how many more there are. */
export const MAX_RESULTS = 50;

interface Loaded<T> {
  version: number;
  entries: Promise<T[]>;
}

const cached = <T>(load: () => Promise<T[]>): (() => Promise<T[]>) => {
  let current: Loaded<T> | undefined;
  return async () => {
    const version = searchIndexVersion();
    if (current === undefined || current.version !== version) {
      const entries = load();
      current = { version, entries };
      // a failed load must not stay cached
      entries.catch(() => {
        if (current?.entries === entries) current = undefined;
      });
    }
    return await current.entries;
  };
};

export interface GeneEntry {
  gene: db_Gene;
  desc: string;
  sys: string;
}

export interface AlleleEntry {
  allele: db_Allele;
  gene: db_Gene;
  name: string;
  desc: string;
}

export const getGeneEntries = cached<GeneEntry>(async () =>
  (await getGenes()).map((gene) => ({
    gene,
    desc: (gene.descName ?? '').toLowerCase(),
    sys: gene.sysName.toLowerCase(),
  }))
);

export const getAlleleEntries = cached<AlleleEntry>(async () =>
  (
    await getFilteredAllelesWithGeneFilter(
      { filters: [], orderBy: [] },
      { filters: [], orderBy: [] }
    )
  ).map(([allele, gene]) => ({
    allele,
    gene,
    name: allele.name.toLowerCase(),
    // alleles with no gene come back with empty gene fields
    desc: (gene.descName ?? '').toLowerCase(),
  }))
);

export interface SearchResult<T> {
  /** The best matches, at most `MAX_RESULTS` */
  matches: T[];
  /** How many entries matched in all */
  total: number;
}

/**
 * Entries with `rank` 0 first, then 1 and so on, each group in `sortKey` order.
 * `rank` returns undefined for an entry that does not match.
 */
const search = <T>(
  entries: T[],
  rank: (entry: T) => number | undefined,
  sortKey: (entry: T, rank: number) => string
): SearchResult<T> => {
  const ranked: Array<[number, string, T]> = [];
  for (const entry of entries) {
    const r = rank(entry);
    if (r !== undefined) ranked.push([r, sortKey(entry, r), entry]);
  }
  ranked.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] - b[0];
    return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
  });
  return {
    matches: ranked.slice(0, MAX_RESULTS).map(([, , entry]) => entry),
    total: ranked.length,
  };
};

/**
 * Genes whose descriptive name starts with the text, then those whose
 * systematic name does, then those that merely contain it in either.
 */
export const searchGenes = (
  entries: GeneEntry[],
  text: string
): SearchResult<GeneEntry> => {
  const query = text.trim().toLowerCase();
  if (query === '') return { matches: [], total: 0 };
  const keys = (entry: GeneEntry): string[] => [entry.desc, entry.sys];
  return search(
    entries,
    (entry) => {
      const k = keys(entry);
      for (let i = 0; i < k.length; i++) if (k[i].startsWith(query)) return i;
      for (let i = 0; i < k.length; i++)
        if (k[i].includes(query)) return k.length + i;
      return undefined;
    },
    (entry, rank) => keys(entry)[rank % 2]
  );
};

/**
 * Alleles whose name or gene name starts with the text, then those that
 * merely contain it; each group in allele-name order. `include` drops the
 * alleles that should not be offered (for instance ones already chosen)
 * before anything is counted.
 */
export const searchAlleles = (
  entries: AlleleEntry[],
  text: string,
  include: (allele: db_Allele) => boolean = () => true
): SearchResult<AlleleEntry> => {
  const query = text.trim().toLowerCase();
  if (query === '') return { matches: [], total: 0 };
  return search(
    entries,
    (entry) => {
      if (entry.name.startsWith(query) || entry.desc.startsWith(query))
        return include(entry.allele) ? 0 : undefined;
      if (entry.name.includes(query) || entry.desc.includes(query))
        return include(entry.allele) ? 1 : undefined;
      return undefined;
    },
    (entry) => entry.name
  );
};
