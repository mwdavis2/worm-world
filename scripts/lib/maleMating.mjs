// Male mating of the Unc loss-of-function phenotypes. All loss-of-function
// alleles of a gene share its one phenotype, so they all inherit these values.
//
// male_mating holds the ME score of the C. elegans I/II book as WormBase shows
// it (0 = no mating, higher = better). ME0 phenotypes are also flagged
// male_crossing_defective (the male cannot be the male parent of a cross); ME1
// and above are not flagged (a gene with any allele at ME1 or above is left OK).
//
// ME0 (WormBase, 2026-10-13): unc-5 (e53), unc-9 (e101), unc-18 (e81), unc-22
// (e66), unc-52 (e444), unc-60 (e723), unc-73 (e936), unc-76 (e911), unc-119
// (e2498; ed3, ed4, ed9 similar).
// Unc-36: e251 is ME0 but e873 (the eT1 breakpoint, the only unc-36 allele in the
// seed) is ME1, so it is left OK at ME1 (the instructor's decision; the CGC has the
// eT1 strain at M-MATING+POOR <1%WT).
// Unc-44 (e362) is ME0 in WormBase (2026-10-13) and M-MATING-NO SUCCESS in the CGC (CB362).
// Not marked: unc-24 (e138, ME1), unc-4 (e120, ME1; a first-edition entry says
// ME0), unc-75 (e950, ME2), unc-23 (e25, ME1; the CGC had e324 at POOR <1%) and
// unc-31 (e169, ME1; the CGC had POOR <1%), unc-29 (e193, ME2; CGC 1-10%) and
// unc-49 (e382, ME2; CGC 1-10%).
export const MALE_MATING_DEFECTIVE_PHENOTYPES = new Set([
  'Unc-5',
  'Unc-9',
  'Unc-18',
  'Unc-22',
  'Unc-44',
  'Unc-52',
  'Unc-60',
  'Unc-73',
  'Unc-76',
  'Unc-119',
]);

// ME scores of phenotypes that are not defective (WormBase)
const ME_SCORES = new Map([
  ['Unc-24', 1], // e138
  ['Unc-4', 1], // e120
  ['Unc-75', 2], // e950
  ['Unc-23', 1], // e25
  ['Unc-31', 1], // e169
  ['Unc-36', 1], // e873 (e251 is ME0)
  ['Unc-29', 2], // e193
  ['Unc-49', 2], // e382
]);

/** 1 when this (non-wild) phenotype is one of the above, else '' */
export const maleCrossingDefective = (name, wild) =>
  Number(wild) === 0 && MALE_MATING_DEFECTIVE_PHENOTYPES.has(name) ? 1 : '';

/** The male_mating value for this phenotype: 0 for the defective ones, the ME score for the others, '' when not known */
export const maleMatingScore = (name, wild) => {
  if (Number(wild) !== 0) return '';
  if (MALE_MATING_DEFECTIVE_PHENOTYPES.has(name)) return 0;
  return ME_SCORES.get(name) ?? '';
};
