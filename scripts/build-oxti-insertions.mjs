#!/usr/bin/env node
// The fluorescently marked single-copy transposon insertions (oxTi/umnTi) and
// their strains, as importable CSVs:
//
//   node scripts/build-oxti-insertions.mjs
//
// Reads scripts/data/CFJ_oxTi_strains.txt (the Jorgensen lab table: 12 header
// lines, one per column, then one tab-separated row per insertion) and writes
// data/oxTi_insertions/{variations,phenotypes,alleles,allele_exprs,
// expr_relations,strains,strain_alleles}.csv (import in that order) plus the zip.
//
// - Each insertion is an allele with contents like
//   `[Peft-3::GFP(NLS); cbr-unc-119(+)]` and a variation row (chromosome,
//   physical and genetic position from the table).
// - Its markers become phenotypes: the fluorophore is `<promoter>::<fluorophore>`
//   (a spelling already in the database is reused, ignoring case); cbr-unc-119(+)
//   expresses the wild `Unc-119`; HygroR/NeoR/PuroR are the drug resistance
//   pattern of build-lin-15.mjs; Phsp::peel-1 is lethal and needs `heat-shock`.
// - Each strain is the insertion homozygous, plus unc-119(ed3), gaIs283 or
//   him-5(e1490) where the table's genotype has them. The seven CGC umnTi
//   strains (no strain name in the table) carry the insertion only.
// - gaIs283 (a separate array of four GFP::H2B reporters, position unknown) goes
//   on the left arm of I.
// Alleles and strains already in the shipped seed (oxTi302, EG7841) are left out.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { zipFolder } from './lib/zipFolder.mjs';
import { maleCrossingDefective, maleMatingScore } from './lib/maleMating.mjs';

const SOURCE = 'scripts/data/CFJ_oxTi_strains.txt';
const OUT_DIR = 'data/oxTi_insertions';
const HEADER_LINES = 12;
const DOMINANT = 2; // stored form of '1or2'
const LOF = 4; // stored form of zygosity '5'
const ZERO_COPIES = 3; // stored form of '0'
const CHROMOSOME_ORDER = ['I', 'II', 'III', 'IV', 'V', 'X'];
// strains of the CGC-made insertions, which the table gives no name
const CGC_STRAINS = {
  umnTi1: 'CGC4',
  umnTi2: 'CGC5',
  umnTi3: 'CGC6',
  umnTi4: 'CGC7',
  umnTi5: 'CGC8',
  umnTi6: 'CGC9',
  umnTi7: 'CGC10',
};
const DRUGS = { HygroR: 'Hygromycin', NeoR: 'Neomycin', PuroR: 'Puromycin' };

const csvEscape = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const toCsv = (header, rows) =>
  [header, ...rows.map((r) => header.map((h) => r[h] ?? ''))].map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const readCsv = (file) => readFileSync(file, 'utf8').split('\n').slice(1).filter(Boolean).map((line) => line.split(','));

const genes = readCsv('src-tauri/seed/genes.csv');
const conditions = new Set(readCsv('src-tauri/seed/conditions.csv').map((r) => r[0]));
['heat-shock', ...Object.values(DRUGS)].forEach((name) => conditions.has(name) || fail(`The shipped conditions have no ${name}`));
const seedAlleles = new Set(readCsv('src-tauri/seed/alleles.csv').map((r) => r[0]));
const seedStrains = new Set(readCsv('src-tauri/seed/strains.csv').map((r) => r[0]));
// lowercase -> the spelling already used for a (non-wild) phenotype
const seedSpelling = new Map(
  readCsv('src-tauri/seed/phenotypes.csv')
    .filter((r) => r[1] === '0')
    .map((r) => [r[0].toLowerCase(), r[0]])
);
const spelling = (name) => seedSpelling.get(name.toLowerCase()) ?? name;

const geneNamed = (desc) => {
  const rows = genes.filter((r) => r[1] === desc);
  rows.length === 1 || fail(`Expected one shipped gene named ${desc}, found ${rows.length}`);
  const [sys, , chr, , gen] = rows[0];
  return { sys, desc, chr, gen: Number(gen) };
};
const geneticAt = (chr, phys) => {
  const anchors = genes
    .filter((r) => r[2] === chr && r[3] && r[4] !== undefined && r[4] !== '' && !Number.isNaN(Number(r[4])))
    .map((r) => [Number(r[3]), Number(r[4])]);
  const left = anchors.filter(([p]) => p <= phys).sort((a, b) => b[0] - a[0] || b[1] - a[1])[0];
  const right = anchors.filter(([p]) => p > phys).sort((a, b) => a[0] - b[0] || a[1] - b[1])[0];
  return left[1] + ((phys - left[0]) / (right[0] - left[0])) * (right[1] - left[1]);
};

const phenotype = (name, wild, lethal, flags = {}) => ({
  name,
  wild,
  short_name: name,
  description: '',
  male_mating: maleMatingScore(name, wild),
  lethal,
  male_crossing_defective: maleCrossingDefective(name, wild),
  female_crossing_defective: '',
  self_crossing_defective: '',
  him: flags.him ?? '',
  arrested: '',
  maturation_days: '',
});

const variations = [];
const phenotypes = [];
const alleles = [];
const alleleExprs = [];
const exprRelations = [];
const strains = [];
const strainAlleles = [];
const expr = (alleleName, name, wild, dominance) =>
  alleleExprs.push({ alleleName, expressingPhenotypeName: name, expressingPhenotypeWild: wild, dominance });
const relation = (allele, name, wild, alteringName, alteringWild, condition, isSuppressing) =>
  exprRelations.push({
    allele_name: allele,
    expressing_phenotype_name: name,
    expressing_phenotype_wild: wild,
    altering_phenotype_name: alteringName,
    altering_phenotype_wild: alteringWild,
    altering_condition: condition,
    is_suppressing: isSuppressing,
  });
const variation = (alleleName, chromosome, physLoc, geneticLoc) =>
  variations.push({
    alleleName,
    chromosome,
    physLoc,
    geneticLoc,
    recombSuppressorStart: '',
    recombSuppressorEnd: '',
    isLocationReference: 'false',
    percentLoss: '',
  });

// info about every allele a strain can carry: label, chromosome, genetic position
const info = new Map();
const unc119 = geneNamed('unc-119');
info.set('ed3', { label: 'unc-119(ed3)', chr: unc119.chr, gen: unc119.gen });
const him5 = geneNamed('him-5');
info.set('e1490', { label: 'him-5(e1490)', chr: him5.chr, gen: him5.gen });
const GAIS283_PHYS = 500000; // position unknown: somewhere on the left arm of I
const GAIS283_GEN = Math.round(geneticAt('I', GAIS283_PHYS) * 10000) / 10000;
info.set('gaIs283', { label: 'gaIs283', chr: 'I', gen: GAIS283_GEN });

// him-5(e1490): recessive Him-5, rescued by the wild type (as e1467 in the seed)
alleles.push({ name: 'e1490', contents: '', sysGeneName: him5.sys, variationName: '' });
phenotypes.push(phenotype('Him-5', 0, 0, { him: 1 }), phenotype('Him-5', 1, ''));
expr('e1490', 'Him-5', 0, LOF);
relation('e1490', 'Him-5', 0, 'Him-5', 1, '', 1);
// gaIs283: an integrated array of four GFP::H2B reporters (its position is a guess)
const GAIS283_REPORTERS = ['Punc-54::GFP::H2B', 'Pmyo-3::GFP::H2B', 'Pcol-93::GFP::H2B', 'Pref-1::GFP::H2B'].map(spelling);
variation('gaIs283', 'I', GAIS283_PHYS, GAIS283_GEN);
alleles.push({ name: 'gaIs283', contents: `[${GAIS283_REPORTERS.join('; ')}]`, sysGeneName: '', variationName: 'gaIs283' });
GAIS283_REPORTERS.forEach((name) => {
  phenotypes.push(phenotype(name, 0, 0));
  expr('gaIs283', name, 0, DOMINANT);
});

const addDrugResistance = (allele, drug) => {
  const resistance = `${drug}R`;
  phenotypes.push(phenotype(resistance, 0, 0), phenotype(resistance, 1, 1));
  expr(allele, resistance, 0, DOMINANT);
  expr(allele, resistance, 1, ZERO_COPIES);
  relation(allele, resistance, 1, resistance, 0, '', 1);
  relation(allele, resistance, 1, '', '', drug, 0);
  relation(allele, resistance, 0, '', '', drug, 0);
};

const rows = readFileSync(SOURCE, 'utf8')
  .split('\n')
  .slice(HEADER_LINES)
  .filter((line) => line.trim() !== '')
  .map((line) => line.split('\t'));
const seenAlleles = new Set();
const skipped = [];
let extraAlleleUse = { ed3: 0, gaIs283: 0, e1490: 0 };

rows.forEach((r) => {
  const [lg, genPos, physPos, promoter, rawFluor, allele, rawStrain, rawMarkers, genotype] = r.map((cell) => cell.trim());
  seenAlleles.has(allele) && fail(`${allele} appears twice in the table`);
  seenAlleles.add(allele);
  const chr = lg.replace(/^LG/, '').replace(/^(\d)$/, (d) => CHROMOSOME_ORDER[Number(d) - 1]);
  CHROMOSOME_ORDER.includes(chr) || fail(`${allele}: unknown chromosome ${lg}`);
  const gen = Number(genPos.split(':')[1]);
  const phys = Number(physPos.replace(/,/g, ''));
  (Number.isNaN(gen) || Number.isNaN(phys)) && fail(`${allele}: bad position ${genPos} / ${physPos}`);

  // the fluorophore cell sometimes has stray characters or names a second allele
  const fluor = rawFluor.replace(/\s*\+\s*gaIs283$/, '').replace(/^\[/, '').replace(/>$/, '').trim();
  const members = [allele];
  if (/gaIs283/.test(`${rawFluor} ${genotype}`)) members.push('gaIs283');
  if (/unc-119\(ed3\)/.test(genotype) && !/^umnTi/.test(allele)) members.push('ed3');
  if (/him-5\(e1490\)/.test(genotype)) members.push('e1490');
  members.forEach((m) => m in extraAlleleUse && extraAlleleUse[m]++);

  const marker = spelling(`${promoter}::${fluor}`);
  const tokens = rawMarkers.split(/\s+and\s+/).map((t) => t.trim());
  const contentsParts = [`${promoter}::${fluor}`];
  tokens.forEach((token) => {
    if (token === 'cbr-unc-119(+)') contentsParts.push(token);
    else if (token in DRUGS) contentsParts.push(token);
    else if (token === 'Phsp:peel-1') contentsParts.push('Phsp::peel-1');
    else fail(`${allele}: unknown marker ${token}`);
  });

  info.set(allele, { label: allele, chr, gen });
  const strain = rawStrain || CGC_STRAINS[allele] || fail(`${allele} has no strain name`);

  if (seedAlleles.has(allele)) {
    skipped.push(`${allele} (allele already in the seed)`);
  } else {
    variation(allele, chr, phys, gen);
    alleles.push({ name: allele, contents: `[${contentsParts.join('; ')}]`, sysGeneName: '', variationName: allele });
    phenotypes.push(phenotype(marker, 0, 0));
    expr(allele, marker, 0, DOMINANT);
    tokens.forEach((token) => {
      if (token === 'cbr-unc-119(+)') {
        phenotypes.push(phenotype('Unc-119', 0, 0), phenotype('Unc-119', 1, ''));
        expr(allele, 'Unc-119', 1, DOMINANT);
      } else if (token in DRUGS) {
        addDrugResistance(allele, DRUGS[token]);
      } else {
        // dominant lethal, but only once heat-shock is on
        phenotypes.push(phenotype('Phsp::peel-1', 0, 1));
        expr(allele, 'Phsp::peel-1', 0, DOMINANT);
        relation(allele, 'Phsp::peel-1', 0, '', '', 'heat-shock', 0);
      }
    });
  }

  if (seedStrains.has(strain)) {
    skipped.push(`${strain} (strain already in the seed)`);
    return;
  }
  // genotype text the way Strain.toString builds it: chromosomes in order,
  // alleles of a chromosome by genetic position, all homozygous
  const byChr = new Map();
  members.forEach((m) => {
    const item = info.get(m);
    byChr.set(item.chr, [...(byChr.get(item.chr) ?? []), item]);
  });
  const parts = CHROMOSOME_ORDER.filter((c) => byChr.has(c)).map((c) => {
    const items = byChr.get(c).sort((a, b) => (a.gen ?? 50) - (b.gen ?? 50));
    return `${items.map((i) => i.label).join(' ')} ${c}`;
  });
  strains.push({
    name: strain,
    genotype: `${parts.join('; ')}.`,
    description: `${members.map((m) => info.get(m).label).join(' ')} homozygous.`,
  });
  members.forEach((m) => strainAlleles.push({ strainName: strain, alleleName: m, isOnTop: 'true', isOnBot: 'true' }));
});

mkdirSync(OUT_DIR, { recursive: true });
const write = (file, header, list) => {
  writeFileSync(`${OUT_DIR}/${file}`, toCsv(header, list));
  console.log(`${file}: ${list.length} rows`);
};
write('variations.csv', ['alleleName', 'chromosome', 'physLoc', 'geneticLoc', 'recombSuppressorStart', 'recombSuppressorEnd', 'isLocationReference', 'percentLoss'], variations);
const uniquePhenotypes = [...new Map(phenotypes.map((p) => [`${p.name}|${p.wild}`, p])).values()];
write('phenotypes.csv', ['name', 'wild', 'short_name', 'description', 'male_mating', 'lethal', 'male_crossing_defective', 'female_crossing_defective', 'self_crossing_defective', 'him', 'arrested', 'maturation_days'], uniquePhenotypes);
write('alleles.csv', ['name', 'contents', 'sysGeneName', 'variationName'], alleles);
write('allele_exprs.csv', ['alleleName', 'expressingPhenotypeName', 'expressingPhenotypeWild', 'dominance'], alleleExprs);
write('expr_relations.csv', ['allele_name', 'expressing_phenotype_name', 'expressing_phenotype_wild', 'altering_phenotype_name', 'altering_phenotype_wild', 'altering_condition', 'is_suppressing'], exprRelations);
write('strains.csv', ['name', 'genotype', 'description'], strains);
write('strain_alleles.csv', ['strainName', 'alleleName', 'isOnTop', 'isOnBot'], strainAlleles);
zipFolder(OUT_DIR);
console.log(`skipped: ${skipped.join(', ') || 'none'}`);
console.log(`strains carrying ed3 ${extraAlleleUse.ed3}, gaIs283 ${extraAlleleUse.gaIs283}, e1490 ${extraAlleleUse.e1490}`);
