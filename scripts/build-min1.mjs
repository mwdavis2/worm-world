#!/usr/bin/env node
// The mIn1[dpy-10(e128) mIs14] balancer strain as a FOLDER of importable CSVs:
//
//   node scripts/build-min1.mjs
//
// Writes data/mIn1/{variations,phenotypes,alleles,allele_exprs,expr_relations,
// strains,strain_alleles}.csv. The folder is self-contained on top of the
// shipped genes (dpy-10 is T14B4.7), so it can be loaded in one step with the
// data tables' "Import folder" button.
//
// - mIn1 is the II inversion of Edgley & Riddle 2001, with the sequenced
//   breakpoints II:3,553,628 and II:12,704,681 (Maroilley 2021).
// - dpy-10(e128) is a recessive class-5 Dpy-10, rescued by the wild type.
// - mIs14 is an integrated pharyngeal GFP, semidominant: one copy is dimmer
//   (Pmyo-2::GFP(weak)) than two (Pmyo-2::GFP). It sits inside the inversion.
// - the strain is homozygous (mIn1 homozygotes are viable).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const OUT_DIR = 'data/mIn1';
const CHROMOSOME = 'II';
const START = 3553628;
const END = 12704681;
const STRAIN = 'mIn1[dpy-10(e128) mIs14]';
const LOF_DOMINANCE = 4; // stored form of zygosity '5'
const ONE_COPY = 1;
const TWO_COPIES = 0;

const csvEscape = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const toCsv = (header, rows) =>
  [header, ...rows.map((r) => header.map((h) => r[h] ?? ''))].map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';

const genes = readFileSync('src-tauri/seed/genes.csv', 'utf8').split('\n').map((line) => line.split(','));
const gene = genes.find((r) => r[1] === 'dpy-10' && r[2] === CHROMOSOME);
if (!gene) {
  console.error('The shipped gene table has no dpy-10 on II');
  process.exit(1);
}
const [DPY10_SYS, , , , DPY10_CM] = gene;

// Linear interpolation of the map position at a physical position, from the
// shipped genes on the chromosome.
const anchors = genes
  .filter((r) => r[2] === CHROMOSOME && r[3] && r[4] !== undefined && r[4] !== '' && !Number.isNaN(Number(r[4])))
  .map((r) => [Number(r[3]), Number(r[4])]);
const geneticAt = (phys) => {
  const left = anchors.filter(([p]) => p <= phys).sort((a, b) => b[0] - a[0] || b[1] - a[1])[0];
  const right = anchors.filter(([p]) => p > phys).sort((a, b) => a[0] - b[0] || a[1] - b[1])[0];
  return left[1] + ((phys - left[0]) / (right[0] - left[0])) * (right[1] - left[1]);
};
const round2 = (n) => Math.round(n * 100) / 100;

const middle = Math.round((START + END) / 2);
const inversionCm = round2(geneticAt(middle));
const markerPhys = middle + 1000;
// strictly to the right of the inversion's own position so the genotype order is fixed
const markerCm = Math.max(round2(geneticAt(markerPhys)), round2(inversionCm + 0.01));

const variations = [
  { alleleName: 'mIn1', chromosome: CHROMOSOME, physLoc: middle, geneticLoc: inversionCm, recombSuppressorStart: START, recombSuppressorEnd: END, isLocationReference: 'false', percentLoss: '' },
  { alleleName: 'mIs14', chromosome: CHROMOSOME, physLoc: markerPhys, geneticLoc: markerCm, recombSuppressorStart: '', recombSuppressorEnd: '', isLocationReference: 'false', percentLoss: '' },
];
const phenotype = (name, wild, lethal) => ({ name, wild, short_name: name, description: '', male_mating: '', lethal, female_sterile: '', arrested: '', maturation_days: '' });
const phenotypes = [
  phenotype('Dpy-10', 0, 0),
  phenotype('Dpy-10', 1, ''),
  phenotype('Pmyo-2::GFP(weak)', 0, 0),
  phenotype('Pmyo-2::GFP', 0, 0),
];
const alleles = [
  { name: 'mIn1', contents: '', sysGeneName: '', variationName: 'mIn1' },
  { name: 'e128', contents: '', sysGeneName: DPY10_SYS, variationName: '' },
  { name: 'mIs14', contents: '', sysGeneName: '', variationName: 'mIs14' },
];
const alleleExprs = [
  { alleleName: 'e128', expressingPhenotypeName: 'Dpy-10', expressingPhenotypeWild: 0, dominance: LOF_DOMINANCE },
  { alleleName: 'mIs14', expressingPhenotypeName: 'Pmyo-2::GFP(weak)', expressingPhenotypeWild: 0, dominance: ONE_COPY },
  { alleleName: 'mIs14', expressingPhenotypeName: 'Pmyo-2::GFP', expressingPhenotypeWild: 0, dominance: TWO_COPIES },
];
const exprRelations = [
  { allele_name: 'e128', expressing_phenotype_name: 'Dpy-10', expressing_phenotype_wild: 0, altering_phenotype_name: 'Dpy-10', altering_phenotype_wild: 1, altering_condition: '', is_suppressing: 1 },
];

// Genotype text as Strain.toString builds it: alleles by genetic position.
const members = [
  { name: 'mIn1', label: 'mIn1', gen: inversionCm },
  { name: 'e128', label: 'dpy-10(e128)', gen: Number(DPY10_CM) },
  { name: 'mIs14', label: 'mIs14', gen: markerCm },
].sort((a, b) => a.gen - b.gen);
const strains = [
  {
    name: STRAIN,
    genotype: `${members.map((m) => m.label).join(' ')} ${CHROMOSOME}.`,
    description: 'mIn1 inversion balancer with dpy-10(e128) and the pharyngeal GFP mIs14 homozygous (Edgley and Riddle 2001).',
  },
];
const strainAlleles = members.map((m) => ({ strainName: STRAIN, alleleName: m.name, isOnTop: 'true', isOnBot: 'true' }));

mkdirSync(OUT_DIR, { recursive: true });
const write = (file, header, rows) => {
  writeFileSync(`${OUT_DIR}/${file}`, toCsv(header, rows));
  console.log(`${file}: ${rows.length} rows`);
};
write('variations.csv', ['alleleName', 'chromosome', 'physLoc', 'geneticLoc', 'recombSuppressorStart', 'recombSuppressorEnd', 'isLocationReference', 'percentLoss'], variations);
write('phenotypes.csv', ['name', 'wild', 'short_name', 'description', 'male_mating', 'lethal', 'female_sterile', 'arrested', 'maturation_days'], phenotypes);
write('alleles.csv', ['name', 'contents', 'sysGeneName', 'variationName'], alleles);
write('allele_exprs.csv', ['alleleName', 'expressingPhenotypeName', 'expressingPhenotypeWild', 'dominance'], alleleExprs);
write('expr_relations.csv', ['allele_name', 'expressing_phenotype_name', 'expressing_phenotype_wild', 'altering_phenotype_name', 'altering_phenotype_wild', 'altering_condition', 'is_suppressing'], exprRelations);
write('strains.csv', ['name', 'genotype', 'description'], strains);
write('strain_alleles.csv', ['strainName', 'alleleName', 'isOnTop', 'isOnBot'], strainAlleles);
