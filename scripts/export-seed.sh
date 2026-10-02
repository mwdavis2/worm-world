#!/usr/bin/env bash
# Regenerates the default/demo data CSVs in src-tauri/seed/ from a curated
# worm-world database, so they can be shipped inside the app and loaded on
# first run (see src-tauri/src/interface/seed.rs).
#
#   scripts/export-seed.sh <path-to-curated-worm.sqlite>
#
# Only SELECTs are run, but the database is opened normally (a WAL-mode
# database can't be opened with sqlite3 -readonly from a plain copy, and may
# gain -wal/-shm sidecar files). Curate demo content in a scratch database
# (run the app with a throwaway HOME so your real data is never involved),
# then point this at it. Set SEED_OUT to write somewhere other than
# src-tauri/seed/. Headers are the names the Import path expects (the serde
# names in src-tauri/src/models/), which is why this script, not the raw
# column names, is the one place that knows the mapping.
#
# tasks, cross_designs and the sync tables are intentionally not exported.
set -euo pipefail

DB="${1:?usage: scripts/export-seed.sh <path-to-curated-worm.sqlite>}"
[ -f "$DB" ] || { echo "No such database: $DB" >&2; exit 1; }
OUT="${SEED_OUT:-$(cd "$(dirname "$0")/.." && pwd)/src-tauri/seed}"
mkdir -p "$OUT"

export_table() { # <table> <select statement>
  sqlite3 -header -csv "$DB" "$2" > "$OUT/$1.csv"
  echo "$1: $(($(wc -l < "$OUT/$1.csv") - 1)) rows"
}

export_table genes "SELECT systematic_name AS sysName, descriptive_name AS descName, chromosome, phys_loc AS physLoc, gen_loc AS geneticLoc FROM genes ORDER BY systematic_name"
export_table conditions "SELECT name, description, male_mating, lethal, female_sterile, arrested, maturation_days FROM conditions ORDER BY name"
export_table phenotypes "SELECT name, wild, short_name, description, male_mating, lethal, female_sterile, arrested, maturation_days FROM phenotypes ORDER BY name, wild"
export_table variations "SELECT allele_name AS alleleName, chromosome, phys_loc AS physLoc, gen_loc AS geneticLoc, recomb_suppressor_start AS recombSuppressorStart, recomb_suppressor_end AS recombSuppressorEnd, CASE WHEN is_location_reference THEN 'true' ELSE 'false' END AS isLocationReference, percent_loss AS percentLoss FROM variations ORDER BY allele_name"
export_table alleles "SELECT name, contents, systematic_gene_name AS sysGeneName, variation_name AS variationName FROM alleles ORDER BY name"
export_table allele_exprs "SELECT allele_name AS alleleName, expressing_phenotype_name AS expressingPhenotypeName, expressing_phenotype_wild AS expressingPhenotypeWild, dominance FROM allele_exprs ORDER BY allele_name, expressing_phenotype_name, expressing_phenotype_wild"
export_table expr_relations "SELECT allele_name, expressing_phenotype_name, expressing_phenotype_wild, altering_phenotype_name, altering_phenotype_wild, altering_condition, is_suppressing FROM expr_relations ORDER BY allele_name, expressing_phenotype_name, expressing_phenotype_wild"
export_table strains "SELECT name, genotype, description FROM strains ORDER BY name"
export_table strain_alleles "SELECT strain_name AS strainName, allele_name AS alleleName, CASE WHEN is_on_top THEN 'true' ELSE 'false' END AS isOnTop, CASE WHEN is_on_bot THEN 'true' ELSE 'false' END AS isOnBot FROM strain_alleles ORDER BY strain_name, allele_name"
