#!/usr/bin/env node
// Writes the seed CSVs (src-tauri/seed/*.csv) from a copy of a worm-world
// database, so a brand-new install starts with that database's data. Unlike
// export-seed.sh (which rewrites all nine files from a curated scratch database),
// this is meant for a WORKING database: it keeps the shipped genes and
// conditions as they are and only adds to them:
//
//   node scripts/export-seed.mjs <path to a COPY of worm.sqlite>
//
// Copy worm.sqlite together with its -wal and -shm files (or close the app
// first); the export reads whatever the copy holds. Column names match what the
// importers read, rows keep their insertion order, and the app seeds the tables
// in dependency order on first run (see src-tauri/src/interface/seed.rs).
//
// Two tables are NOT overwritten from the database:
// - conditions.csv is the reviewed default list, kept as it is.
// - genes.csv keeps the shipped rows (their map positions are the precise ones)
//   and only gains the genes the database has that the file does not (uncloned
//   genes, synonyms and placeholder genes added from WormBase).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { zipFolder } from './lib/zipFolder.mjs';

const database = process.argv[2];
if (!database) {
  console.error('usage: node scripts/export-seed.mjs <path to a copy of worm.sqlite>');
  process.exit(1);
}

const bool = (column) => `CASE WHEN ${column} THEN 'true' ELSE 'false' END`;
const TABLES = {
  genes: 'SELECT systematic_name AS sysName, descriptive_name AS descName, chromosome, phys_loc AS physLoc, gen_loc AS geneticLoc FROM genes ORDER BY rowid',
  phenotypes: 'SELECT name, wild, short_name, description, male_mating, lethal, female_sterile, arrested, maturation_days FROM phenotypes ORDER BY rowid',
  variations: `SELECT allele_name AS alleleName, chromosome, phys_loc AS physLoc, gen_loc AS geneticLoc, recomb_suppressor_start AS recombSuppressorStart, recomb_suppressor_end AS recombSuppressorEnd, ${bool('is_location_reference')} AS isLocationReference, percent_loss AS percentLoss FROM variations ORDER BY rowid`,
  alleles: 'SELECT name, contents, systematic_gene_name AS sysGeneName, variation_name AS variationName FROM alleles ORDER BY rowid',
  allele_exprs: 'SELECT allele_name AS alleleName, expressing_phenotype_name AS expressingPhenotypeName, expressing_phenotype_wild AS expressingPhenotypeWild, dominance FROM allele_exprs ORDER BY rowid',
  expr_relations: 'SELECT allele_name, expressing_phenotype_name, expressing_phenotype_wild, altering_phenotype_name, altering_phenotype_wild, altering_condition, is_suppressing FROM expr_relations ORDER BY rowid',
  strains: 'SELECT name, genotype, description FROM strains ORDER BY rowid',
  strain_alleles: `SELECT strain_name AS strainName, allele_name AS alleleName, ${bool('is_on_top')} AS isOnTop, ${bool('is_on_bot')} AS isOnBot FROM strain_alleles ORDER BY rowid`,
};

const query = (sql) =>
  execFileSync('sqlite3', ['-csv', '-header', database, sql], { maxBuffer: 256 * 1024 * 1024 }).toString().replace(/\r\n/g, '\n');
// the first CSV field of a line (a gene key may be quoted)
const firstField = (line) => (line.startsWith('"') ? line.slice(1, line.indexOf('"', 1)) : line.split(',')[0]);

for (const [table, sql] of Object.entries(TABLES)) {
  let csv = query(sql);
  if (table === 'genes') {
    const existing = readFileSync('src-tauri/seed/genes.csv', 'utf8');
    const known = new Set(existing.split('\n').slice(1).map(firstField));
    const added = csv
      .split('\n')
      .slice(1)
      .filter((line) => line !== '' && !known.has(firstField(line)));
    csv = existing.endsWith('\n') ? existing : `${existing}\n`;
    csv += added.map((line) => `${line}\n`).join('');
    console.log(`genes.csv: kept ${known.size - 1} shipped rows, added ${added.length}`);
  }
  writeFileSync(`src-tauri/seed/${table}.csv`, csv);
  console.log(`${table}.csv: ${csv.trim().split('\n').length - 1} rows`);
}

// The same files as one zip, so an install that already has a database (the
// app only seeds a brand-new one) can load the full seed with "Import Data
// Tables Zip File".
zipFolder('src-tauri/seed', 'data/seed.zip');
