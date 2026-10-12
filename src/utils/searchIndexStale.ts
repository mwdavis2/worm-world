// The gene and allele search boxes keep the names in memory (see
// `searchIndex.ts`). Anything that writes genes or alleles calls this, so the
// next search reloads them. Kept apart from `searchIndex.ts` so the api
// modules can call it without importing the code that imports them.
let version = 0;

export const markSearchIndexStale = (): void => {
  version++;
};

export const searchIndexVersion = (): number => version;
