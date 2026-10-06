//! Imports every table found in a folder in one transaction.
//!
//! A folder holds files named after the tables (`genes.csv`, `variations.csv`,
//! ...). The tables are imported in dependency order, so a table never refers
//! to a row that has not been added yet, and the whole import is rolled back if
//! any table fails.
use super::{bulk::Bulk, DbError, InnerDbState};
use crate::models::{
    allele::Allele, allele_expr::AlleleExpressionDb, condition::ConditionDb,
    expr_relation::ExpressionRelationDb, gene::GeneDb, phenotype::PhenotypeDb, strain::Strain,
    strain_allele::StrainAllele, variation::VariationDb,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use ts_rs::TS;

/// The tables in the order they must be imported.
pub const IMPORT_ORDER: [&str; 9] = [
    "genes",
    "conditions",
    "variations",
    "phenotypes",
    "alleles",
    "allele_exprs",
    "expr_relations",
    "strains",
    "strain_alleles",
];

/// What happened to one table's file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/models/db/db_TableImport.ts")]
#[serde(rename = "db_TableImport")]
pub struct TableImport {
    pub table: String,
    /// Rows read from the file.
    pub read: u32,
    /// Rows actually added (the rest already existed).
    pub inserted: u32,
}

/// The file for `table` in `dir`: `<table>.csv`, or `<table>.tsv`.
fn file_for(dir: &Path, table: &str) -> Option<PathBuf> {
    ["csv", "tsv"]
        .iter()
        .map(|ext| dir.join(format!("{table}.{ext}")))
        .find(|path| path.is_file())
}

fn read<T: serde::de::DeserializeOwned>(path: &Path, table: &str) -> Result<Bulk<T>, DbError> {
    Bulk::<T>::new(path)
        .map_err(|e| DbError::BulkInsert(format!("{table}: unable to read {path:?}: {e}")))
}

impl InnerDbState {
    /// Imports each table file found in `dir`, in dependency order, in a single
    /// transaction: if any file is unreadable, has an invalid row, or violates a
    /// reference, nothing is imported. Missing files are skipped.
    pub async fn import_folder(&self, dir: &Path) -> Result<Vec<TableImport>, DbError> {
        if !dir.is_dir() {
            return Err(DbError::BulkInsert(format!("{dir:?} is not a folder")));
        }
        let mut tx = self
            .conn_pool
            .begin()
            .await
            .map_err(|e| DbError::BulkInsert(e.to_string()))?;
        let mut report = Vec::new();
        for table in IMPORT_ORDER {
            let Some(path) = file_for(dir, table) else {
                continue;
            };
            let conn = &mut *tx;
            macro_rules! import {
                ($ty:ty, $insert:path) => {{
                    let bulk = read::<$ty>(&path, table)?;
                    let rows = bulk.data.len() as u32;
                    let inserted = $insert(conn, bulk)
                        .await
                        .map_err(|e| DbError::BulkInsert(format!("{table}: {e}")))?;
                    (rows, inserted)
                }};
            }
            let (rows, inserted) = match table {
                "genes" => import!(GeneDb, Self::insert_genes_on),
                "conditions" => import!(ConditionDb, Self::insert_conditions_on),
                "variations" => import!(VariationDb, Self::insert_variations_on),
                "phenotypes" => import!(PhenotypeDb, Self::insert_phenotypes_on),
                "alleles" => import!(Allele, Self::insert_alleles_on),
                "allele_exprs" => import!(AlleleExpressionDb, Self::insert_allele_exprs_on),
                "expr_relations" => import!(ExpressionRelationDb, Self::insert_expr_relations_on),
                "strains" => import!(Strain, Self::insert_strains_on),
                "strain_alleles" => import!(StrainAllele, Self::insert_strain_alleles_on),
                _ => unreachable!("every table in IMPORT_ORDER is handled"),
            };
            report.push(TableImport {
                table: table.to_owned(),
                read: rows,
                inserted: inserted as u32,
            });
        }
        tx.commit()
            .await
            .map_err(|e| DbError::BulkInsert(e.to_string()))?;
        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Sqlite};
    use std::fs;

    /// A scratch folder with the given files, removed when dropped.
    struct Folder(PathBuf);
    impl Folder {
        fn new(name: &str, files: &[(&str, &str)]) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "worm-world-folder-import-{}-{name}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            for (file, contents) in files {
                fs::write(dir.join(file), contents).unwrap();
            }
            Self(dir)
        }
    }
    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const VARIATIONS: &str = "alleleName,chromosome,physLoc,geneticLoc,recombSuppressorStart,recombSuppressorEnd,isLocationReference,percentLoss\nfiX1,X,1000,1.5,,,false,\n";
    const PHENOTYPES: &str = "name,wild,short_name,description,male_mating,lethal,female_sterile,arrested,maturation_days\nFiPheno,0,FiPheno,,,0,,,\nFiPheno,1,FiPheno,,,,,,\n";
    const ALLELES: &str = "name,contents,sysGeneName,variationName\nfiX1,,,fiX1\n";
    const ALLELE_EXPRS: &str = "alleleName,expressingPhenotypeName,expressingPhenotypeWild,dominance\nfiX1,FiPheno,0,4\n";
    const EXPR_RELATIONS: &str = "allele_name,expressing_phenotype_name,expressing_phenotype_wild,altering_phenotype_name,altering_phenotype_wild,altering_condition,is_suppressing\nfiX1,FiPheno,0,FiPheno,1,,1\nfiX1,FiPheno,0,,,25C,0\n";
    const STRAINS: &str = "name,genotype,description\nFI1,fiX1 X.,test\n";
    const STRAIN_ALLELES: &str = "strainName,alleleName,isOnTop,isOnBot\nFI1,fiX1,true,true\n";

    async fn count(pool: &Pool<Sqlite>, table: &str) -> i64 {
        sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn state(pool: &Pool<Sqlite>) -> InnerDbState {
        let state = InnerDbState {
            conn_pool: pool.clone(),
        };
        state.seed_reference_data().await.unwrap();
        state
    }

    fn all_files() -> Vec<(&'static str, &'static str)> {
        // deliberately not in dependency order
        vec![
            ("strain_alleles.csv", STRAIN_ALLELES),
            ("strains.csv", STRAINS),
            ("expr_relations.csv", EXPR_RELATIONS),
            ("allele_exprs.csv", ALLELE_EXPRS),
            ("alleles.csv", ALLELES),
            ("phenotypes.csv", PHENOTYPES),
            ("variations.csv", VARIATIONS),
        ]
    }

    #[sqlx::test]
    async fn imports_every_table_in_dependency_order(pool: Pool<Sqlite>) {
        let state = state(&pool).await;
        let folder = Folder::new("all", &all_files());
        let report = state.import_folder(&folder.0).await.unwrap();

        let tables: Vec<_> = report.iter().map(|r| r.table.as_str()).collect();
        assert_eq!(
            tables,
            [
                "variations",
                "phenotypes",
                "alleles",
                "allele_exprs",
                "expr_relations",
                "strains",
                "strain_alleles"
            ]
        );
        assert_eq!(report.iter().map(|r| r.read).collect::<Vec<_>>(), [1, 2, 1, 1, 2, 1, 1]);
        assert!(report.iter().all(|r| r.read == r.inserted));
        assert_eq!(count(&pool, "strain_alleles").await, 1);
    }

    #[sqlx::test]
    async fn importing_again_adds_nothing(pool: Pool<Sqlite>) {
        let state = state(&pool).await;
        let folder = Folder::new("again", &all_files());
        state.import_folder(&folder.0).await.unwrap();
        let relations = count(&pool, "expr_relations").await;
        let second = state.import_folder(&folder.0).await.unwrap();

        assert!(second.iter().all(|r| r.read > 0 && r.inserted == 0));
        assert_eq!(count(&pool, "expr_relations").await, relations);
    }

    #[sqlx::test]
    async fn a_failure_rolls_back_every_table(pool: Pool<Sqlite>) {
        let state = state(&pool).await;
        // alleles.csv points at a gene that does not exist
        let bad_alleles =
            "name,contents,sysGeneName,variationName\nfiX1,,NO.SUCH.GENE,\n";
        let mut files = all_files();
        files.retain(|(file, _)| *file != "alleles.csv");
        files.push(("alleles.csv", bad_alleles));
        let folder = Folder::new("rollback", &files);

        assert!(state.import_folder(&folder.0).await.is_err());
        // variations and phenotypes were read and inserted before alleles failed
        assert_eq!(count(&pool, "variations").await, 0);
        assert_eq!(count(&pool, "phenotypes").await, 0);
    }

    #[sqlx::test]
    async fn an_invalid_row_fails_the_whole_import(pool: Pool<Sqlite>) {
        let state = state(&pool).await;
        let mut files = all_files();
        files.retain(|(file, _)| *file != "strains.csv");
        // a strain row with a missing column
        files.push(("strains.csv", "name,genotype,description\nFI1\n"));
        let folder = Folder::new("invalid", &files);

        assert!(state.import_folder(&folder.0).await.is_err());
        assert_eq!(count(&pool, "variations").await, 0);
    }

    #[sqlx::test]
    async fn missing_files_are_skipped(pool: Pool<Sqlite>) {
        let state = state(&pool).await;
        let folder = Folder::new("few", &[("variations.csv", VARIATIONS), ("notes.txt", "hi")]);
        let report = state.import_folder(&folder.0).await.unwrap();
        assert_eq!(report.len(), 1);
        assert_eq!(report[0].table, "variations");
    }

    #[sqlx::test]
    async fn a_path_that_is_not_a_folder_is_an_error(pool: Pool<Sqlite>) {
        let state = state(&pool).await;
        let folder = Folder::new("file", &[("variations.csv", VARIATIONS)]);
        assert!(state
            .import_folder(&folder.0.join("variations.csv"))
            .await
            .is_err());
    }

    // The real mIn1 folder (data/mIn1) imports on top of the shipped genes.
    #[sqlx::test]
    async fn the_min1_folder_imports_on_the_shipped_genes(pool: Pool<Sqlite>) {
        let state = state(&pool).await;
        let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/mIn1");
        let report = state.import_folder(&folder).await.unwrap();

        assert_eq!(report.len(), 7);
        assert!(report.iter().all(|r| r.read == r.inserted && r.read > 0));
        let genotype: String =
            sqlx::query_scalar("SELECT genotype FROM strains WHERE name = 'mIn1[dpy-10(e128) mIs14]'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(genotype, "dpy-10(e128) mIn1 mIs14 II.");
        let again = state.import_folder(&folder).await.unwrap();
        assert!(again.iter().all(|r| r.inserted == 0));
    }
}
