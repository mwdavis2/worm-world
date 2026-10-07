#!/usr/bin/env node
// Real alleles for the markers the translocation balancers carry (todo #25),
// as importable CSVs:
//
//   node scripts/build-balancer-alleles.mjs
//
// Writes data/balancer_alleles/{variations,phenotypes,alleles,allele_exprs,
// expr_relations}.csv (import in that order; the gene rows they point at come
// from the gene table and data/wormbase/placeholder_genes.csv).
//
// Every allele is a recessive loss-of-function ("class 5", stored dominance 4,
// like a standard LOF gene added on the New Allele dialog's Basic tab) that
// expresses a capitalized phenotype. A marker gene's allele is also "rescued by
// wild-type": its phenotype is suppressed by the wild-type phenotype named for
// the gene (also capitalized, wild = 1), which must exist as a row. The let
// alleles are plain recessive lethals - no rescuing row, no relation.
//
// The integrated GFP transgenes qIs51 and qIs50 (nT1 variants) and qIs48 (an
// hT2 variant) are variation-type alleles like oxIs12, placed in the middle of
// their balancer's balanced range (nT1(IV), nT1(IV) and hT2(I)); each expresses one dominant "1 or 2 copies" GFP phenotype, no brighter
// with two copies, and has no relation.
//
// n754dm (one allele - "dm" is a qualifier, there is no separate n754) is a
// semidominant lesion of an unknown unc gene: one copy gives Unc(n754dm), two
// copies are lethal and male sterile (the Let phenotype's flags). No relations.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { zipFolder } from './lib/zipFolder.mjs';

const OUT_DIR = 'data/balancer_alleles';
const LOF_DOMINANCE = 4; // stored form of zygosity '5', "2 copies (lof)"

// A gene allele with a named gene: [allele, gene descriptive name, phenotype override].
const MARKERS = [
  ['e873', 'unc-36'],
  ['nT1vul', 'egl-18', 'Egl-18(Vul)'],
  ['e937', 'bli-4'],
  ['e1467', 'him-5'],
  ['h662', 'dpy-18'],
  ['e678', 'lon-2'],
  ['e403', 'unc-29'],
];
// Lethal alleles: [allele, gene key]. The genes are placeholders (data/wormbase/
// placeholder_genes.csv) except let-500; nT1_1 / nT1_2 are stand-in allele names.
const LETHALS = [
  ['s2165', 'let-500'],
  ['s1799', 'let-?(s1799)'],
  ['n886', 'let-?(n886)'],
  ['m435', 'let-?(m435)'],
  ['q782', 'let-?(q782)'],
  ['h661', 'let-?(h661)'],
  ['nT1_1', 'let-?(nT1_1)'],
  ['nT1_2', 'let-?(nT1_2)'],
];
const LETHAL_PHENOTYPE = 'Let';
const N754_PHENOTYPE = 'Unc(n754dm)';
const GFP_PHENOTYPE = 'Pharyngeal+embryo+intestine::GFP';
const GFP_DOMINANCE = 2; // stored form of zygosity '1or2'
// [allele, the balancer half whose range it sits in the middle of]
const TRANSGENES = [
  ['qIs51', 'nT1(IV)'],
  ['qIs50', 'nT1(IV)'],
  ['qIs48', 'hT2(I)'],
];

const parseCsv = (path) =>
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l !== '')
    .slice(1)
    .map((l) => l.split(','));
const csvEscape = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const toCsv = (header, rows) =>
  [header, ...rows.map((r) => header.map((h) => r[h] ?? ''))].map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const errors = [];
const check = (condition, message) => {
  if (!condition) errors.push(message);
};

const genes = parseCsv('src-tauri/seed/genes.csv');
const placeholders = parseCsv('data/wormbase/placeholder_genes.csv');
const geneKeys = new Set([...genes, ...placeholders].map(([sys]) => sys));
const keyOfName = new Map();
genes.forEach(([sys, desc]) => keyOfName.set(desc, [...(keyOfName.get(desc) ?? []), sys]));

// Genetic position (cM) at a physical position, interpolated between the
// nearest genes on the chromosome (the same method as the translocation data).
const anchorsOf = (chromosome) => {
  const byPos = new Map();
  genes.forEach(([, , chr, phys, gen]) => {
    if (chr === chromosome && phys !== '' && gen !== '')
      byPos.set(Number(phys), [...(byPos.get(Number(phys)) ?? []), Number(gen)]);
  });
  return [...byPos.entries()]
    .map(([phys, gens]) => [phys, gens.reduce((a, b) => a + b, 0) / gens.length])
    .sort((a, b) => a[0] - b[0]);
};
const geneticAt = (chromosome, phys) => {
  const anchors = anchorsOf(chromosome);
  let lo = 0;
  let hi = anchors.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid][0] < phys) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return anchors[0][1];
  if (lo >= anchors.length) return anchors[anchors.length - 1][1];
  const [p0, g0] = anchors[lo - 1];
  const [p1, g1] = anchors[lo];
  return g0 + ((g1 - g0) * (phys - p0)) / (p1 - p0);
};

const phenotypes = new Map(); // `${name}|${wild}` -> row
const addPhenotype = (name, wild, extra = {}) => {
  const key = `${name}|${wild}`;
  if (phenotypes.has(key)) return;
  phenotypes.set(key, {
    name,
    wild,
    short_name: name,
    description: '',
    male_mating: extra.maleMating ?? '',
    lethal: extra.lethal ?? '',
    female_sterile: '',
    arrested: '',
    maturation_days: '',
  });
};
const variations = [];
const alleles = [];
const alleleExprs = [];
const exprRelations = [];

const addAllele = (name, geneKey, phenotype) => {
  check(geneKeys.has(geneKey), `allele ${name}: gene ${geneKey} is not in the gene table or the placeholder genes`);
  alleles.push({ name, contents: '', sysGeneName: geneKey, variationName: '' });
  alleleExprs.push({
    alleleName: name,
    expressingPhenotypeName: phenotype,
    expressingPhenotypeWild: 0,
    dominance: LOF_DOMINANCE,
  });
};

MARKERS.forEach(([allele, geneName, phenotypeOverride]) => {
  const keys = keyOfName.get(geneName) ?? [];
  check(keys.length === 1, `gene ${geneName}: expected exactly one gene row, found ${keys.length}`);
  const rescuer = capitalize(geneName); // the wild-type phenotype named for the gene
  const phenotype = phenotypeOverride ?? rescuer;
  addPhenotype(phenotype, 0, { lethal: 0 });
  addPhenotype(rescuer, 1);
  addAllele(allele, keys[0], phenotype);
  exprRelations.push({
    allele_name: allele,
    expressing_phenotype_name: phenotype,
    expressing_phenotype_wild: 0,
    altering_phenotype_name: rescuer,
    altering_phenotype_wild: 1,
    altering_condition: '',
    is_suppressing: 1,
  });
});

addPhenotype(LETHAL_PHENOTYPE, 0, { lethal: 1, maleMating: 0 });
LETHALS.forEach(([allele, geneKey]) => addAllele(allele, geneKey, LETHAL_PHENOTYPE));

// Transgenes: variations in the middle of their balancer half's range, and their alleles.
const halfVariations = parseCsv('data/translocations/variations.csv');
addPhenotype(GFP_PHENOTYPE, 0, { lethal: 0 });
TRANSGENES.forEach(([name, half]) => {
  const row = halfVariations.find(([variationName]) => variationName === half);
  check(row !== undefined, `${name}: ${half} is missing from data/translocations/variations.csv`);
  if (row === undefined) return;
  const [, chromosome, , , rangeStart, rangeEnd] = row;
  const middle = Math.round((Number(rangeStart) + Number(rangeEnd)) / 2);
  variations.push({
    alleleName: name,
    chromosome,
    physLoc: middle,
    geneticLoc: Math.round(geneticAt(chromosome, middle) * 100) / 100,
    recombSuppressorStart: '',
    recombSuppressorEnd: '',
    isLocationReference: 'false',
    percentLoss: '',
  });
  alleles.push({ name, contents: '', sysGeneName: '', variationName: name });
  alleleExprs.push({
    alleleName: name,
    expressingPhenotypeName: GFP_PHENOTYPE,
    expressingPhenotypeWild: 0,
    dominance: GFP_DOMINANCE,
  });
});

// n754dm: 1 copy -> Unc(n754dm), 2 copies -> Let. No relations.
addPhenotype(N754_PHENOTYPE, 0, { lethal: 0 });
alleles.push({ name: 'n754dm', contents: '', sysGeneName: 'unc-?(n754dm)', variationName: '' });
check(geneKeys.has('unc-?(n754dm)'), 'allele n754dm: gene unc-?(n754dm) is not in the placeholder genes');
alleleExprs.push(
  { alleleName: 'n754dm', expressingPhenotypeName: N754_PHENOTYPE, expressingPhenotypeWild: 0, dominance: 1 },
  { alleleName: 'n754dm', expressingPhenotypeName: LETHAL_PHENOTYPE, expressingPhenotypeWild: 0, dominance: 0 }
);

const names = new Set();
alleles.forEach((a) => {
  check(!names.has(a.name), `duplicate allele name ${a.name}`);
  names.add(a.name);
});
if (errors.length > 0) {
  console.error(`Self-checks failed (${errors.length}):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const write = (file, header, rows) => {
  writeFileSync(`${OUT_DIR}/${file}`, toCsv(header, rows));
  console.log(`${file}: ${rows.length} rows`);
};
write('variations.csv', ['alleleName', 'chromosome', 'physLoc', 'geneticLoc', 'recombSuppressorStart', 'recombSuppressorEnd', 'isLocationReference', 'percentLoss'], variations);
write('phenotypes.csv', ['name', 'wild', 'short_name', 'description', 'male_mating', 'lethal', 'female_sterile', 'arrested', 'maturation_days'], [...phenotypes.values()]);
write('alleles.csv', ['name', 'contents', 'sysGeneName', 'variationName'], alleles);
write('allele_exprs.csv', ['alleleName', 'expressingPhenotypeName', 'expressingPhenotypeWild', 'dominance'], alleleExprs);
write('expr_relations.csv', ['allele_name', 'expressing_phenotype_name', 'expressing_phenotype_wild', 'altering_phenotype_name', 'altering_phenotype_wild', 'altering_condition', 'is_suppressing'], exprRelations);
zipFolder(OUT_DIR);
