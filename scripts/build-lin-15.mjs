#!/usr/bin/env node
// The combined lin-15 gene as mutant and as rescue, as importable CSVs:
//
//   node scripts/build-lin-15.mjs
//
// Writes data/lin_15/{variations,phenotypes,alleles,allele_exprs,expr_relations}.csv
// (import in that order). lin-15 (ZK678.1&ZK662.4) is the shipped combined row
// for lin-15A and lin-15B together:
// - lin-15(n765) is a temperature-sensitive loss of function: a recessive
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
  ['n765', GENE, PHENOTYPE, '25C'],
  ['ed3', UNC119_GENE, 'Unc-119', ''],
  ['ed4', UNC119_GENE, 'Unc-119', ''],
  ['ed9', UNC119_GENE, 'Unc-119', ''],
];
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

const variations = NEW_RESCUES.map(([name, chromosome]) => ({
  alleleName: name,
  chromosome,
  physLoc: '',
  geneticLoc: '',
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
