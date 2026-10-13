// Unc loss-of-function phenotypes whose males cannot mate (CGC strain list,
// 2026-10-13): a reference allele annotated M-MATING-NO SUCCESS or
// M-MATING+POOR <1%WT (or, for unc-22, "Males cannot mate due to the unc-22
// mutation"). All loss-of-function alleles of a gene share its one phenotype, so
// they all inherit the flag. Genes graded 1-10% or better (unc-29, unc-49,
// unc-23's e611) are not marked, and genes with no mating text are left blank.
// unc-5 is marked on the instructor's call: its only mating note (NO SUCCESS) is
// on the double mutant unc-5(e53); nuc-1(e1392).
export const MALE_MATING_DEFECTIVE_PHENOTYPES = new Set([
  'Unc-22',
  'Unc-23',
  'Unc-31',
  'Unc-36',
  'Unc-5',
  'Unc-52',
  'Unc-60',
  'Unc-73',
]);

/** 1 when this (non-wild) phenotype is one of the above, else '' */
export const maleCrossingDefective = (name, wild) =>
  Number(wild) === 0 && MALE_MATING_DEFECTIVE_PHENOTYPES.has(name) ? 1 : '';
