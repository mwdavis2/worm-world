#!/usr/bin/env node
// Generates the translocation-balancer data (eT1, nT1, hT2, szT1, hT3, mT1,
// hT1) as importable CSVs, so ~200 rows aren't typed by hand:
//
//   node scripts/build-translocations.mjs
//
// Writes data/translocations/{variations,alleles,phenotypes,allele_exprs,
// expr_relations}.csv (import them in that order through the data tables'
// Import buttons, which is parents first) and docs/translocations.md. Safe to
// re-run: the outputs are fully derived from the tables below and
// src-tauri/seed/genes.csv.
//
// ENCODING (proven in src/models/frontend/Strain/translocation.test.ts)
// A translocation is a pair of half-alleles, one per chromosome. Every half
// allele expresses wild "<half> 1 copy" / "<half> 2 copies" marker phenotypes
// (hidden on cards) and two global lethal phenotypes - aneuploid (het) and
// (hom) - each suppressed by the PARTNER half's matching marker. So an animal
// is viable exactly when both halves are present in equal numbers.
//
// The inventory (ranges, variants, phenotypes) comes from a collaborator's
// plan built on CGC/WormBook records. It has NOT been verified here: entries
// marked `verify` need confirming before the data is relied on.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipFolder } from './lib/zipFolder.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'data', 'translocations');
const DOC_PATH = join(ROOT, 'docs', 'translocations.md');
const GENES_PATH = join(ROOT, 'src-tauri', 'seed', 'genes.csv');

// WBcel235 chromosome lengths (bp), used to catch typos in ranges.
const CHROMOSOME_LENGTHS = {
  I: 15_072_434,
  II: 15_279_421,
  III: 13_783_801,
  IV: 17_493_829,
  V: 20_924_180,
  X: 17_718_942,
};
// A range end this close to a chromosome end counts as being at the end.
const END_TOLERANCE = 1000;

// ---------------------------------------------------------------- inventory
// `range` is the physical interval whose crossovers are suppressed. From the
// sequenced breakpoints (Maroilley et al. 2021, Flibotte et al. 2021) where
// there are any, by this rule: the range runs from the chromosome's free end to
// the breakpoint FARTHEST from it - the left-most breakpoint on II, III, IV and
// X (their balanced part is the right portion) and the right-most on I and V
// (the left portion). Only the junction to the main chromosome counts; the
// other breakpoints of a complex rearrangement are ignored. Otherwise the
// CGC/WormBook description (the smaller region where a span was given).
// `note` is carried into the docs.
const FAMILIES = [
  {
    name: 'eT1',
    halves: [
      { chr: 'III', range: [8_200_764, 13_783_733] },
      { chr: 'V', range: [1, 8_930_675] },
    ],
    note: 'Sequenced breakpoints III:8,200,764 (in unc-36) and V:8,930,675 (Maroilley 2021); they match the classical limits (unc-36 and a flank 4 kb from the V breakpoint).',
  },
  {
    name: 'nT1',
    halves: [
      { chr: 'IV', range: [1_901_208, 17_493_829] },
      { chr: 'V', range: [1, 16_832_779] },
    ],
    note: 'Chromoplexy (Maroilley 2021). The IV edge is the left-most IV breakpoint, 1,901,208, about 1 kb upstream of egl-18 (PubMed 14975731, https://pubmed.ncbi.nlm.nih.gov/14975731/): it disrupts egl-18/elt-6 function in the vulva (the Vul phenotype). egl-18 mutations do not complement nT1 for the vulval defect, so genetically the breakpoint is an allele of egl-18 - within the functional interval of the gene though outside its coding region (hence egl-18(nT1vul)). The V edge is the right-most V breakpoint, 16,832,779, which puts unc-76 (V 15.07 Mb), the classical limit, inside it. Replaces the earlier flanks unc-17 (IV 3,618,259) and unc-76.',
  },
  {
    name: 'hT2',
    halves: [
      { chr: 'I', range: [1, 13_187_133] },
      { chr: 'III', range: [4_822_648, 13_783_801] },
    ],
    note: 'Sequenced breakpoints (PMC8662349): I:13,187,133 (right-most I breakpoint) and III:4,822,648 (left-most III breakpoint; the other, 4,989,701, is where III-right joins hT2(I)). They fall between the balanced/unbalanced marker pairs unc-101/unc-59 (I) and dpy-17/unc-93 (III).',
  },
  {
    name: 'szT1',
    halves: [
      { chr: 'I', range: [1, 7_631_470] },
      { chr: 'X', range: [2_314_605, 17_718_942] },
    ],
    note: 'Sequenced breakpoints I:7,631,470 and X:2,314,605 (Maroilley 2021; the X inversion to 2,597,434 is ignored). The X junction is near dpy-3, the classical left edge. The right end of X is the settled classical extent (szT1 balances X from the right end to around dpy-3). The paper finds no heterozygosity there in its sequenced strain, CB3475, which it suggests may carry a derivative of szT1; that says nothing against the rearrangement itself.',
  },
  {
    name: 'hT3',
    halves: [
      { chr: 'I', range: [1, 5_245_743] },
      { chr: 'X', range: [14_773_538, 17_718_942] },
    ],
    note: 'Not sequenced (Maroilley 2021 could not resolve it). X: right end to between dpy-7 and unc-3 (smaller option taken).',
    verify: 'X half range (smaller option)',
  },
  {
    name: 'mT1',
    halves: [
      { chr: 'II', range: [6_296_872, 15_279_421] },
      { chr: 'III', range: [3_635_354, 13_783_801] },
    ],
    note: 'Sequenced breakpoints II:6,296,872 and III:3,635,354 (Maroilley 2021): the II edge is about 400 kb beyond dpy-10 (II:6,710,149), the III edge 9 kb from unc-93, between daf-2 and unc-93 as described.',
  },
  {
    name: 'hT1',
    halves: [
      { chr: 'I', range: [1, 8_409_987] },
      { chr: 'V', range: [1, 7_207_631] },
    ],
    note: 'Sequenced breakpoints I:8,409,987 (in lin-28) and V:7,207,631 (in soap-1) (Maroilley 2021): the I edge was previously unknown (through let-80, no position), the V edge is 0.7 Mb beyond dpy-11 (V:6,511,583). The sequenced strain may be a derivative with a free duplication.',
  },
];

// Phenotypes named in the variants (gene phenotypes follow the existing
// convention: the gene name, with a short name). `lethal`/`sterile` flags map
// to the lethal / female_sterile columns.
const PHENOTYPES = {
  'unc-36': { short: 'unc' },
  'him-5': { short: 'him' },
  'bli-4': { short: 'bli' },
  'dpy-18': { short: 'dpy' },
  'dpy-10': { short: 'dpy' },
  'lon-2': { short: 'lon' },
  'unc-29': { short: 'unc' },
  'unc(n754dm)': { short: 'unc' },
  Vul: { short: 'Vul', maleMating: 0 },
  sterile: { short: 'sterile', femaleSterile: 1 },
  'pharyngeal GFP': { short: 'GFP(pharynx)' },
  GFP: { short: 'GFP' },
};

// Each variant is its own pair of half-alleles. A row is
//   { pheno, zyg, gene?, verify? }  - `zyg` '2' = recessive (homozygous),
// '1or2' = dominant; `gene` (a gene descName) puts the row on the half whose
// chromosome carries that gene, else on the family's first half. A `lethal`
// row is "<variant> homozygous lethal".
const LETHAL = { lethal: true };
const VARIANTS = [
  // eT1
  // Every eT1 carries unc-36(e873), but that is entered as a real gene allele
  // in the eT1 strain (see docs/balancer-variants.md), not baked into the half.
  { family: 'eT1', name: '', rows: [] },
  { family: 'eT1', name: 'let-?(s1799)', rows: [LETHAL] },
  { family: 'eT1', name: 'let-500(s2165)', rows: [LETHAL] },
  { family: 'eT1', name: 'let-?(n886)', rows: [LETHAL] },
  {
    family: 'eT1',
    name: 'him-5(e1467)',
    rows: [
      { pheno: 'him-5', zyg: '2', gene: 'him-5' },
      { pheno: 'unc-36', zyg: '2', gene: 'unc-36' },
    ],
  },
  // nT1
  // nT1 carries an egl-18 allele (Vul), entered as a real allele
  // egl-18(nT1vul) in the nT1 strain - not baked into the half.
  { family: 'nT1', name: '', rows: [] },
  {
    family: 'nT1',
    name: 'qIs51',
    rows: [{ pheno: 'pharyngeal GFP', zyg: '1or2' }, LETHAL],
  },
  {
    family: 'nT1',
    name: 'unc-?(n754dm) let-?',
    rows: [{ pheno: 'unc(n754dm)', zyg: '1or2' }, LETHAL],
  },
  {
    family: 'nT1',
    name: 'unc-?(n754dm) let-? qIs50',
    rows: [
      { pheno: 'unc(n754dm)', zyg: '1or2' },
      LETHAL,
      { pheno: 'GFP', zyg: '1or2', verify: 'qIs50 GFP' },
    ],
  },
  {
    family: 'nT1',
    name: 'unc-?(n754dm) let-?(m435)',
    rows: [{ pheno: 'unc(n754dm)', zyg: '1or2' }, LETHAL],
  },
  { family: 'nT1', name: 'let-?(m435)', rows: [LETHAL] },
  // hT2
  // Every hT2 carries bli-4(e937), entered as a real allele in the hT2 strain -
  // not baked into the half. So hT2[bli-4(e937)] is just the plain hT2 strain.
  { family: 'hT2', name: '', rows: [] },
  {
    family: 'hT2',
    name: 'bli-4(e937) let-?(q782) qIs48',
    rows: [{ pheno: 'pharyngeal GFP', zyg: '1or2' }, LETHAL],
  },
  // hT2[bli-4(e937) qIs48] is not a strain: qIs48 only occurs with the lethal
  // q782, and the one CGC genotype without it is described as homozygous lethal.
  { family: 'hT2', name: 'bli-4(e937) let-?(h661)', rows: [LETHAL] },
  {
    family: 'hT2',
    name: 'dpy-18(h662)',
    // Very mild Dpy; the collaborator's note that Bli is suppressed isn't modelled.
    rows: [{ pheno: 'dpy-18', zyg: '2', gene: 'dpy-18' }],
  },
  // szT1 - a plain half-allele pair, so a strain can hold it with real alleles
  { family: 'szT1', name: '', rows: [] },
  {
    family: 'szT1',
    name: 'lon-2(e678)',
    rows: [{ pheno: 'lon-2', zyg: '2', gene: 'lon-2' }],
  },
  {
    family: 'szT1',
    name: 'lon-2(e678) unc-29(e403)',
    rows: [
      { pheno: 'lon-2', zyg: '2', gene: 'lon-2' },
      { pheno: 'unc-29', zyg: '2', gene: 'unc-29' },
    ],
  },
  // hT3
  { family: 'hT3', name: '', rows: [LETHAL] },
  // mT1 - likewise
  { family: 'mT1', name: '', rows: [] },
  {
    family: 'mT1',
    name: 'dpy-10(e128)',
    rows: [
      { pheno: 'dpy-10', zyg: '2', gene: 'dpy-10' },
      { pheno: 'sterile', zyg: '2' },
    ],
  },
  // hT1
  { family: 'hT1', name: '', rows: [] },
];

// An allele's contents text (shown in the "contents" display modes).
const BASE_CONTENTS = {};

// ------------------------------------------------------------------ helpers
const STORED_DOMINANCE = { 2: 0, 1: 1, '1or2': 2, 0: 3, 5: 4 }; // zygosity -> stored int
const stored = (zyg) => STORED_DOMINANCE[zyg];

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
};

const csvEscape = (value) => {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (header, rows) =>
  [header, ...rows.map((r) => header.map((h) => r[h]))]
    .map((r) => r.map(csvEscape).join(','))
    .join('\n') + '\n';

const errors = [];
const check = (condition, message) => {
  if (!condition) errors.push(message);
};

// ------------------------------------------------------------------- genes
const genes = parseCsv(readFileSync(GENES_PATH, 'utf8'));
const genesByChrom = {};
const chromOfGene = new Map();
genes.forEach((g) => {
  const phys = Number(g.physLoc);
  const gen = Number(g.geneticLoc);
  if (g.physLoc !== '' && g.geneticLoc !== '' && !Number.isNaN(phys) && !Number.isNaN(gen))
    (genesByChrom[g.chromosome] ??= []).push([phys, gen]);
  if (g.descName !== '' && !chromOfGene.has(g.descName)) chromOfGene.set(g.descName, g.chromosome);
});
Object.values(genesByChrom).forEach((list) => list.sort((a, b) => a[0] - b[0]));

// Genetic position (cM) at a physical position, interpolated between the
// nearest genes on the chromosome.
const geneticAt = (chr, phys) => {
  const list = genesByChrom[chr] ?? [];
  check(list.length > 0, `no genes with positions on ${chr}`);
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid][0] < phys) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return list[0][1];
  if (lo >= list.length) return list[list.length - 1][1];
  const [p0, g0] = list[lo - 1];
  const [p1, g1] = list[lo];
  return p1 === p0 ? g0 : g0 + ((g1 - g0) * (phys - p0)) / (p1 - p0);
};

// -------------------------------------------------------- derive the tables
const isChromEnd = (chr, pos) => pos <= 1 || CHROMOSOME_LENGTHS[chr] - pos <= END_TOLERANCE;

const variations = [];
const phenotypeRows = new Map(); // `${name}|${wild}` -> row
const alleles = [];
const alleleExprs = [];
const exprRelations = [];
const verifyNotes = [];

const addPhenotype = (name, wild, extra = {}) => {
  const key = `${name}|${wild}`;
  if (phenotypeRows.has(key)) return;
  phenotypeRows.set(key, {
    name,
    wild,
    short_name: extra.short ?? name,
    description: extra.description ?? '',
    male_mating: extra.maleMating ?? 3,
    lethal: extra.lethal ?? 0,
    female_sterile: extra.femaleSterile ?? 0,
    arrested: 0,
    maturation_days: extra.lethal ? '' : 3.0,
  });
};

const ANEUPLOID = {
  het: 'translocation aneuploid (het)',
  hom: 'translocation aneuploid (hom)',
};
addPhenotype(ANEUPLOID.het, 0, { short: 'aneuploid', lethal: 1, maleMating: 0 });
addPhenotype(ANEUPLOID.hom, 0, { short: 'aneuploid', lethal: 1, maleMating: 0 });

const markerName = (family, chr, copies) => `${family}(${chr}) ${copies}`;
const familyByName = new Map(FAMILIES.map((f) => [f.name, f]));

FAMILIES.forEach((family) => {
  family.halves.forEach((half) => {
    const [start, end] = half.range;
    check(CHROMOSOME_LENGTHS[half.chr] !== undefined, `${family.name}: unknown chromosome ${half.chr}`);
    check(start >= 1 && end <= CHROMOSOME_LENGTHS[half.chr], `${family.name}(${half.chr}): range ${start}-${end} is outside the chromosome`);
    check(start < end, `${family.name}(${half.chr}): range start is not before its end`);
    const startAtEnd = isChromEnd(half.chr, start);
    const endAtEnd = isChromEnd(half.chr, end);
    check(startAtEnd !== endAtEnd, `${family.name}(${half.chr}): exactly one end of the range should be a chromosome end (got ${start}-${end})`);
    // Boundary = the end of the range that is NOT a chromosome end.
    half.boundary = startAtEnd ? end : start;
    half.variation = `${family.name}(${half.chr})`;
    variations.push({
      alleleName: half.variation,
      chromosome: half.chr,
      physLoc: half.boundary,
      geneticLoc: Math.round(geneticAt(half.chr, half.boundary) * 100) / 100,
      recombSuppressorStart: start,
      recombSuppressorEnd: end,
      isLocationReference: 'false',
      percentLoss: '',
    });
    ['1 copy', '2 copies'].forEach((copies) =>
      addPhenotype(markerName(family.name, half.chr, copies), 1, { short: `${family.name}(${half.chr})` })
    );
  });
  if (family.verify) verifyNotes.push(`${family.name}: ${family.verify}`);
});

const alleleNameOf = (variant, chr) =>
  variant.name === '' ? `${variant.family}(${chr})` : `${variant.family}[${variant.name}](${chr})`;
const variantLabel = (variant) => (variant.name === '' ? variant.family : `${variant.family}[${variant.name}]`);

// Only the plain balancers become half-alleles. The bracket variants
// (eT1[let-500(s2165)] ...) are NOT generated: each is entered as a strain that
// holds the balancer plus real gene/transgene alleles (docs/balancer-variants.md,
// todo #25). They stay in VARIANTS as the inventory of what those strains need.
const VARIANT_STRAINS = VARIANTS.filter((variant) => variant.name !== '');
VARIANTS.filter((variant) => variant.name === '').forEach((variant) => {
  const family = familyByName.get(variant.family);
  check(family !== undefined, `variant ${variantLabel(variant)}: unknown family`);
  if (family === undefined) return;

  // Which half each variant row sits on: the half whose chromosome carries
  // the gene, else the first half.
  const halfFor = (row) => {
    if (row.gene === undefined) return family.halves[0];
    const chr = chromOfGene.get(row.gene);
    check(chr !== undefined, `variant ${variantLabel(variant)}: gene ${row.gene} is not in the gene table`);
    return family.halves.find((h) => h.chr === chr) ?? family.halves[0];
  };

  family.halves.forEach((half) => {
    const name = alleleNameOf(variant, half.chr);
    const contents = BASE_CONTENTS[name] ?? (variant.name === '' ? '' : `[${variant.name}]`);
    alleles.push({ name, contents, sysGeneName: '', variationName: half.variation });

    const expr = (pheno, wild, zyg) =>
      alleleExprs.push({
        alleleName: name,
        expressingPhenotypeName: pheno,
        expressingPhenotypeWild: wild,
        dominance: stored(zyg),
      });

    // Copy-count markers, then aneuploid rows suppressed by the partner's.
    expr(markerName(family.name, half.chr, '1 copy'), 1, '1');
    expr(markerName(family.name, half.chr, '2 copies'), 1, '2');
    const partner = family.halves.find((h) => h !== half);
    if (partner !== undefined) {
      [
        { which: 'het', zyg: '1', copies: '1 copy' },
        { which: 'hom', zyg: '2', copies: '2 copies' },
      ].forEach(({ which, zyg, copies }) => {
        expr(ANEUPLOID[which], 0, zyg);
        exprRelations.push({
          allele_name: name,
          expressing_phenotype_name: ANEUPLOID[which],
          expressing_phenotype_wild: 0,
          altering_phenotype_name: markerName(family.name, partner.chr, copies),
          altering_phenotype_wild: 1,
          altering_condition: '',
          is_suppressing: 1,
        });
      });
    }

    // The variant's own phenotypes, on the half they belong to.
    variant.rows.forEach((row) => {
      if (halfFor(row) !== half) return;
      if (row.lethal) {
        const pheno = `${variantLabel(variant)} homozygous lethal`;
        addPhenotype(pheno, 0, { short: 'lethal', lethal: 1, maleMating: 0 });
        expr(pheno, 0, '2');
      } else {
        const def = PHENOTYPES[row.pheno];
        check(def !== undefined, `variant ${variantLabel(variant)}: no phenotype definition for ${row.pheno}`);
        addPhenotype(row.pheno, 0, def ?? {});
        expr(row.pheno, 0, row.zyg);
      }
      if (row.verify) verifyNotes.push(`${variantLabel(variant)}: ${row.verify}`);
    });
  });
});

// -------------------------------------------------------------- self-checks
const variationNames = new Set(variations.map((v) => v.alleleName));
const alleleNames = new Set();
alleles.forEach((a) => {
  check(!alleleNames.has(a.name), `duplicate allele name ${a.name}`);
  alleleNames.add(a.name);
  check(variationNames.has(a.variationName), `allele ${a.name}: variation ${a.variationName} does not exist`);
});
check(variationNames.size === variations.length, 'duplicate variation names');

const phenotypeKeys = new Set(phenotypeRows.keys());
const exprKeys = new Set();
alleleExprs.forEach((e) => {
  check(alleleNames.has(e.alleleName), `allele_exprs: allele ${e.alleleName} does not exist`);
  check(phenotypeKeys.has(`${e.expressingPhenotypeName}|${e.expressingPhenotypeWild}`), `allele_exprs: phenotype ${e.expressingPhenotypeName} does not exist`);
  const key = `${e.alleleName}|${e.expressingPhenotypeName}|${e.expressingPhenotypeWild}`;
  check(!exprKeys.has(key), `duplicate allele_exprs row ${key}`);
  exprKeys.add(key);
});
const relationKeys = new Set();
exprRelations.forEach((r) => {
  check(exprKeys.has(`${r.allele_name}|${r.expressing_phenotype_name}|${r.expressing_phenotype_wild}`), `expr_relations: no allele_exprs row for ${r.allele_name} / ${r.expressing_phenotype_name}`);
  check(phenotypeKeys.has(`${r.altering_phenotype_name}|${r.altering_phenotype_wild}`), `expr_relations: altering phenotype ${r.altering_phenotype_name} does not exist`);
  const key = [r.allele_name, r.expressing_phenotype_name, r.expressing_phenotype_wild, r.altering_phenotype_name, r.altering_phenotype_wild, r.altering_condition].join('|');
  check(!relationKeys.has(key), `duplicate expr_relations row ${key}`);
  relationKeys.add(key);
});
// An uncloned gene (keyed by its public name, e.g. dec-2) has an interpolated
// position - the midpoint of a ~70 kb span - so near a chromosome end it can
// fall a little past the end; only genes with a sequence name are checked.
const isUncloned = (g) => g.sysName === g.descName && /^[a-z]{2,4}-\d/.test(g.sysName);
genes.forEach((g) => {
  const length = CHROMOSOME_LENGTHS[g.chromosome];
  if (length !== undefined && g.physLoc !== '' && !isUncloned(g))
    check(Number(g.physLoc) <= length, `chromosome length for ${g.chromosome} is smaller than gene ${g.sysName} (${g.physLoc})`);
});

if (errors.length > 0) {
  console.error(`Self-checks failed (${errors.length}):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

// ------------------------------------------------------------------ outputs
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(dirname(DOC_PATH), { recursive: true });
const write = (file, header, rows) => {
  writeFileSync(join(OUT_DIR, file), toCsv(header, rows));
  console.log(`${file}: ${rows.length} rows`);
};
write('variations.csv', ['alleleName', 'chromosome', 'physLoc', 'geneticLoc', 'recombSuppressorStart', 'recombSuppressorEnd', 'isLocationReference', 'percentLoss'], variations);
write('phenotypes.csv', ['name', 'wild', 'short_name', 'description', 'male_mating', 'lethal', 'female_sterile', 'arrested', 'maturation_days'], [...phenotypeRows.values()]);
write('alleles.csv', ['name', 'contents', 'sysGeneName', 'variationName'], alleles);
write('allele_exprs.csv', ['alleleName', 'expressingPhenotypeName', 'expressingPhenotypeWild', 'dominance'], alleleExprs);
write('expr_relations.csv', ['allele_name', 'expressing_phenotype_name', 'expressing_phenotype_wild', 'altering_phenotype_name', 'altering_phenotype_wild', 'altering_condition', 'is_suppressing'], exprRelations);

// -------------------------------------------------------------------- docs
const familyTable = FAMILIES.flatMap((f) =>
  f.halves.map(
    (h, i) =>
      `| ${i === 0 ? `**${f.name}**` : ''} | ${h.chr} | ${h.range[0].toLocaleString('en-US')}-${h.range[1].toLocaleString('en-US')} | ${h.boundary.toLocaleString('en-US')} | ${i === 0 ? f.note : ''} |`
  )
).join('\n');
const variantList = VARIANT_STRAINS.map((v) => `- \`${variantLabel(v)}\``).join('\n');
const doc = `# Translocation balancers

Generated by \`scripts/build-translocations.mjs\` - do not edit by hand; change
the tables in the script and re-run it.

Reciprocal translocations (eT1, nT1, hT2, szT1, hT3, mT1, hT1) are a fixed
historical set. Each is entered as a **pair of half-alleles**, one per
chromosome, so the current schema holds them with no code changes.

> The inventory below comes from a collaborator's plan built on CGC / WormBook
> rearrangement records. It has not been independently verified. Entries
> marked *verify* need checking before relying on them.

## Inventory

Suppressed range (bp, WBcel235) is the region the genetics describes, between
a chromosome end and the named flanking gene (the smaller region where a span
was given). Each half sits at the **boundary** of its range - the end that is
not a chromosome end - with its genetic position interpolated from the gene
table. A heterozygous half suppresses crossovers inside its range.

| Family | Chr | Suppressed range | Position (boundary) | Notes |
|---|---|---|---|---|
${familyTable}

## Variants (not generated)

Only the plain balancers above are generated, one half-allele per chromosome.
The bracket variants are **not**: each is entered as a strain holding the
balancer plus real gene or transgene alleles on the same homolog (see
\`docs/balancer-variants.md\`). Every eT1 carries \`unc-36(e873)\`, so each eT1
strain includes that allele. The variants to build:

${variantList}

Excluded: \`eT2\` (a half-translocation, not a balancing pair) and \`meT7\` (no
description in the CGC record).

## Encoding

- Every half allele expresses wild marker phenotypes \`<family>(<chr>) 1 copy\`
  and \`<family>(<chr>) 2 copies\` (hidden on strain cards) and the two global
  lethal phenotypes \`${ANEUPLOID.het}\` / \`${ANEUPLOID.hom}\`.
- The aneuploid phenotypes are suppressed by the **partner** half's matching
  marker, so an animal is viable exactly when both halves are present in equal
  numbers: (III copies, V copies) = (0,0), (1,1) or (2,2) are viable, every
  other combination is lethal. (Verified in
  \`src/models/frontend/Strain/translocation.test.ts\`.)
- A plain balancer's own marker phenotype (hT3's homozygous lethality; nT1's
  Vul, hT2's Bli and eT1's Unc are real alleles in the strains instead) is a homozygous or either-zygosity row on its first
  half. \`allele_exprs.dominance\` is stored as an integer (homozygous = 0,
  het = 1, either = 2).

## Importing

Import in this order through each data table's Import button, parents first:
\`variations\`, \`phenotypes\`, \`alleles\`, \`allele_exprs\`, \`expr_relations\`.
The importers skip rows whose key already exists, so delete any older rows for
the same alleles first (the original eT1 encoding used mutually-suppressing
aneuploid phenotypes and no positions).

## Limits (not modelled)

- **Mixed variants in one animal** (e.g. \`eT1/eT1[let]; eT1/+\`): markers count
  copies per allele, not per locus, so some aneuploid mixed-variant zygotes read
  as viable. Rare in practice; the fix is locus-level copy counting in code.
- **Marker non-complementation** with gene alleles (e.g. \`eT1 / unc-36(x)\`).
- **szT1 and hT3 males:** males model X as \`top / +\`, so the half-X copy count
  and spontaneous Lon males need checking.
- **Segregation:** 50% balanced gametes; adjacent-2 segregation and nT1[qIs51]'s
  male-biased transmission are not modelled.

## Needs confirming

${[...new Set(verifyNotes)].map((n) => `- ${n}`).join('\n')}
`;
writeFileSync(DOC_PATH, doc);
console.log(`docs/translocations.md written; ${verifyNotes.length} items flagged to verify`);
zipFolder(OUT_DIR);
