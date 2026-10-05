#!/usr/bin/env node
// The strains that hold each translocation balancer with its real alleles
// (todo #25), as importable CSVs:
//
//   node scripts/build-balancer-strains.mjs
//
// Writes data/balancer_strains/{strains,strain_alleles}.csv. Import AFTER the
// translocation data (data/translocations/) and the real alleles
// (data/balancer_alleles/), since strain_alleles points at their alleles.
//
// Each strain is homozygous for the balancer (both halves) and its marker
// alleles (isOnTop and isOnBot true) - unless that homozygote would be lethal,
// as with the let alleles, n754dm and hT3's recessive lethality: then it is the
// balancer heterozygous over wild type, every allele on the top homolog (cis;
// isOnTop true, isOnBot false). The genotype text is built the way the app
// builds it (Strain.toString), and
// src/models/frontend/Strain/balancerStrains.test.ts checks it against the
// app's own code. The one allele that is not generated here is dpy-10(e128):
// it is the existing allele `e128`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const OUT_DIR = 'data/balancer_strains';
const E128 = { name: 'e128', geneSys: 'T14B4.7' }; // dpy-10(e128), already in the database

// [strain name, balancer family, extra alleles, description]
// Every eT1 carries unc-36(e873), every nT1 egl-18(nT1vul), every hT2 bli-4(e937).
const BASE = { eT1: ['e873'], nT1: ['nT1vul'], hT2: ['e937'], szT1: [], hT3: [], mT1: [], hT1: [] };
// (No hT2[bli-4(e937) qIs48]: the literature shows no strain with qIs48 but
// without the lethal q782; the one CGC genotype listed says it is homozygous lethal.)
const STRAINS = [
  ['eT1', 'eT1', []],
  ['eT1[let-?(s1799)]', 'eT1', ['s1799']],
  ['eT1[let-500(s2165)]', 'eT1', ['s2165']],
  ['eT1[let-?(n886)]', 'eT1', ['n886']],
  ['eT1[him-5(e1467)]', 'eT1', ['e1467']],
  ['nT1', 'nT1', []],
  ['nT1[qIs51]', 'nT1', ['qIs51']],
  ['nT1[unc-?(n754dm) let-?]', 'nT1', ['n754dm', 'nT1_1']],
  ['nT1[unc-?(n754dm) let-? qIs50]', 'nT1', ['n754dm', 'nT1_2', 'qIs50']],
  ['nT1[unc-?(n754dm) let-?(m435)]', 'nT1', ['n754dm', 'm435']],
  ['nT1[let-?(m435)]', 'nT1', ['m435']],
  ['hT2', 'hT2', []],
  ['hT2[bli-4(e937) let-?(q782) qIs48]', 'hT2', ['q782', 'qIs48']],
  ['hT2[bli-4(e937) let-?(h661)]', 'hT2', ['h661']],
  ['hT2[dpy-18(h662)]', 'hT2', ['h662']],
  ['szT1', 'szT1', []],
  ['szT1[lon-2(e678)]', 'szT1', ['e678']],
  ['szT1[lon-2(e678) unc-29(e403)]', 'szT1', ['e678', 'e403']],
  ['mT1', 'mT1', []],
  ['mT1[dpy-10(e128)]', 'mT1', ['e128']],
  ['hT3', 'hT3', []],
  ['hT1', 'hT1', []],
];

const parseCsv = (path) =>
  readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l !== '').slice(1).map((l) => l.split(','));
const csvEscape = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const toCsv = (header, rows) =>
  [header, ...rows.map((r) => header.map((h) => r[h] ?? ''))].map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';

// Which alleles make a homozygote lethal: one that expresses a lethal
// phenotype when homozygous (stored dominance 0 = 2 copies, 2 = 1 or 2 copies,
// 4 = 2 copies LOF).
const DIRS = ['data/translocations', 'data/balancer_alleles'];
const lethalPhenotypes = new Set(
  DIRS.flatMap((dir) => parseCsv(`${dir}/phenotypes.csv`))
    .filter(([, , , , , lethal]) => lethal === '1')
    .map(([name, wild]) => `${name}|${wild}`)
);
const HOMOZYGOUS_DOMINANCE = new Set(['0', '2', '4']);
// A lethal row that another phenotype suppresses (the translocation halves'
// "aneuploid" rows, suppressed by the partner half) is not a lethal homozygote:
// a balanced homozygote carries both halves in equal numbers.
const suppressedRows = new Set(
  DIRS.flatMap((dir) => parseCsv(`${dir}/expr_relations.csv`)).map(
    ([allele, phenotype, wild]) => `${allele}|${phenotype}|${wild}`
  )
);
const lethalWhenHomozygous = new Set(
  DIRS.flatMap((dir) => parseCsv(`${dir}/allele_exprs.csv`))
    .filter(
      ([allele, phenotype, wild, dominance]) =>
        lethalPhenotypes.has(`${phenotype}|${wild}`) &&
        HOMOZYGOUS_DOMINANCE.has(dominance) &&
        !suppressedRows.has(`${allele}|${phenotype}|${wild}`)
    )
    .map(([allele]) => allele)
);

const errors = [];
const check = (condition, message) => {
  if (!condition) errors.push(message);
};

// Genes and variations, for each allele's chromosome, position and label.
const genes = new Map(
  [...parseCsv('src-tauri/seed/genes.csv'), ...parseCsv('data/wormbase/placeholder_genes.csv')].map(
    ([sys, desc, chr, , gen]) => [sys, { desc: desc === '' ? sys : desc, chr, gen: Number(gen) }]
  )
);
const variations = new Map(
  [...parseCsv('data/translocations/variations.csv'), ...parseCsv('data/balancer_alleles/variations.csv')].map(
    ([name, chr, , gen]) => [name, { chr, gen: Number(gen) }]
  )
);
// allele name -> { label, chr, gen }
const alleleInfo = new Map();
[...parseCsv('data/translocations/alleles.csv'), ...parseCsv('data/balancer_alleles/alleles.csv')].forEach(
  ([name, , geneKey, variationName]) => {
    if (variationName !== '') {
      const v = variations.get(variationName);
      check(v !== undefined, `allele ${name}: variation ${variationName} not found`);
      if (v !== undefined) alleleInfo.set(name, { label: name, chr: v.chr, gen: v.gen });
    } else {
      const g = genes.get(geneKey);
      check(g !== undefined, `allele ${name}: gene ${geneKey} not found`);
      if (g !== undefined) alleleInfo.set(name, { label: `${g.desc}(${name})`, chr: g.chr, gen: g.gen });
    }
  }
);
const e128Gene = genes.get(E128.geneSys);
check(e128Gene !== undefined, 'dpy-10 (T14B4.7) not found');
if (e128Gene !== undefined)
  alleleInfo.set(E128.name, { label: `${e128Gene.desc}(${E128.name})`, chr: e128Gene.chr, gen: e128Gene.gen });

// The halves of each balancer family: nT1 -> nT1(IV), nT1(V).
const halvesOf = (family) =>
  [...alleleInfo.keys()].filter((name) => new RegExp(`^${family}\\((IV|V|III|II|I|X)\\)$`).test(name));

const CHROMOSOME_ORDER = ['I', 'II', 'III', 'IV', 'V', 'X'];

// The genotype text as Strain.toString builds it: chromosomes in order, each
// "<top alleles>/<wild partners> <chromosome>", alleles sorted by genetic
// position (the same comparator as AllelePair.sort), joined with "; ".
const genotypeOf = (alleleNames, homozygous) => {
  const byChromosome = new Map();
  alleleNames.forEach((name) => {
    const info = alleleInfo.get(name);
    byChromosome.set(info.chr, [...(byChromosome.get(info.chr) ?? []), info]);
  });
  const text = CHROMOSOME_ORDER.filter((chr) => byChromosome.has(chr))
    .map((chr) => {
      const infos = byChromosome.get(chr);
      infos.sort((a, b) => (a.gen < b.gen ? -1 : 1));
      const top = infos.map((i) => i.label).join(' ');
      return homozygous ? `${top} ${chr}` : `${top}/${infos.map(() => '+').join(' ')} ${chr}`;
    })
    .join('; ');
  return `${text}.`;
};

const strains = [];
const strainAlleles = [];
STRAINS.forEach(([name, family, extras]) => {
  const halves = halvesOf(family);
  check(halves.length > 0, `${name}: no half-alleles for ${family}`);
  const alleles = [...halves, ...BASE[family], ...extras];
  alleles.forEach((a) => check(alleleInfo.has(a), `${name}: allele ${a} not found`));
  if (alleles.some((a) => !alleleInfo.has(a))) return;
  const markers = [...BASE[family], ...extras].map((a) => alleleInfo.get(a).label);
  const homozygous = !alleles.some((a) => lethalWhenHomozygous.has(a));
  strains.push({
    name,
    genotype: genotypeOf(alleles, homozygous),
    description: `${family} translocation balancer ${homozygous ? 'homozygous' : 'heterozygous over wild type (the homozygote is lethal)'}${markers.length > 0 ? ` with ${markers.join(' ')}` : ''}.`,
  });
  alleles.forEach((alleleName) =>
    strainAlleles.push({ strainName: name, alleleName, isOnTop: 'true', isOnBot: homozygous ? 'true' : 'false' })
  );
});

check(new Set(strains.map((s) => s.name)).size === strains.length, 'duplicate strain names');
if (errors.length > 0) {
  console.error(`Self-checks failed (${errors.length}):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/strains.csv`, toCsv(['name', 'genotype', 'description'], strains));
writeFileSync(`${OUT_DIR}/strain_alleles.csv`, toCsv(['strainName', 'alleleName', 'isOnTop', 'isOnBot'], strainAlleles));
console.log(`strains.csv: ${strains.length} rows`);
console.log(`strain_alleles.csv: ${strainAlleles.length} rows`);
