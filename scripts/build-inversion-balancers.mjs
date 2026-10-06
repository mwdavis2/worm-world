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
// - The Dejima strains are homozygous. Four more classical balancers (sC4, sC1,
//   mnC1, qC1) come with their own strains, most of them balancer-over-partner
//   heterozygotes with the partner's alleles on the bottom homolog.
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

// Four classical balancers with strains (not in Dejima's toolkit). Ranges: the
// sequenced breakpoints where known (mnC1 and sC1: Maroilley 2021; qC1:
// Edgley 2021, WS282), and for sC4 the positions of unc-76 and rol-9. A bound
// is a position or a gene name. [variation, chromosome, [left, right], the
// balancer allele, its built-in homozygous lethality]
const CLASSICAL = [
  ['sC4', 'V', ['unc-76', 'rol-9'], 'sC4(s2172)', true],
  ['sC1', 'III', [323_321, 4_641_137], 'sC1(s2023)', false],
  ['mnC1', 'II', [4_904_692, 14_909_258], 'mnC1', false],
  ['qC1', 'III', [1_286_123, 13_737_951], 'qC1', false],
];
// Gene alleles of those strains: [allele, gene, kind] - 'lof' is a visible
// recessive class-5 phenotype rescued by the wild type, 'let' a recessive
// lethal, 'sterile' a recessive sterile
const CLASSICAL_ALLELES = [
  ['e911', 'unc-76', 'lof'],
  ['sc148', 'rol-9', 'lof'],
  ['e428', 'dpy-21', 'lof'],
  ['e444', 'unc-52', 'lof'],
  ['s2170', 'dpy-1', 'lof'],
  ['e120', 'unc-4', 'lof'],
  ['e1259', 'dpy-19', 'lof'],
  ['q267', 'laf-1', 'let'],
  ['q339', 'glp-1', 'sterile'],
];
// Integrated Pmyo-2 transgenes carrying neomycin resistance, placed just past
// the middle of their balancer's range (the balancer itself is at the middle):
// [allele, chromosome, balancer, marker]
const TRANSGENES = [
  ['umnIs32', 'II', 'mnC1', 'Pmyo-2::GFP'],
  ['umnIs41', 'III', 'sC1', 'Pmyo-2::mKate2'],
];
// dpy-10(e128) is the existing allele e128 (its allele row is not generated,
// only its recessive Dpy-10 phenotype rows)
const EXISTING = { e128: 'dpy-10' };
// [strain, alleles on the balancer's homolog, alleles on the other homolog,
// homozygous]. A homozygous strain has everything on both homologs.
const CLASSICAL_STRAINS = [
  ['BC4586', ['sC4(s2172)', 'e428'], ['e911', 'sc148'], false],
  ['CGC43', ['mnC1', 'e128', 'e444', 'umnIs32'], ['e120'], false],
  ['CGC51', ['sC1(s2023)', 's2170', 'umnIs41'], [], true],
  ['BG99', ['qC1', 'e1259', 'q339'], ['q267'], false],
];

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
const toGene = ([sys, desc, chr, phys, gen]) => ({
  sys,
  desc: desc === '' ? sys : desc,
  chr,
  phys: Number(phys),
  gen: Number(gen),
});
// The shipped genes anchor the cM interpolation (as everywhere else); the
// uncloned genes (rol-9) can be looked up by name but are not anchors.
const seedGeneRows = parseCsv('src-tauri/seed/genes.csv').map(toGene);
const geneRows = [...seedGeneRows, ...parseCsv('data/wormbase/uncloned_genes.csv').map(toGene)];
const geneNamed = (name) => {
  const hits = geneRows.filter((g) => g.sys === name || g.desc === name);
  const unique = [...new Map(hits.map((g) => [g.sys, g])).values()];
  check(unique.length === 1, `gene ${name}: expected exactly one gene row, found ${unique.length}`);
  return unique[0] ?? { sys: name, desc: name, chr: '?', phys: 0, gen: 0 };
};

// Genetic position (cM) at a physical position, interpolated between the
// nearest genes on the chromosome (anchors sharing a position are averaged).
const anchorsByChr = new Map();
seedGeneRows.forEach((g) => {
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

const addPhenotype = (name, wild, lethal = '', flags = {}) => {
  const key = `${name}|${wild}`;
  if (phenotypes.has(key)) return;
  phenotypes.set(key, {
    name,
    wild,
    short_name: name,
    description: '',
    male_mating: flags.maleMating ?? '',
    lethal,
    female_sterile: flags.femaleSterile ?? '',
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
const addLossOfFunction = (allele, gene, flags = {}) => {
  const rescuer = capitalize(gene.desc);
  addPhenotype(rescuer, 0, 0, flags);
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
const addBalancer = (name, chr, start, end, alleleName = name) => {
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
  alleles.push({ name: alleleName, contents: '', sysGeneName: '', variationName: name });
  info.set(alleleName, { label: alleleName, chr, gen: round2(geneticAt(chr, middle)) });
};
BALANCERS.forEach(([name, chr, left, right]) => {
  const l = geneNamed(left);
  const r = geneNamed(right);
  check(l.chr === chr && r.chr === chr, `${name}: ${left}/${right} are not both on ${chr}`);
  addBalancer(name, chr, Math.min(l.phys, r.phys), Math.max(l.phys, r.phys));
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

// ------------------------------------------------- the four classical balancers
CLASSICAL.forEach(([name, chr, [left, right], alleleName, lethal]) => {
  const bound = (b) => (typeof b === 'number' ? b : geneNamed(b).phys);
  addBalancer(name, chr, Math.min(bound(left), bound(right)), Math.max(bound(left), bound(right)), alleleName);
  // sC4(s2172) is homozygous lethal on its own: a built-in recessive Let
  if (lethal) {
    addPhenotype('Let', 0, 1, { maleMating: 0 });
    addExpr(alleleName, 'Let', 0, 0);
  }
});

CLASSICAL_ALLELES.forEach(([allele, geneName, kind]) => {
  const gene = addGeneAllele(allele, geneName);
  if (kind === 'lof') addLossOfFunction(allele, gene);
  else if (kind === 'sterile') addLossOfFunction(allele, gene, { femaleSterile: 1 });
  else {
    addPhenotype('Let', 0, 1, { maleMating: 0 });
    addExpr(allele, 'Let', 0, LOF_DOMINANCE);
  }
});
// The existing alleles (not added to alleles.csv) get their phenotype rows
// here: e128 is a recessive class-5 Dpy-10 rescued by the wild type.
Object.entries(EXISTING).forEach(([allele, geneName]) => {
  const gene = geneNamed(geneName);
  info.set(allele, { label: `${gene.desc}(${allele})`, chr: gene.chr, gen: gene.gen });
  addLossOfFunction(allele, gene);
});

// Resistance to a drug, as the New Allele dialog's Basic tab writes it (and as
// oxEx8 has it): resistant (non-wild) with 1 or 2 copies when the drug is
// present; the wild type (0 copies) is lethal on the drug unless resistant.
const addDrugResistance = (allele, drug) => {
  const resistance = `${drug}R`;
  addPhenotype(resistance, 0, 0);
  addPhenotype(resistance, 1, 1);
  addExpr(allele, resistance, 0, DOMINANT_DOMINANCE);
  addExpr(allele, resistance, 1, 3); // stored form of '0' copies
  const relation = (expressingWild, altering, isSuppressing) =>
    exprRelations.push({
      allele_name: allele,
      expressing_phenotype_name: resistance,
      expressing_phenotype_wild: expressingWild,
      altering_phenotype_name: altering.phenotype ? resistance : '',
      altering_phenotype_wild: altering.phenotype ? 0 : '',
      altering_condition: altering.phenotype ? '' : drug,
      is_suppressing: isSuppressing,
    });
  relation(1, { phenotype: true }, 1);
  relation(1, { phenotype: false }, 0);
  relation(0, { phenotype: false }, 0);
};
TRANSGENES.forEach(([allele, chr, balancer, marker]) => {
  const [start, end] = rangeOf.get(balancer);
  const phys = Math.round((start + end) / 2) + 1;
  const gen = round2(geneticAt(chr, phys));
  variations.push({
    alleleName: allele,
    chromosome: chr,
    physLoc: phys,
    geneticLoc: gen,
    recombSuppressorStart: '',
    recombSuppressorEnd: '',
    isLocationReference: 'false',
    percentLoss: '',
  });
  alleles.push({ name: allele, contents: '', sysGeneName: '', variationName: allele });
  info.set(allele, { label: allele, chr, gen });
  addPhenotype(marker, 0, 0);
  addExpr(allele, marker, 0, DOMINANT_DOMINANCE);
  addDrugResistance(allele, 'Neomycin');
});

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
// Genotype text as Strain.toString builds it: chromosomes in order, each a
// list of allele pairs sorted by genetic position with the same comparator as
// AllelePair.sort. A chromosome whose pairs are all homozygous is
// "<alleles> <chromosome>"; otherwise "<top alleles>/<bottom alleles>
// <chromosome>" with + for a wild copy, flipped so the first top is not wild.
// An extrachromosomal array is "array/+ Ex". `members` are
// { name, onTop, onBot }.
const genotypeOf = (members) => {
  const byChr = new Map();
  members.forEach((member) => {
    const item = { ...info.get(member.name), onTop: member.onTop, onBot: member.onBot };
    byChr.set(item.chr, [...(byChr.get(item.chr) ?? []), item]);
  });
  const parts = CHROMOSOME_ORDER.filter((chr) => byChr.has(chr)).map((chr) => {
    const items = byChr.get(chr);
    if (chr === 'Ex') {
      items.sort((a, b) => (a.label < b.label ? -1 : 1));
      return `${items.map((i) => i.label).join(' ')}/${items.map(() => '+').join(' ')} Ex`;
    }
    items.sort((a, b) => (a.gen < b.gen ? -1 : 1));
    let pairs = items.map((i) => ({ top: i.onTop ? i.label : '+', bot: i.onBot ? i.label : '+' }));
    if (pairs.every((pair) => pair.top === pair.bot)) return `${pairs.map((pair) => pair.top).join(' ')} ${chr}`;
    if (pairs[0].top === '+') pairs = pairs.map((pair) => ({ top: pair.bot, bot: pair.top }));
    return `${pairs.map((pair) => pair.top).join(' ')}/${pairs.map((pair) => pair.bot).join(' ')} ${chr}`;
  });
  return `${parts.join('; ')}.`;
};

const strains = [];
const strainAlleles = [];
const addStrain = (name, description, members) => {
  members.forEach((member) => check(info.has(member.name), `${name}: allele ${member.name} is not defined`));
  strains.push({ name, genotype: genotypeOf(members), description });
  members.forEach((member) =>
    strainAlleles.push({
      strainName: name,
      alleleName: member.name,
      isOnTop: String(member.onTop),
      isOnBot: String(member.onBot),
    })
  );
};

STRAINS.forEach(([name, balancer, extras]) => {
  const built = BREAKPOINTS.filter(([, b]) => b === balancer).map(([allele]) => allele);
  const all = [balancer, ...built, ...extras];
  const insertion = extras.filter((a) => insertionOf.has(a)).map((a) => info.get(a).label);
  // A homozygous pair is on both homologs; an array has only its top copy.
  addStrain(
    name,
    `${balancer} inversion balancer homozygous${insertion.length > 0 ? ` with ${insertion.join(' ')}` : ''} (Dejima 2018).`,
    all.map((allele) => ({ name: allele, onTop: true, onBot: allele !== ARRAY.allele }))
  );
});

CLASSICAL_STRAINS.forEach(([name, onBalancer, onPartner, homozygous]) => {
  const labels = (alleles_) => alleles_.map((a) => info.get(a)?.label ?? a).join(' ');
  addStrain(
    name,
    homozygous
      ? `${labels(onBalancer)} homozygous.`
      : `${labels(onBalancer)} over ${labels(onPartner)}.`,
    [
      ...onBalancer.map((allele) => ({ name: allele, onTop: true, onBot: homozygous })),
      ...onPartner.map((allele) => ({ name: allele, onTop: false, onBot: true })),
    ]
  );
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
