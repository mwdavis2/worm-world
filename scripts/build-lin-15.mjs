#!/usr/bin/env node
// The combined lin-15 gene as mutant and as rescue, as importable CSVs:
//
//   node scripts/build-lin-15.mjs
//
// Writes data/lin_15/{variations,phenotypes,alleles,allele_exprs,expr_relations}.csv
// (import in that order). lin-15 (ZK678.1&ZK662.4) is the shipped combined row
// for lin-15A and lin-15B together:
// - lin-15(n765ts) is a temperature-sensitive loss of function: a recessive
//   class-5 `Lin-15` phenotype rescued by the wild type, expressed only at 25C.
// - the integrated transgenes oxIs12 and oxIs644 rescue lin-15: each expresses
//   the wild-type `Lin-15` phenotype (`Lin-15` only, not `Lin-15A` and
//   `Lin-15B` separately). oxIs12 also expresses Punc-47::GFP.
// - oxIs363 is Punc-122::GFP and rescues unc-119 (wild `Unc-119`), not lin-15.
// oxIs644 already exists (its allele row is not regenerated; it is Lin-15(+)
// for now and will change with the Cre project); oxIs12 and oxIs363 have
// variation rows but no allele rows, so they get allele rows here.
// - unc-119(ed3), (ed4) and (ed9) are recessive class-5 `Unc-119` loss of
//   function alleles, rescued by the wild type.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const OUT_DIR = 'data/lin_15';
const GENE = 'ZK678.1&ZK662.4';
const UNC119_GENE = 'M142.1';
const PHENOTYPE = 'Lin-15';
const LOF_DOMINANCE = 4; // stored form of zygosity '5'
const DOMINANT_DOMINANCE = 2; // stored form of '1or2'

// [allele, gene, phenotype, the condition it needs ('' for none)]
const MUTANTS = [
  ['n765ts', GENE, PHENOTYPE, '25C'],
  ['ed3', UNC119_GENE, 'Unc-119', ''],
  ['ed4', UNC119_GENE, 'Unc-119', ''],
  ['ed9', UNC119_GENE, 'Unc-119', ''],
];
// Recessive class-5 alleles for the marker strains below ([allele, gene, the
// condition it needs]); lon-2(e678) and bli-4(e937) already exist in
// data/balancer_alleles.
const MARKER_ALLELES = [
  ['e61', 'dpy-5'],
  ['e187', 'rol-6'],
  ['e1820', 'lon-1'],
  ['sc16', 'bli-6'],
  ['e224', 'dpy-11'],
  ['e936', 'unc-73'],
  ['e491', 'sma-3'],
  ['e1562', 'vab-7'],
  ['e928', 'unc-31'],
  ['e1368ts', 'daf-2', '25C'], // temperature sensitive: needs the condition
];
// [name, [alleles, all homozygous]]
const STRAINS = [
  ['EG1306', ['oxIs12', 'n765ts']],
  ['EG1000', ['e61', 'e187', 'e1820']],
  ['EG1020', ['sc16', 'e224', 'e678']],
  ['154', ['e936', 'e491', 'sc16']],
  ['155', ['e936', 'e224', 'e678']],
  ['DA438', ['e937', 'e187', 'e1368ts', 'e1562', 'e928', 'e224', 'e678']],
];
const CHROMOSOME_ORDER = ['I', 'II', 'III', 'IV', 'V', 'X'];
const NEW_RESCUES = [
  ['oxIs12', 'X'],
  ['oxIs363', 'IV'],
]; // [allele, chromosome] - variation and allele rows are written
const TRANSGENE_EXPRS = [
  ['oxIs12', 'Punc-47::GFP', 0],
  ['oxIs12', PHENOTYPE, 1],
  ['oxIs363', 'Punc-122::GFP', 0],
  ['oxIs363', 'Unc-119', 1],
  ['oxIs644', PHENOTYPE, 1],
]; // [allele, phenotype, wild]

const csvEscape = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const toCsv = (header, rows) =>
  [header, ...rows.map((r) => header.map((h) => r[h] ?? ''))].map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';

const genes = readFileSync('src-tauri/seed/genes.csv', 'utf8').split('\n');
[GENE, UNC119_GENE].forEach((gene) => {
  if (!genes.some((line) => line.startsWith(`${gene},`))) {
    console.error(`The shipped gene table has no ${gene} row`);
    process.exit(1);
  }
});
const conditions = readFileSync('src-tauri/seed/conditions.csv', 'utf8').split('\n');
MUTANTS.forEach(([, , , condition]) => {
  if (condition && !conditions.some((line) => line.startsWith(`${condition},`))) {
    console.error(`The shipped conditions have no ${condition}`);
    process.exit(1);
  }
});

// oxIs12 sits 1 cM left of lin-15 on X; its physical position is interpolated
// between the nearest shipped genes either side of that map position.
const OXIS12_CM = Number(genes.find((line) => line.startsWith(`${GENE},`)).split(',')[4]) - 1;
const physicalAt = (chr, cm) => {
  const anchors = genes
    .map((line) => line.split(','))
    .filter((r) => r[2] === chr && r[3] && r[4] !== undefined && r[4] !== '' && !Number.isNaN(Number(r[4])))
    .map((r) => [Number(r[3]), Number(r[4])]);
  const left = anchors.filter(([, g]) => g <= cm).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  const right = anchors.filter(([, g]) => g > cm).sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
  return Math.round(left[0] + ((cm - left[1]) / (right[1] - left[1])) * (right[0] - left[0]));
};
const POSITIONS = { oxIs12: ['X', OXIS12_CM] };

const variations = NEW_RESCUES.map(([name, chromosome]) => ({
  alleleName: name,
  chromosome,
  physLoc: POSITIONS[name] ? physicalAt(...POSITIONS[name]) : '',
  geneticLoc: POSITIONS[name] ? Math.round(POSITIONS[name][1] * 10000) / 10000 : '',
  recombSuppressorStart: '',
  recombSuppressorEnd: '',
  isLocationReference: 'false',
  percentLoss: '',
}));
const phenotype = (name, wild, lethal) => ({
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
const phenotypes = [
  phenotype(PHENOTYPE, 0, 0),
  phenotype(PHENOTYPE, 1, ''),
  phenotype('Unc-119', 0, 0),
  phenotype('Unc-119', 1, ''),
  phenotype('Punc-47::GFP', 0, 0),
  phenotype('Punc-122::GFP', 0, 0),
];
const alleles = [
  ...MUTANTS.map(([name, gene]) => ({ name, contents: '', sysGeneName: gene, variationName: '' })),
  ...NEW_RESCUES.map(([name]) => ({ name, contents: '', sysGeneName: '', variationName: name })),
];
const alleleExprs = [
  ...MUTANTS.map(([name, , phenotypeName]) => ({ alleleName: name, expressingPhenotypeName: phenotypeName, expressingPhenotypeWild: 0, dominance: LOF_DOMINANCE })),
  ...TRANSGENE_EXPRS.map(([name, phenotypeName, wild]) => ({ alleleName: name, expressingPhenotypeName: phenotypeName, expressingPhenotypeWild: wild, dominance: DOMINANT_DOMINANCE })),
];
const exprRelations = MUTANTS.flatMap(([name, , phenotypeName, condition]) => [
  {
    allele_name: name,
    expressing_phenotype_name: phenotypeName,
    expressing_phenotype_wild: 0,
    altering_phenotype_name: phenotypeName,
    altering_phenotype_wild: 1,
    altering_condition: '',
    is_suppressing: 1,
  },
  ...(condition
    ? [
        {
          allele_name: name,
          expressing_phenotype_name: phenotypeName,
          expressing_phenotype_wild: 0,
          altering_phenotype_name: '',
          altering_phenotype_wild: '',
          altering_condition: condition,
          is_suppressing: 0,
        },
      ]
    : []),
]);


// Marker alleles: each is an allele of its gene with a capitalized recessive
// class-5 phenotype rescued by the wild type.
const geneRows = genes.map((line) => line.split(','));
const geneNamed = (desc) => {
  const rows = geneRows.filter((r) => r[1] === desc);
  if (rows.length !== 1) {
    console.error(`Expected one shipped gene named ${desc}, found ${rows.length}`);
    process.exit(1);
  }
  const [sys, , chr, , gen] = rows[0];
  return { sys, desc, chr, gen: Number(gen) };
};
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const info = new Map(); // allele -> { label, chr, gen } for the genotype text
MUTANTS.forEach(([name, sys]) => {
  const gene = geneRows.find((r) => r[0] === sys);
  info.set(name, { label: `${gene[1]}(${name})`, chr: gene[2], gen: Number(gene[4]) });
});
info.set('e678', { label: 'lon-2(e678)', ...(({ chr, gen }) => ({ chr, gen }))(geneNamed('lon-2')) });
info.set('e937', { label: 'bli-4(e937)', ...(({ chr, gen }) => ({ chr, gen }))(geneNamed('bli-4')) });
info.set('oxIs12', { label: 'oxIs12', chr: 'X', gen: OXIS12_CM });
MARKER_ALLELES.forEach(([allele, geneName, condition]) => {
  const gene = geneNamed(geneName);
  const phenotypeName = capitalize(gene.desc);
  alleles.push({ name: allele, contents: '', sysGeneName: gene.sys, variationName: '' });
  phenotypes.push(phenotype(phenotypeName, 0, 0), phenotype(phenotypeName, 1, ''));
  alleleExprs.push({ alleleName: allele, expressingPhenotypeName: phenotypeName, expressingPhenotypeWild: 0, dominance: LOF_DOMINANCE });
  exprRelations.push({
    allele_name: allele,
    expressing_phenotype_name: phenotypeName,
    expressing_phenotype_wild: 0,
    altering_phenotype_name: phenotypeName,
    altering_phenotype_wild: 1,
    altering_condition: '',
    is_suppressing: 1,
  });
  if (condition) {
    if (!conditions.some((line) => line.startsWith(`${condition},`))) {
      console.error(`The shipped conditions have no ${condition}`);
      process.exit(1);
    }
    exprRelations.push({
      allele_name: allele,
      expressing_phenotype_name: phenotypeName,
      expressing_phenotype_wild: 0,
      altering_phenotype_name: '',
      altering_phenotype_wild: '',
      altering_condition: condition,
      is_suppressing: 0,
    });
  }
  info.set(allele, { label: `${gene.desc}(${allele})`, chr: gene.chr, gen: gene.gen });
});

// Strains: every allele homozygous. The genotype text is built the way
// Strain.toString does: chromosomes in order, alleles by genetic position
// (an allele with no position sorts last), "<alleles> <chromosome>".
const strains = [];
const strainAlleles = [];
STRAINS.forEach(([name, members]) => {
  const byChr = new Map();
  members.forEach((allele) => {
    const item = info.get(allele);
    if (!item) {
      console.error(`${name}: allele ${allele} is not defined`);
      process.exit(1);
    }
    byChr.set(item.chr, [...(byChr.get(item.chr) ?? []), item]);
  });
  const parts = CHROMOSOME_ORDER.filter((chr) => byChr.has(chr)).map((chr) => {
    const items = byChr.get(chr).sort((a, b) => (a.gen ?? 50) - (b.gen ?? 50));
    return `${items.map((i) => i.label).join(' ')} ${chr}`;
  });
  strains.push({ name, genotype: `${parts.join('; ')}.`, description: `${members.map((a) => info.get(a).label).join(' ')} homozygous.` });
  members.forEach((allele) => strainAlleles.push({ strainName: name, alleleName: allele, isOnTop: 'true', isOnBot: 'true' }));
});

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
