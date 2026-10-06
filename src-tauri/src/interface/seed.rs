//! Default/demo data shipped inside the app and loaded into a brand-new
//! database on first run, so a fresh install isn't an empty shell.
//!
//! The data lives as CSVs in `src-tauri/seed/` (the same format the Import
//! button reads), embedded in the binary. Every importable table has a file
//! there: a header-only file ships nothing for that table, so shipping more
//! demo data is just replacing a CSV - no code change. The files are produced
//! from a curated database by `scripts/export-seed.sh`.

use super::{bulk::Bulk, DbError, InnerDbState};
use csv::Reader;
use serde::de::DeserializeOwned;
use std::path::Path;

fn bulk_from<T: DeserializeOwned>(csv_bytes: &[u8]) -> Bulk<T> {
    Bulk::from_reader(&mut Reader::from_reader(csv_bytes))
}

/// A database file that doesn't exist yet means a brand-new install.
/// Must be asked before the connection pool is created, since that creates
/// the file.
pub fn is_first_run(database_file: &Path) -> bool {
    !database_file.exists()
}

/// Deletes a database file along with its WAL/SHM sidecars. Used to throw
/// away a half-seeded first-run database (which holds no user data yet).
pub fn remove_database_files(database_file: &Path) {
    let base = database_file.as_os_str().to_owned();
    for suffix in ["", "-wal", "-shm"] {
        let mut path = base.clone();
        path.push(suffix);
        // A missing sidecar is normal.
        let _ = std::fs::remove_file(path);
    }
}

impl InnerDbState {
    /// Loads the shipped default data. Meant for a freshly migrated, empty
    /// database. Parents are inserted before the tables that reference them.
    pub async fn seed_defaults(&self) -> Result<(), DbError> {
        self.insert_genes(bulk_from(include_bytes!("../../seed/genes.csv")))
            .await?;
        self.insert_conditions(bulk_from(include_bytes!("../../seed/conditions.csv")))
            .await?;
        self.insert_phenotypes(bulk_from(include_bytes!("../../seed/phenotypes.csv")))
            .await?;
        self.insert_variations(bulk_from(include_bytes!("../../seed/variations.csv")))
            .await?;
        self.insert_alleles(bulk_from(include_bytes!("../../seed/alleles.csv")))
            .await?;
        self.insert_allele_exprs(bulk_from(include_bytes!("../../seed/allele_exprs.csv")))
            .await?;
        self.insert_expr_relations(bulk_from(include_bytes!("../../seed/expr_relations.csv")))
            .await?;
        self.insert_strains(bulk_from(include_bytes!("../../seed/strains.csv")))
            .await?;
        self.insert_strain_alleles(bulk_from(include_bytes!("../../seed/strain_alleles.csv")))
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Sqlite};
    use std::collections::HashSet;

    // (table, embedded csv, number of leading columns forming the primary
    // key, so duplicate keys in a file - which INSERT OR IGNORE drops - are
    // counted once).
    const SEEDS: [(&str, &[u8], usize); 9] = [
        ("genes", include_bytes!("../../seed/genes.csv"), 1),
        ("conditions", include_bytes!("../../seed/conditions.csv"), 1),
        ("phenotypes", include_bytes!("../../seed/phenotypes.csv"), 2),
        ("variations", include_bytes!("../../seed/variations.csv"), 1),
        ("alleles", include_bytes!("../../seed/alleles.csv"), 1),
        (
            "allele_exprs",
            include_bytes!("../../seed/allele_exprs.csv"),
            3,
        ),
        (
            "expr_relations",
            include_bytes!("../../seed/expr_relations.csv"),
            7,
        ),
        ("strains", include_bytes!("../../seed/strains.csv"), 1),
        (
            "strain_alleles",
            include_bytes!("../../seed/strain_alleles.csv"),
            2,
        ),
    ];

    fn distinct_keys(csv_bytes: &[u8], key_columns: usize) -> usize {
        let mut reader = Reader::from_reader(csv_bytes);
        reader
            .records()
            .map(|rec| {
                let rec = rec.expect("seed CSV row should parse");
                rec.iter()
                    .take(key_columns)
                    .collect::<Vec<_>>()
                    .join("\u{1f}")
            })
            .collect::<HashSet<_>>()
            .len()
    }

    #[sqlx::test]
    async fn seeds_every_shipped_csv_into_an_empty_database(pool: Pool<Sqlite>) {
        let state = InnerDbState {
            conn_pool: pool.clone(),
        };
        state
            .seed_defaults()
            .await
            .expect("every shipped seed CSV should import cleanly");

        for (table, csv_bytes, key_columns) in SEEDS {
            let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(
                count as usize,
                distinct_keys(csv_bytes, key_columns),
                "row count for {table}"
            );
        }
    }

    // INSERT OR IGNORE silently drops a row whose key already exists, so a
    // duplicate key in a shipped file would quietly lose data (it did: three
    // gene pairs shared a systematic name). Every row must have its own key.
    #[test]
    fn no_shipped_csv_has_duplicate_keys() {
        for (table, csv_bytes, key_columns) in SEEDS {
            let rows = Reader::from_reader(csv_bytes).records().count();
            assert_eq!(
                rows,
                distinct_keys(csv_bytes, key_columns),
                "{table} seed CSV has rows with duplicate keys"
            );
        }
    }

    // The translocation-balancer data generated by
    // scripts/build-translocations.mjs, imported the way the data tables'
    // Import button does it (parents first). Guards the generator's output
    // against foreign-key mistakes and bad rows.
    #[sqlx::test]
    async fn generated_translocation_csvs_import_cleanly(pool: Pool<Sqlite>) {
        let state = InnerDbState {
            conn_pool: pool.clone(),
        };
        state
            .insert_phenotypes(bulk_from(include_bytes!(
                "../../../data/translocations/phenotypes.csv"
            )))
            .await
            .unwrap();
        state
            .insert_variations(bulk_from(include_bytes!(
                "../../../data/translocations/variations.csv"
            )))
            .await
            .unwrap();
        state
            .insert_alleles(bulk_from(include_bytes!(
                "../../../data/translocations/alleles.csv"
            )))
            .await
            .unwrap();
        state
            .insert_allele_exprs(bulk_from(include_bytes!(
                "../../../data/translocations/allele_exprs.csv"
            )))
            .await
            .unwrap();
        state
            .insert_expr_relations(bulk_from(include_bytes!(
                "../../../data/translocations/expr_relations.csv"
            )))
            .await
            .unwrap();

        for (table, csv_bytes, key_columns) in [
            (
                "phenotypes",
                &include_bytes!("../../../data/translocations/phenotypes.csv")[..],
                2,
            ),
            (
                "variations",
                &include_bytes!("../../../data/translocations/variations.csv")[..],
                1,
            ),
            (
                "alleles",
                &include_bytes!("../../../data/translocations/alleles.csv")[..],
                1,
            ),
            (
                "allele_exprs",
                &include_bytes!("../../../data/translocations/allele_exprs.csv")[..],
                3,
            ),
            (
                "expr_relations",
                &include_bytes!("../../../data/translocations/expr_relations.csv")[..],
                6,
            ),
        ] {
            let rows = Reader::from_reader(csv_bytes).records().count();
            assert_eq!(
                rows,
                distinct_keys(csv_bytes, key_columns),
                "{table}: duplicate keys"
            );
            let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count as usize, rows, "{table}: every row should import");
        }
    }

    // The real alleles the translocation balancers carry, generated by
    // scripts/build-balancer-alleles.mjs: their genes (shipped, plus the
    // placeholder genes) must exist and every row must import.
    #[sqlx::test]
    async fn generated_balancer_allele_csvs_import_cleanly(pool: Pool<Sqlite>) {
        let state = InnerDbState {
            conn_pool: pool.clone(),
        };
        state.seed_defaults().await.unwrap();
        state
            .insert_genes(bulk_from(include_bytes!(
                "../../../data/wormbase/placeholder_genes.csv"
            )))
            .await
            .unwrap();
        state
            .insert_variations(bulk_from(include_bytes!(
                "../../../data/balancer_alleles/variations.csv"
            )))
            .await
            .unwrap();
        state
            .insert_phenotypes(bulk_from(include_bytes!(
                "../../../data/balancer_alleles/phenotypes.csv"
            )))
            .await
            .unwrap();
        state
            .insert_alleles(bulk_from(include_bytes!(
                "../../../data/balancer_alleles/alleles.csv"
            )))
            .await
            .unwrap();
        state
            .insert_allele_exprs(bulk_from(include_bytes!(
                "../../../data/balancer_alleles/allele_exprs.csv"
            )))
            .await
            .unwrap();
        state
            .insert_expr_relations(bulk_from(include_bytes!(
                "../../../data/balancer_alleles/expr_relations.csv"
            )))
            .await
            .unwrap();

        for (table, csv_bytes, key_columns) in [
            (
                "variations",
                &include_bytes!("../../../data/balancer_alleles/variations.csv")[..],
                1,
            ),
            (
                "phenotypes",
                &include_bytes!("../../../data/balancer_alleles/phenotypes.csv")[..],
                2,
            ),
            (
                "alleles",
                &include_bytes!("../../../data/balancer_alleles/alleles.csv")[..],
                1,
            ),
            (
                "allele_exprs",
                &include_bytes!("../../../data/balancer_alleles/allele_exprs.csv")[..],
                3,
            ),
            (
                "expr_relations",
                &include_bytes!("../../../data/balancer_alleles/expr_relations.csv")[..],
                6,
            ),
        ] {
            let rows = Reader::from_reader(csv_bytes).records().count();
            assert_eq!(
                rows,
                distinct_keys(csv_bytes, key_columns),
                "{table}: duplicate keys"
            );
            let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count as usize, rows, "{table}: every row should import");
        }

        // Every allele points at a gene that exists.
        let orphans: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM alleles WHERE systematic_gene_name NOT IN (SELECT systematic_name FROM genes)",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(orphans, 0, "alleles whose gene does not exist");
        let variation_orphans: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM alleles WHERE variation_name IS NOT NULL AND variation_name NOT IN (SELECT allele_name FROM variations)",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(variation_orphans, 0, "alleles whose variation does not exist");
    }

    // The balancer strains generated by scripts/build-balancer-strains.mjs,
    // imported on top of everything they point at (the shipped genes, the
    // placeholder genes, the translocation data, the real balancer alleles and
    // the existing dpy-10 allele e128): every strain and strain_allele row must
    // import, and each must reference an allele and a strain that exist.
    #[sqlx::test]
    async fn generated_balancer_strain_csvs_import_cleanly(pool: Pool<Sqlite>) {
        let state = InnerDbState {
            conn_pool: pool.clone(),
        };
        state.seed_defaults().await.unwrap();
        state
            .insert_genes(bulk_from(include_bytes!(
                "../../../data/wormbase/placeholder_genes.csv"
            )))
            .await
            .unwrap();
        state
            .insert_variations(bulk_from(include_bytes!(
                "../../../data/translocations/variations.csv"
            )))
            .await
            .unwrap();
        state
            .insert_phenotypes(bulk_from(include_bytes!(
                "../../../data/translocations/phenotypes.csv"
            )))
            .await
            .unwrap();
        state
            .insert_alleles(bulk_from(include_bytes!(
                "../../../data/translocations/alleles.csv"
            )))
            .await
            .unwrap();
        state
            .insert_allele_exprs(bulk_from(include_bytes!(
                "../../../data/translocations/allele_exprs.csv"
            )))
            .await
            .unwrap();
        state
            .insert_expr_relations(bulk_from(include_bytes!(
                "../../../data/translocations/expr_relations.csv"
            )))
            .await
            .unwrap();
        state
            .insert_variations(bulk_from(include_bytes!(
                "../../../data/balancer_alleles/variations.csv"
            )))
            .await
            .unwrap();
        state
            .insert_phenotypes(bulk_from(include_bytes!(
                "../../../data/balancer_alleles/phenotypes.csv"
            )))
            .await
            .unwrap();
        state
            .insert_alleles(bulk_from(include_bytes!(
                "../../../data/balancer_alleles/alleles.csv"
            )))
            .await
            .unwrap();
        state
            .insert_allele_exprs(bulk_from(include_bytes!(
                "../../../data/balancer_alleles/allele_exprs.csv"
            )))
            .await
            .unwrap();
        state
            .insert_expr_relations(bulk_from(include_bytes!(
                "../../../data/balancer_alleles/expr_relations.csv"
            )))
            .await
            .unwrap();
        state
            .insert_alleles(bulk_from(
                b"name,contents,sysGeneName,variationName\ne128,,T14B4.7,\n".as_slice(),
            ))
            .await
            .unwrap();
        state
            .insert_strains(bulk_from(include_bytes!(
                "../../../data/balancer_strains/strains.csv"
            )))
            .await
            .unwrap();
        state
            .insert_strain_alleles(bulk_from(include_bytes!(
                "../../../data/balancer_strains/strain_alleles.csv"
            )))
            .await
            .unwrap();

        for (table, csv_bytes, key_columns) in [
            (
                "strains",
                &include_bytes!("../../../data/balancer_strains/strains.csv")[..],
                1,
            ),
            (
                "strain_alleles",
                &include_bytes!("../../../data/balancer_strains/strain_alleles.csv")[..],
                2,
            ),
        ] {
            let rows = Reader::from_reader(csv_bytes).records().count();
            assert_eq!(
                rows,
                distinct_keys(csv_bytes, key_columns),
                "{table}: duplicate keys"
            );
            let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count as usize, rows, "{table}: every row should import");
        }
        let orphan_alleles: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM strain_alleles WHERE allele_name NOT IN (SELECT name FROM alleles)",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(orphan_alleles, 0, "strain_alleles whose allele does not exist");
        let orphan_strains: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM strain_alleles WHERE strain_name NOT IN (SELECT name FROM strains)",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(orphan_strains, 0, "strain_alleles whose strain does not exist");
    }

    // The CRISPR inversion balancers and their Pmyo-2 strains generated by
    // scripts/build-inversion-balancers.mjs, imported on top of the shipped gene
    // table: every row must import and every reference must resolve.
    #[sqlx::test]
    async fn generated_inversion_balancer_csvs_import_cleanly(pool: Pool<Sqlite>) {
        let state = InnerDbState {
            conn_pool: pool.clone(),
        };
        state.seed_defaults().await.unwrap();
        // rol-9 is one of the uncloned genes
        state
            .insert_genes(bulk_from(include_bytes!(
                "../../../data/wormbase/uncloned_genes.csv"
            )))
            .await
            .unwrap();
        state
            .insert_variations(bulk_from(include_bytes!(
                "../../../data/inversion_balancers/variations.csv"
            )))
            .await
            .unwrap();
        state
            .insert_phenotypes(bulk_from(include_bytes!(
                "../../../data/inversion_balancers/phenotypes.csv"
            )))
            .await
            .unwrap();
        state
            .insert_alleles(bulk_from(include_bytes!(
                "../../../data/inversion_balancers/alleles.csv"
            )))
            .await
            .unwrap();
        // dpy-10(e128) already exists in the database; the strains use it
        state
            .insert_alleles(bulk_from(
                b"name,contents,sysGeneName,variationName\ne128,,T14B4.7,\n".as_slice(),
            ))
            .await
            .unwrap();
        state
            .insert_allele_exprs(bulk_from(include_bytes!(
                "../../../data/inversion_balancers/allele_exprs.csv"
            )))
            .await
            .unwrap();
        state
            .insert_expr_relations(bulk_from(include_bytes!(
                "../../../data/inversion_balancers/expr_relations.csv"
            )))
            .await
            .unwrap();
        state
            .insert_strains(bulk_from(include_bytes!(
                "../../../data/inversion_balancers/strains.csv"
            )))
            .await
            .unwrap();
        state
            .insert_strain_alleles(bulk_from(include_bytes!(
                "../../../data/inversion_balancers/strain_alleles.csv"
            )))
            .await
            .unwrap();

        for (table, csv_bytes, key_columns) in [
            (
                "variations",
                &include_bytes!("../../../data/inversion_balancers/variations.csv")[..],
                1,
            ),
            (
                "phenotypes",
                &include_bytes!("../../../data/inversion_balancers/phenotypes.csv")[..],
                2,
            ),
            (
                "alleles",
                &include_bytes!("../../../data/inversion_balancers/alleles.csv")[..],
                1,
            ),
            (
                "allele_exprs",
                &include_bytes!("../../../data/inversion_balancers/allele_exprs.csv")[..],
                3,
            ),
            (
                "expr_relations",
                &include_bytes!("../../../data/inversion_balancers/expr_relations.csv")[..],
                6,
            ),
            (
                "strains",
                &include_bytes!("../../../data/inversion_balancers/strains.csv")[..],
                1,
            ),
            (
                "strain_alleles",
                &include_bytes!("../../../data/inversion_balancers/strain_alleles.csv")[..],
                2,
            ),
        ] {
            let rows = Reader::from_reader(csv_bytes).records().count();
            assert_eq!(
                rows,
                distinct_keys(csv_bytes, key_columns),
                "{table}: duplicate keys"
            );
            let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&pool)
                .await
                .unwrap();
            // e128 was added by hand to the alleles
            let expected = rows + usize::from(table == "alleles");
            assert_eq!(count as usize, expected, "{table}: every row should import");
        }
        for (what, query) in [
            (
                "alleles whose gene does not exist",
                "SELECT COUNT(*) FROM alleles WHERE systematic_gene_name IS NOT NULL AND systematic_gene_name NOT IN (SELECT systematic_name FROM genes)",
            ),
            (
                "alleles whose variation does not exist",
                "SELECT COUNT(*) FROM alleles WHERE variation_name IS NOT NULL AND variation_name NOT IN (SELECT allele_name FROM variations)",
            ),
            (
                "strain_alleles whose allele does not exist",
                "SELECT COUNT(*) FROM strain_alleles WHERE allele_name NOT IN (SELECT name FROM alleles)",
            ),
            (
                "strain_alleles whose strain does not exist",
                "SELECT COUNT(*) FROM strain_alleles WHERE strain_name NOT IN (SELECT name FROM strains)",
            ),
        ] {
            let orphans: i64 = sqlx::query_scalar(query).fetch_one(&pool).await.unwrap();
            assert_eq!(orphans, 0, "{what}");
        }
    }

    // The CSVs written by scripts/build-lin-15.mjs, imported on top of the
    // balancer alleles they reuse (lon-2(e678), bli-4(e937)) and a stand-in for
    // oxIs644, which exists only in the live database.
    #[sqlx::test]
    async fn generated_lin_15_csvs_import_cleanly(pool: Pool<Sqlite>) {
        let state = InnerDbState {
            conn_pool: pool.clone(),
        };
        state.seed_defaults().await.unwrap();
        state
            .insert_genes(bulk_from(include_bytes!(
                "../../../data/wormbase/placeholder_genes.csv"
            )))
            .await
            .unwrap();
        state
            .insert_variations(bulk_from(include_bytes!(
                "../../../data/balancer_alleles/variations.csv"
            )))
            .await
            .unwrap();
        state
            .insert_variations(bulk_from(
                b"alleleName,chromosome,physLoc,geneticLoc,recombSuppressorStart,recombSuppressorEnd,isLocationReference,percentLoss\noxIs644,X,,,,,false,\n"
                    .as_slice(),
            ))
            .await
            .unwrap();
        state
            .insert_phenotypes(bulk_from(include_bytes!(
                "../../../data/balancer_alleles/phenotypes.csv"
            )))
            .await
            .unwrap();
        state
            .insert_alleles(bulk_from(include_bytes!(
                "../../../data/balancer_alleles/alleles.csv"
            )))
            .await
            .unwrap();
        state
            .insert_alleles(bulk_from(
                b"name,contents,sysGeneName,variationName\noxIs644,,,oxIs644\n".as_slice(),
            ))
            .await
            .unwrap();
        state
            .insert_allele_exprs(bulk_from(include_bytes!(
                "../../../data/balancer_alleles/allele_exprs.csv"
            )))
            .await
            .unwrap();
        state
            .insert_expr_relations(bulk_from(include_bytes!(
                "../../../data/balancer_alleles/expr_relations.csv"
            )))
            .await
            .unwrap();

        state
            .insert_variations(bulk_from(include_bytes!(
                "../../../data/lin_15/variations.csv"
            )))
            .await
            .unwrap();
        state
            .insert_phenotypes(bulk_from(include_bytes!(
                "../../../data/lin_15/phenotypes.csv"
            )))
            .await
            .unwrap();
        state
            .insert_alleles(bulk_from(include_bytes!(
                "../../../data/lin_15/alleles.csv"
            )))
            .await
            .unwrap();
        state
            .insert_allele_exprs(bulk_from(include_bytes!(
                "../../../data/lin_15/allele_exprs.csv"
            )))
            .await
            .unwrap();
        state
            .insert_expr_relations(bulk_from(include_bytes!(
                "../../../data/lin_15/expr_relations.csv"
            )))
            .await
            .unwrap();
        state
            .insert_strains(bulk_from(include_bytes!(
                "../../../data/lin_15/strains.csv"
            )))
            .await
            .unwrap();
        state
            .insert_strain_alleles(bulk_from(include_bytes!(
                "../../../data/lin_15/strain_alleles.csv"
            )))
            .await
            .unwrap();

        // Every row of a table nothing else writes to must import, and the
        // generated keys must be unique.
        for (table, csv_bytes, key_columns) in [
            (
                "strains",
                &include_bytes!("../../../data/lin_15/strains.csv")[..],
                1,
            ),
            (
                "strain_alleles",
                &include_bytes!("../../../data/lin_15/strain_alleles.csv")[..],
                2,
            ),
            (
                "variations",
                &include_bytes!("../../../data/lin_15/variations.csv")[..],
                1,
            ),
            (
                "phenotypes",
                &include_bytes!("../../../data/lin_15/phenotypes.csv")[..],
                2,
            ),
            (
                "alleles",
                &include_bytes!("../../../data/lin_15/alleles.csv")[..],
                1,
            ),
            (
                "allele_exprs",
                &include_bytes!("../../../data/lin_15/allele_exprs.csv")[..],
                3,
            ),
            (
                "expr_relations",
                &include_bytes!("../../../data/lin_15/expr_relations.csv")[..],
                6,
            ),
        ] {
            let rows = Reader::from_reader(csv_bytes).records().count();
            assert_eq!(
                rows,
                distinct_keys(csv_bytes, key_columns),
                "{table}: duplicate keys"
            );
            let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&pool)
                .await
                .unwrap();
            if table == "strains" || table == "strain_alleles" {
                assert_eq!(count as usize, rows, "{table}: every row should import");
            } else {
                assert!(count as usize >= rows, "{table}: every row should import");
            }
        }
        for (what, query) in [
            (
                "alleles whose gene does not exist",
                "SELECT COUNT(*) FROM alleles WHERE systematic_gene_name IS NOT NULL AND systematic_gene_name NOT IN (SELECT systematic_name FROM genes)",
            ),
            (
                "alleles whose variation does not exist",
                "SELECT COUNT(*) FROM alleles WHERE variation_name IS NOT NULL AND variation_name NOT IN (SELECT allele_name FROM variations)",
            ),
            (
                "strain_alleles whose allele does not exist",
                "SELECT COUNT(*) FROM strain_alleles WHERE allele_name NOT IN (SELECT name FROM alleles)",
            ),
            (
                "strain_alleles whose strain does not exist",
                "SELECT COUNT(*) FROM strain_alleles WHERE strain_name NOT IN (SELECT name FROM strains)",
            ),
            (
                "allele_exprs whose phenotype does not exist",
                "SELECT COUNT(*) FROM allele_exprs e WHERE NOT EXISTS (SELECT 1 FROM phenotypes p WHERE p.name = e.expressing_phenotype_name AND p.wild = e.expressing_phenotype_wild)",
            ),
            (
                "expr_relations whose condition does not exist",
                "SELECT COUNT(*) FROM expr_relations WHERE altering_condition IS NOT NULL AND altering_condition NOT IN (SELECT name FROM conditions)",
            ),
        ] {
            let orphans: i64 = sqlx::query_scalar(query).fetch_one(&pool).await.unwrap();
            assert_eq!(orphans, 0, "{what}");
        }
    }

    #[sqlx::test]
    async fn ships_genes(pool: Pool<Sqlite>) {
        let state = InnerDbState {
            conn_pool: pool.clone(),
        };
        state.seed_defaults().await.unwrap();
        let genes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM genes")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(genes > 40_000, "expected the full gene table, got {genes}");
    }

    fn temp_db_path(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("worm-seed-test-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("worm.sqlite")
    }

    #[test]
    fn first_run_is_a_missing_database_file() {
        let path = temp_db_path("first-run");
        assert!(is_first_run(&path));
        std::fs::write(&path, b"").unwrap();
        assert!(!is_first_run(&path));
        remove_database_files(&path);
        assert!(is_first_run(&path));
    }

    #[test]
    fn remove_database_files_deletes_wal_and_shm_too() {
        let path = temp_db_path("cleanup");
        let wal = path.with_file_name("worm.sqlite-wal");
        let shm = path.with_file_name("worm.sqlite-shm");
        for file in [&path, &wal, &shm] {
            std::fs::write(file, b"x").unwrap();
        }
        remove_database_files(&path);
        assert!(!path.exists() && !wal.exists() && !shm.exists());
        // Removing again (nothing there) must not panic.
        remove_database_files(&path);
    }
}
