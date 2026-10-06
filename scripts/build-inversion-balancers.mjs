#!/usr/bin/env node
// The CRISPR inversion balancers (crossover suppressors) of Dejima et al. 2018
// (Cell Reports 22:232-241) and the strains that carry a Pmyo-2 fluorescent
// marker, as importable CSVs (data/Inversion_strains.pdf):
//
//   node scripts/build-inversion-balancers.mjs
//
// Writes data/inversion_balancers/{variations,phenotypes,alleles,allele_exprs,
// expr_relations,strains,strain_alleles}.csv (import in that order; the gene
// rows they point at are in the shipped gene table).
//
// - Each balancer is one variation with a SINGLE range, from the positions of
//   its left and right genes in the gene table (Table 1), placed at the range's
//   midpoint with its cM interpolated, like the existing tmC5 row.
// - The marker insertions keep their tmIs names (dpy-2(tmIs1189) is the allele
//   tmIs1189 of dpy-2). Each expresses its Pmyo-2 phenotype (dominant, one or
//   two copies) and, only where Table 2 shows the gene's own phenotype, a
//   recessive class-5 phenotype rescued by the wild type.
// - A breakpoint inside a gene that gives a visible phenotype in Table 2 is a
//   real allele of that gene, named tmCXmec / tmCXunc / tmCXlon.
// - Strains are homozygous unless the homozygote would be lethal (none is).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const OUT_DIR = 'data/inversion_balancers';
const LOF_DOMINANCE = 4; // stored form of zygosity '5', "2 copies (lof)"
const DOMINANT_DOMINANCE = 2; // stored form of '1or2'
const CHROMOSOME_ORDER = ['I', 'II', 'III', 'IV', 'V', 'X', 'Ex'];

// Table 1: [balancer, chromosome, left gene, right gene]
const BALANCERS = [
  ['tmC20', 'I', 'F53G12.8', 'sre-23'],
  ['tmC18', 'I', 'gsp-3', 'dnj-27'], // Table 1 prints "snj-27"; the genotype says dnj-27
  ['tmC27', 'I', 'ile-1', 'dkf-1'],
  ['tmC6', 'II', 'ZK1240.1', 'asm-1'],
  ['tmC29', 'III', 'hlh-4', 'ttr-52'],
  ['tmC25', 'IV', 'kvs-5', 'unc-8'],
  ['tmC5', 'IV', 'C01B10.3', 'unc-31'],
  ['tmC9', 'IV', 'mec-3', 'lgc-52'],
  ['tmC16', 'V', 'flp-34', 'T10H9.8'],
  ['tmC3', 'V', 'unc-83', 'lon-3'],
  ['tmC12', 'V', 'unc-23', 'C01G10.10'],
  ['tmC30', 'X', 'Y102A11A.6', 'mec-10'], // Table 1 prints "Y102A11A6"
  ['tmC24', 'X', 'mec-10', 'F59F4.2'],
];

// Breakpoints inside genes with a visible phenotype in Table 2:
// [allele, balancer, gene]
const BREAKPOINTS = [
  ['tmC5mec', 'tmC5', 'mec-3'],
  ['tmC5unc', 'tmC5', 'unc-31'],
  ['tmC9mec', 'tmC9', 'mec-3'],
  ['tmC9unc', 'tmC9', 'unc-31'],
  ['tmC3lon', 'tmC3', 'lon-3'],
  ['tmC3unc', 'tmC3', 'unc-23'], // unc-83 is also at a tmC3 breakpoint
  ['tmC12lon', 'tmC12', 'lon-3'],
  ['tmC12unc', 'tmC12', 'unc-23'],
  ['tmC30lon', 'tmC30', 'lon-2'],
  ['tmC30mec', 'tmC30', 'mec-10'],
  ['tmC24mec', 'tmC24', 'mec-10'],
];

// Pmyo-2 marker insertions: [allele, gene, marker, the gene's own visible phenotype]
const V = 'Pmyo-2::Venus';
const M = 'Pmyo-2::mCherry';
const G = 'Pmyo-2::GFP';
const INSERTIONS = [
  ['tmIs1228', 'egl-9', V],
  ['tmIs1230', 'egl-9', M],
  ['tmIs1220', 'F36H1.3', V],
  ['tmIs1189', 'dpy-2', V, 'Dpy'],
  ['tmIs1208', 'dpy-2', M, 'Dpy'],
  ['tmIs1221', 'F36H1.2', V],
  ['tmIs1194', 'egl-9', V],
  ['tmIs1197', 'egl-9', M],
  ['tmIs1210', 'unc-60', V, 'Unc'],
  ['tmIs1237', 'unc-60', M, 'Unc'],
  ['tmIs1200', 'dpy-5', V, 'Dpy'],
  ['tmIs1236', 'dpy-5', M, 'Dpy'],
  ['tmIs1219', 'unc-14', V], // Unc not detectable
  ['tmIs1240', 'F23D12.4', V],
  ['tmIs1233', 'F23D12.4', M],
  ['tmIs1241', 'unc-5', V, 'Unc'],
  ['tmIs1239', 'unc-75', V, 'Unc'],
  ['tmIs1247', 'ubc-17', V],
  ['tmIs1243', 'ubc-17', M],
  ['tmIs1259', 'unc-49', G, 'Unc'],
];

// Deletion alleles: [allele, gene, the gene's own visible phenotype]
const DELETIONS = [
  ['tm9715', 'dpy-5', 'Dpy'],
  ['tm9719', 'unc-9', 'Unc'],
  ['tm9718', 'unc-9', 'Unc'],
  ['tm750', 'lig-4'], // no visible phenotype
];

// The rescue array of the unc-9 strains: expresses the wild-type unc-9
// phenotype (which rescues the Unc of the deletion) and intestinal GFP.
const ARRAY = { allele: 'tmEx4950', rescues: 'unc-9', marker: 'Pvha-6::gfp' };

// Table 2: [strain, balancer, extra alleles]
const STRAINS = [
  ['FX30134', 'tmC3', ['tmIs1228']],
  ['FX30135', 'tmC3', ['tmIs1230']],
  ['FX30140', 'tmC5', ['tmIs1220']],
  ['FX19668', 'tmC6', ['tmIs1189']],
  ['FX30138', 'tmC6', ['tmIs1208']],
  ['FX30234', 'tmC9', ['tmIs1221']],
  ['FX30152', 'tmC12', ['tmIs1194']],
  ['FX30153', 'tmC12', ['tmIs1197']],
  ['FX30233', 'tmC16', ['tmIs1210']],
  ['FX30161', 'tmC16', ['tmIs1237']],
  ['FX30167', 'tmC18', ['tmIs1200']],
  ['FX30168', 'tmC18', ['tmIs1236']],
  ['FX30177', 'tmC20', ['tmIs1219']],
  ['FX30179', 'tmC20', ['tmIs1219', 'tm9715']],
  ['FX30240', 'tmC24', ['tmIs1240']],
  ['FX30123', 'tmC24', ['tmIs1233']],
  ['FX30194', 'tmC24', ['tmIs1240', 'tm9719']],
  ['FX30252', 'tmC24', ['tmIs1240', 'tm9719', ARRAY.allele]],
  ['FX30186', 'tmC24', ['tmIs1233', 'tm9718']],
  ['FX30253', 'tmC24', ['tmIs1233', 'tm9718', ARRAY.allele]],
  ['FX30203', 'tmC25', ['tmIs1241']],
  ['FX30208', 'tmC27', ['tmIs1239']],
  ['FX30259', 'tmC29', ['tmIs1259', 'tm750']],
  ['FX30218', 'tmC30', ['tmIs1247']],
  ['FX30236', 'tmC30', ['tmIs1243']],
];

const parseCsv = (path) =>
  readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l !== '').slice(1).map((l) => l.split(','));
const csvEscape = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const toCsv = (header, rows) =>
  [header, ...rows.map((r) => header.map((h) => r[h] ?? ''))].map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const errors = [];
const check = (condition, message) => {
  if (!condition) errors.push(message);
};

// ------------------------------------------------------------------- genes
const geneRows = parseCsv('src-tauri/seed/genes.csv').map(([sys, desc, chr, phys, gen]) => ({
  sys,
  desc: desc === '' ? sys : desc,
  chr,
  phys: Number(phys),
  gen: Number(gen),
}));
const geneNamed = (name) => {
  const hits = geneRows.filter((g) => g.sys === name || g.desc === name);
  const unique = [...new Map(hits.map((g) => [g.sys, g])).values()];
  check(unique.length === 1, `gene ${name}: expected exactly one gene row, found ${unique.length}`);
  return unique[0] ?? { sys: name, desc: name, chr: '?', phys: 0, gen: 0 };
};

// Genetic position (cM) at a physical position, interpolated between the
// nearest genes on the chromosome (anchors sharing a position are averaged).
const anchorsByChr = new Map();
geneRows.forEach((g) => {
  if (Number.isNaN(g.phys) || Number.isNaN(g.gen)) return;
  const byPos = anchorsByChr.get(g.chr) ?? new Map();
  byPos.set(g.phys, [...(byPos.get(g.phys) ?? []), g.gen]);
  anchorsByChr.set(g.chr, byPos);
});
const anchorsOf = (chr) =>
  [...(anchorsByChr.get(chr) ?? new Map()).entries()]
    .map(([phys, gens]) => [phys, gens.reduce((a, b) => a + b, 0) / gens.length])
    .sort((a, b) => a[0] - b[0]);
const geneticAt = (chr, phys) => {
  const anchors = anchorsOf(chr);
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
const round2 = (n) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ tables
const variations = [];
const phenotypes = new Map();
const alleles = [];
const alleleExprs = [];
const exprRelations = [];
// allele name -> { label, chr, gen } for the genotype text
const info = new Map();

const addPhenotype = (name, wild, lethal = '') => {
  const key = `${name}|${wild}`;
  if (phenotypes.has(key)) return;
  phenotypes.set(key, {
    name,
    wild,
    short_name: name,
    description: '',
    male_mating: '',
    lethal,
    female_sterile: '',
    arrested: '',
    maturation_days: '',
  });
};
const addExpr = (allele, phenotype, wild, dominance) =>
  alleleExprs.push({
    alleleName: allele,
    expressingPhenotypeName: phenotype,
    expressingPhenotypeWild: wild,
    dominance,
  });

// A recessive class-5 loss of function of `gene`, rescued by the wild type:
// the capitalized phenotype, its wild-type counterpart row, and the relation.
const addLossOfFunction = (allele, gene) => {
  const rescuer = capitalize(gene.desc);
  addPhenotype(rescuer, 0, 0);
  addPhenotype(rescuer, 1);
  addExpr(allele, rescuer, 0, LOF_DOMINANCE);
  exprRelations.push({
    allele_name: allele,
    expressing_phenotype_name: rescuer,
    expressing_phenotype_wild: 0,
    altering_phenotype_name: rescuer,
    altering_phenotype_wild: 1,
    altering_condition: '',
    is_suppressing: 1,
  });
};

const addGeneAllele = (allele, geneName) => {
  const gene = geneNamed(geneName);
  alleles.push({ name: allele, contents: '', sysGeneName: gene.sys, variationName: '' });
  info.set(allele, { label: `${gene.desc}(${allele})`, chr: gene.chr, gen: gene.gen });
  return gene;
};

const rangeOf = new Map(); // balancer -> [start, end]
BALANCERS.forEach(([name, chr, left, right]) => {
  const l = geneNamed(left);
  const r = geneNamed(right);
  check(l.chr === chr && r.chr === chr, `${name}: ${left}/${right} are not both on ${chr}`);
  const start = Math.min(l.phys, r.phys);
  const end = Math.max(l.phys, r.phys);
  const middle = Math.round((start + end) / 2);
  rangeOf.set(name, [start, end]);
  variations.push({
    alleleName: name,
    chromosome: chr,
    physLoc: middle,
    geneticLoc: round2(geneticAt(chr, middle)),
    recombSuppressorStart: start,
    recombSuppressorEnd: end,
    isLocationReference: 'false',
    percentLoss: '',
  });
  alleles.push({ name, contents: '', sysGeneName: '', variationName: name });
  info.set(name, { label: name, chr, gen: round2(geneticAt(chr, middle)) });
});

BREAKPOINTS.forEach(([allele, balancer, geneName]) => {
  check(rangeOf.has(balancer), `${allele}: unknown balancer ${balancer}`);
  addLossOfFunction(allele, addGeneAllele(allele, geneName));
});

const insertionOf = new Map();
INSERTIONS.forEach(([allele, geneName, marker, ownPhenotype]) => {
  const gene = addGeneAllele(allele, geneName);
  addPhenotype(marker, 0, 0);
  addExpr(allele, marker, 0, DOMINANT_DOMINANCE);
  if (ownPhenotype !== undefined) addLossOfFunction(allele, gene);
  insertionOf.set(allele, gene);
});
DELETIONS.forEach(([allele, geneName, ownPhenotype]) => {
  const gene = addGeneAllele(allele, geneName);
  if (ownPhenotype !== undefined) addLossOfFunction(allele, gene);
});

// The rescue array: an Ex variation, expressing the wild-type phenotype of the
// gene it rescues and its own marker.
variations.push({
  alleleName: ARRAY.allele,
  chromosome: 'Ex',
  physLoc: '',
  geneticLoc: '',
  recombSuppressorStart: '',
  recombSuppressorEnd: '',
  isLocationReference: 'false',
  percentLoss: '',
});
alleles.push({ name: ARRAY.allele, contents: '', sysGeneName: '', variationName: ARRAY.allele });
info.set(ARRAY.allele, { label: ARRAY.allele, chr: 'Ex', gen: 0 });
addPhenotype(ARRAY.marker, 0, 0);
addExpr(ARRAY.allele, ARRAY.marker, 0, DOMINANT_DOMINANCE);
const rescued = capitalize(geneNamed(ARRAY.rescues).desc);
check(phenotypes.has(`${rescued}|1`), `${ARRAY.allele}: no wild-type ${rescued} phenotype to express`);
addExpr(ARRAY.allele, rescued, 1, DOMINANT_DOMINANCE);

// Every marker gene should lie inside its balancer's range
STRAINS.forEach(([strain, balancer, extras]) => {
  const [start, end] = rangeOf.get(balancer) ?? [0, 0];
  extras.forEach((allele) => {
    const gene = insertionOf.get(allele);
    if (gene !== undefined)
      check(gene.phys >= start && gene.phys <= end, `${strain}: ${allele} (${gene.desc}, ${gene.phys}) is outside ${balancer} ${start}-${end}`);
  });
});

// ------------------------------------------------------------------ strains
// Genotype text as Strain.toString builds it: chromosomes in order, each
// "<alleles>[/<wild partners>] <chromosome>", alleles sorted by genetic
// position with the same comparator as AllelePair.sort. A strain here is
// homozygous (nothing is lethal); an extrachromosomal array is "array/+ Ex".
const genotypeOf = (names) => {
  const byChr = new Map();
  names.forEach((name) => {
    const item = info.get(name);
    byChr.set(item.chr, [...(byChr.get(item.chr) ?? []), item]);
  });
  const parts = CHROMOSOME_ORDER.filter((chr) => byChr.has(chr)).map((chr) => {
    const items = byChr.get(chr);
    if (chr === 'Ex') {
      items.sort((a, b) => (a.label < b.label ? -1 : 1));
      return `${items.map((i) => i.label).join(' ')}/${items.map(() => '+').join(' ')} Ex`;
    }
    items.sort((a, b) => (a.gen < b.gen ? -1 : 1));
    return `${items.map((i) => i.label).join(' ')} ${chr}`;
  });
  return `${parts.join('; ')}.`;
};

const strains = [];
const strainAlleles = [];
STRAINS.forEach(([name, balancer, extras]) => {
  const built = BREAKPOINTS.filter(([, b]) => b === balancer).map(([allele]) => allele);
  const all = [balancer, ...built, ...extras];
  all.forEach((allele) => check(info.has(allele), `${name}: allele ${allele} is not defined`));
  const insertion = extras.filter((a) => insertionOf.has(a)).map((a) => info.get(a).label);
  strains.push({
    name,
    genotype: genotypeOf(all),
    description: `${balancer} inversion balancer homozygous${insertion.length > 0 ? ` with ${insertion.join(' ')}` : ''} (Dejima 2018).`,
  });
  all.forEach((allele) => {
    // A homozygous pair is on both homologs; an array has only its top copy.
    const isArray = allele === ARRAY.allele;
    strainAlleles.push({ strainName: name, alleleName: allele, isOnTop: 'true', isOnBot: isArray ? 'false' : 'true' });
  });
});
check(new Set(strains.map((s) => s.name)).size === strains.length, 'duplicate strain names');
check(new Set(alleles.map((a) => a.name)).size === alleles.length, 'duplicate allele names');

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
write('strains.csv', ['name', 'genotype', 'description'], strains);
write('strain_alleles.csv', ['strainName', 'alleleName', 'isOnTop', 'isOnBot'], strainAlleles);
