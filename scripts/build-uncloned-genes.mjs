#!/usr/bin/env node
// Builds importable gene CSVs from WormBase's gene lists (todo #20):
//
//   node scripts/build-uncloned-genes.mjs
//
// Reads, from data/wormbase/:
//   c_elegans.canonical_bioproject.current.geneIDs.txt.gz  (CSV: taxon, WBGene
//       id, public name, sequence name, status, biotype)
//   c_elegans.PRJNA13758.current.geneOtherIDs.txt.gz        (TSV: WBGene id,
//       status, sequence name, public name, ONE other name)
// and src-tauri/seed/genes.csv, and writes files in the genes import format
// (sysName,descName,chromosome,physLoc,geneticLoc):
//
//   placeholder_genes.csv    one stand-in gene per unknown-gene allele used by
//       the translocation variants (let-?(s1799), let-500(s2165), ...), keyed
//       by the allele. Which half the gene is on is unknown, so each sits at
//       the junction of its balancer's first half (data/translocations/
//       variations.csv).
//   gene_synonyms.csv       a second row for each gene-style other name (e.g.
//       syx-1 for unc-64) of a cloned gene, keyed "<sysName> (<synonym>)" like
//       the existing unc-17 row, with the gene's own position. A synonym that
//       already is a gene name is skipped (the existing record wins), as is one
//       that two genes share (ambiguous).
//   uncloned_genes.csv      uncloned genes (a public name, no sequence name,
//       keyed by that name) that have a position in the old WS225 genetic-map
//       file: its cM value, and the midpoint of its interpolated physical span
//       (about 70 kb wide) as physLoc. One whose name is already in the table
//       is skipped - a gene with a systematic name is the newer record.
//   genes_pending_positions.csv  NOT for import yet: live genes still without
//       a position - uncloned genes the WS225 file does not cover, and live
//       sequence names missing from the table. A gene is only worth a row when
//       it gives an allele a position, so these wait until positions are found.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const LIST = 'data/wormbase/c_elegans.canonical_bioproject.current.geneIDs.txt.gz';
const GMAP = 'data/wormbase/c_elegans.WS225.genetic_limits.gff2';
const OTHER_IDS = 'data/wormbase/c_elegans.PRJNA13758.current.geneOtherIDs.txt.gz';
const HEADER = ['sysName', 'descName', 'chromosome', 'physLoc', 'geneticLoc'];

const parseCsv = (text) =>
  text
    .split(/\r?\n/)
    .filter((l) => l !== '')
    .map((l) => l.split(','));

const csvEscape = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const toCsv = (rows) =>
  [HEADER, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';

const table = parseCsv(readFileSync('src-tauri/seed/genes.csv', 'utf8')).slice(1);
const known = new Set(table.flatMap(([sys, desc]) => [sys, desc]));
const knownSys = new Set(table.map(([sys]) => sys));

const live = parseCsv(gunzipSync(readFileSync(LIST)).toString('utf8')).filter(
  (r) => r[4] === 'Live'
);

// WS225 genetic map: gene name -> { chromosome, span, cM }. Uncloned genes carry
// an interpolated span; the midpoint stands in for a single physical position.
const gmap = new Map();
readFileSync(GMAP, 'utf8')
  .split('\n')
  .forEach((line) => {
    const f = line.split('\t');
    const m = /^GMap (\S+) ; Note "\s*(-?[\d.]+) cM/.exec(f[8] ?? '');
    if (m !== null && f[1] === 'interpolated_pmap_position')
      gmap.set(m[1], [f[0], Math.round((Number(f[3]) + Number(f[4])) / 2), m[2]]);
  });

const placed = [];
const pending = [];
const skippedUncloned = [];
live.forEach(([, , publicName, seqName]) => {
  if (seqName === '' && publicName !== '') {
    if (known.has(publicName)) skippedUncloned.push(publicName);
    else if (gmap.has(publicName))
      placed.push([publicName, publicName, ...gmap.get(publicName)]);
    else pending.push([publicName, publicName, '', '', '']);
  } else if (seqName !== '' && !knownSys.has(seqName)) {
    pending.push([seqName, publicName === '' ? seqName : publicName, '', '', '']);
  }
});

// ----------------------------------------------------------------- synonyms
const GENE_STYLE = /^[a-z]{3,4}-\d/;
const bySeq = new Map(table.map((row) => [row[0], row]));
const others = gunzipSync(readFileSync(OTHER_IDS))
  .toString('utf8')
  .split('\n')
  .filter((l) => l !== '')
  .map((l) => l.split('\t'))
  .filter((r) => r[1] === 'Live' && GENE_STYLE.test(r[4] ?? ''));
const useCount = new Map();
others.forEach((r) => useCount.set(r[4], (useCount.get(r[4]) ?? 0) + 1));
const synonyms = [];
const skipped = { uncloned: [], existing: [], ambiguous: [], noPosition: [] };
others.forEach(([, , seqName, , synonym]) => {
  if (seqName === '') skipped.uncloned.push(synonym);
  else if (known.has(synonym)) skipped.existing.push(synonym);
  else if (useCount.get(synonym) > 1) skipped.ambiguous.push(synonym);
  else {
    const gene = bySeq.get(seqName);
    if (gene === undefined || gene[3] === '' || gene[4] === '')
      skipped.noPosition.push(synonym);
    else synonyms.push([`${seqName} (${synonym})`, synonym, gene[2], gene[3], gene[4]]);
  }
});

const variations = new Map(
  parseCsv(readFileSync('data/translocations/variations.csv', 'utf8'))
    .slice(1)
    .map(([name, chr, phys, gen]) => [name, [chr, phys, gen]])
);
// unknown-gene allele -> the balancer family whose first half hosts it
const PLACEHOLDERS = [
  ['let-500(s2165)', 'eT1(III)'], // let-500 is uncloned: no position of its own
  ['let-?(s1799)', 'eT1(III)'],
  ['let-?(n886)', 'eT1(III)'],
  ['let-?(m435)', 'nT1(IV)'],
  ['unc-?(n754dm)', 'nT1(IV)'],
  ['unc-?(n754)', 'nT1(IV)'],
  // Two nT1 variants carry a let-? with no allele name; each gets its own
  // numbered key, in the variants' order (nT1[unc-?(n754dm) let-?], then
  // nT1[unc-?(n754) let-? qIs50]).
  ['let-?(nT1_1)', 'nT1(IV)'],
  ['let-?(nT1_2)', 'nT1(IV)'],
  ['let-?(q782)', 'hT2(I)'],
  ['let-?(h661)', 'hT2(I)'],
];
const placeholders = PLACEHOLDERS.map(([key, half]) => {
  const pos = variations.get(half);
  if (pos === undefined) throw new Error(`no variation ${half} for ${key}`);
  return [key, key, ...pos];
});

writeFileSync('data/wormbase/uncloned_genes.csv', toCsv(placed));
writeFileSync('data/wormbase/gene_synonyms.csv', toCsv(synonyms));
writeFileSync('data/wormbase/genes_pending_positions.csv', toCsv(pending));
writeFileSync('data/wormbase/placeholder_genes.csv', toCsv(placeholders));
console.log(`placeholder_genes.csv: ${placeholders.length} rows`);
console.log(`uncloned_genes.csv: ${placed.length} rows`);
console.log(`gene_synonyms.csv: ${synonyms.length} rows`);
Object.entries(skipped).forEach(([why, list]) =>
  console.log(`  skipped synonyms (${why}): ${list.length}${why === 'ambiguous' ? ' - ' + [...new Set(list)].join(', ') : ''}`)
);
console.log(`genes_pending_positions.csv: ${pending.length} rows (not for import)`);
console.log(`uncloned names skipped (already in table): ${skippedUncloned.join(', ') || 'none'}`);
