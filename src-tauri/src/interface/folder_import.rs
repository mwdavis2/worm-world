//! Imports a set of table files in one transaction.
//!
//! The set is a zip archive of files named after the tables (`genes.csv`,
//! `variations.csv`, ...), which `import_archive` unpacks into a temporary
//! folder and hands to `import_folder`. The tables are imported in dependency
//! order, so a table never refers to a row that has not been added yet, and the
//! whole import is rolled back if any table fails.
//!
//! A design bundle (`<design>.ww.zip`, see `design_bundle`) is the same archive
//! plus a `design.ww.json`; importing it adds the design in the same
//! transaction as the tables.
use super::{bulk::Bulk, DbError, InnerDbState};
use crate::models::cross_design::CrossDesign;
use crate::models::{
    allele::Allele, allele_expr::AlleleExpressionDb, condition::ConditionDb,
    expr_relation::ExpressionRelationDb, gene::GeneDb, phenotype::PhenotypeDb, strain::Strain,
    strain_allele::StrainAllele, variation::VariationDb,
};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tempfile::TempDir;
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

/// The most entries and uncompressed bytes an archive may hold; a table set is
/// a handful of small text files, so anything bigger is not one.
/// The entry that holds the design inside a design bundle.
pub const DESIGN_ENTRY: &str = "design.ww.json";
const MAX_ENTRIES: usize = 64;
const MAX_UNCOMPRESSED_BYTES: u64 = 256 * 1024 * 1024;

/// `<table>.csv` or `<table>.tsv` (any case of the extension) for a table in
/// `IMPORT_ORDER`, else `None`.
fn table_file_name(file_name: &str) -> Option<String> {
    let path = Path::new(file_name);
    let stem = path.file_stem()?.to_str()?;
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    (IMPORT_ORDER.contains(&stem) && (extension == "csv" || extension == "tsv"))
        .then(|| format!("{stem}.{extension}"))
}

fn archive_error(zip_path: &Path, message: impl std::fmt::Display) -> DbError {
    DbError::BulkInsert(format!("{zip_path:?}: {message}"))
}

/// Unpacks the table files of a zip archive into a new temporary folder (removed
/// when the returned `TempDir` is dropped).
///
/// Only files named after a table are extracted: at the top of the archive or
/// inside a single top-level folder (what Finder's "Compress" produces); other
/// entries (a `__MACOSX` folder, notes, ...) are ignored. An entry whose path
/// escapes the archive (`..`, an absolute path) is an error, as is an archive
/// that is not a zip, is too large or repeats a table. The flag says whether any
/// table file was found.
fn extract_tables(zip_path: &Path) -> Result<(TempDir, bool), DbError> {
    let file = File::open(zip_path).map_err(|e| archive_error(zip_path, e))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| archive_error(zip_path, format!("not a readable zip file ({e})")))?;
    if archive.len() > MAX_ENTRIES {
        return Err(archive_error(
            zip_path,
            format!("too many entries ({} > {MAX_ENTRIES})", archive.len()),
        ));
    }
    let dir = tempfile::tempdir().map_err(|e| archive_error(zip_path, e))?;
    let mut total = 0u64;
    let mut extracted: Vec<String> = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| archive_error(zip_path, e))?;
        let Some(relative) = entry.enclosed_name().map(Path::to_path_buf) else {
            return Err(archive_error(
                zip_path,
                format!("unsafe path in the archive: {:?}", entry.name()),
            ));
        };
        if entry.is_dir() || relative.components().count() > 2 {
            continue;
        }
        let Some(name) = relative
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(table_file_name)
        else {
            continue;
        };
        total += entry.size();
        if total > MAX_UNCOMPRESSED_BYTES {
            return Err(archive_error(zip_path, "the archive is too large"));
        }
        if extracted.contains(&name) {
            return Err(archive_error(
                zip_path,
                format!("{name} appears more than once"),
            ));
        }
        let mut bytes = Vec::new();
        entry
            .by_ref()
            .take(MAX_UNCOMPRESSED_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| archive_error(zip_path, e))?;
        File::create(dir.path().join(&name))
            .and_then(|mut out| out.write_all(&bytes))
            .map_err(|e| archive_error(zip_path, e))?;
        extracted.push(name);
    }
    Ok((dir, !extracted.is_empty()))
}

impl InnerDbState {
    /// Imports the table files of a zip archive: unpacks them to a temporary
    /// folder and imports that in one transaction (see `import_folder`). If a
    /// `design` is given it is added in the same transaction, so a failure
    /// anywhere (a bad table, a design that already exists) imports nothing.
    pub async fn import_archive(
        &self,
        zip_path: &Path,
        design: Option<&CrossDesign>,
    ) -> Result<Vec<TableImport>, DbError> {
        let (dir, found_tables) = extract_tables(zip_path)?;
        if !found_tables && design.is_none() {
            return Err(archive_error(
                zip_path,
                "no table files found (expected names like genes.csv or alleles.csv)",
            ));
        }
        let mut tx = self
            .conn_pool
            .begin()
            .await
            .map_err(|e| DbError::BulkInsert(e.to_string()))?;
        let report = Self::import_dir_on(&mut tx, dir.path()).await?;
        if let Some(design) = design {
            Self::insert_cross_design_on(&mut tx, design).await?;
        }
        tx.commit()
            .await
            .map_err(|e| DbError::BulkInsert(e.to_string()))?;
        Ok(report)
    }

    /// The `design.ww.json` of a design bundle, or `None` for a plain data
    /// tables zip.
    pub fn read_bundle_design(zip_path: &Path) -> Result<Option<String>, DbError> {
        let file = File::open(zip_path).map_err(|e| archive_error(zip_path, e))?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| archive_error(zip_path, format!("not a readable zip file ({e})")))?;
        let mut entry = match archive.by_name(DESIGN_ENTRY) {
            Ok(entry) => entry,
            Err(zip::result::ZipError::FileNotFound) => return Ok(None),
            Err(e) => return Err(archive_error(zip_path, e)),
        };
        if entry.size() > MAX_UNCOMPRESSED_BYTES {
            return Err(archive_error(zip_path, "the design is too large"));
        }
        let mut json = String::new();
        entry
            .read_to_string(&mut json)
            .map_err(|e| archive_error(zip_path, e))?;
        Ok(Some(json))
    }

    /// Imports each table file found in `dir`, in dependency order, in a single
    /// transaction: if any file is unreadable, has an invalid row, or violates a
    /// reference, nothing is imported. Missing files are skipped.
    pub async fn import_folder(&self, dir: &Path) -> Result<Vec<TableImport>, DbError> {
        let mut tx = self
            .conn_pool
            .begin()
            .await
            .map_err(|e| DbError::BulkInsert(e.to_string()))?;
        let report = Self::import_dir_on(&mut tx, dir).await?;
        tx.commit()
            .await
            .map_err(|e| DbError::BulkInsert(e.to_string()))?;
        Ok(report)
    }

    /// The tables of `dir` on an open transaction (the caller commits).
    async fn import_dir_on(
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        dir: &Path,
    ) -> Result<Vec<TableImport>, DbError> {
        if !dir.is_dir() {
            return Err(DbError::BulkInsert(format!("{dir:?} is not a folder")));
        }
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

    // ---- zip archives -------------------------------------------------------

    /// Writes a zip with the given (entry name, contents) pairs into `folder`.
    fn make_zip(folder: &Folder, name: &str, entries: &[(&str, &str)]) -> PathBuf {
        let path = folder.0.join(name);
        let mut writer = zip::ZipWriter::new(fs::File::create(&path).unwrap());
        for (entry, contents) in entries {
            writer
                .start_file(*entry, zip::write::FileOptions::default())
                .unwrap();
            writer.write_all(contents.as_bytes()).unwrap();
        }
        writer.finish().unwrap();
        path
    }

    #[sqlx::test]
    async fn a_zip_of_table_files_imports_like_a_folder(pool: Pool<Sqlite>) {
        let state = state(&pool).await;
        let folder = Folder::new("zip-flat", &[]);
        let zip = make_zip(&folder, "tables.zip", &all_files());

        let report = state.import_archive(&zip, None).await.unwrap();
        assert_eq!(report.len(), 7);
        assert!(report.iter().all(|r| r.read == r.inserted && r.read > 0));
        assert_eq!(count(&pool, "strain_alleles").await, 1);
    }

    #[sqlx::test]
    async fn a_zip_with_one_top_level_folder_imports(pool: Pool<Sqlite>) {
        let state = state(&pool).await;
        let folder = Folder::new("zip-nested", &[]);
        let nested: Vec<(String, &str)> = all_files()
            .into_iter()
            .map(|(file, contents)| (format!("tables/{file}"), contents))
            .collect();
        let entries: Vec<(&str, &str)> = nested.iter().map(|(f, c)| (f.as_str(), *c)).collect();
        let zip = make_zip(&folder, "tables.zip", &entries);

        let report = state.import_archive(&zip, None).await.unwrap();
        assert_eq!(report.len(), 7);
    }

    #[sqlx::test]
    async fn importing_a_zip_again_adds_nothing(pool: Pool<Sqlite>) {
        let state = state(&pool).await;
        let folder = Folder::new("zip-again", &[]);
        let zip = make_zip(&folder, "tables.zip", &all_files());
        state.import_archive(&zip, None).await.unwrap();
        let relations = count(&pool, "expr_relations").await;

        let second = state.import_archive(&zip, None).await.unwrap();
        assert!(second.iter().all(|r| r.read > 0 && r.inserted == 0));
        assert_eq!(count(&pool, "expr_relations").await, relations);
    }

    #[sqlx::test]
    async fn other_entries_in_a_zip_are_ignored(pool: Pool<Sqlite>) {
        let state = state(&pool).await;
        let folder = Folder::new("zip-extras", &[]);
        let mut entries = vec![
            ("variations.csv", VARIATIONS),
            ("notes.txt", "not a table"),
            ("__MACOSX/._variations.csv", "resource fork junk"),
            ("deep/er/than/one/variations.csv", "alleleName\nbogus\n"),
        ];
        entries.push(("strains.txt", "wrong extension"));
        let zip = make_zip(&folder, "tables.zip", &entries);

        let report = state.import_archive(&zip, None).await.unwrap();
        assert_eq!(report.len(), 1);
        assert_eq!(report[0].table, "variations");
        assert_eq!(count(&pool, "variations").await, 1);
    }

    #[sqlx::test]
    async fn a_zip_entry_that_escapes_the_archive_is_rejected(pool: Pool<Sqlite>) {
        let state = state(&pool).await;
        let folder = Folder::new("zip-escape", &[]);
        let zip = make_zip(
            &folder,
            "tables.zip",
            &[("variations.csv", VARIATIONS), ("../variations.csv", VARIATIONS)],
        );

        let error = state.import_archive(&zip, None).await.unwrap_err().to_string();
        assert!(error.contains("unsafe path"), "{error}");
        assert_eq!(count(&pool, "variations").await, 0);
        assert!(!folder.0.parent().unwrap().join("variations.csv").exists());
    }

    #[sqlx::test]
    async fn a_zip_without_table_files_is_an_error(pool: Pool<Sqlite>) {
        let state = state(&pool).await;
        let folder = Folder::new("zip-empty", &[]);
        let zip = make_zip(&folder, "tables.zip", &[("readme.txt", "hello")]);

        let error = state.import_archive(&zip, None).await.unwrap_err().to_string();
        assert!(error.contains("no table files"), "{error}");
    }

    #[sqlx::test]
    async fn a_table_repeated_in_a_zip_is_an_error(pool: Pool<Sqlite>) {
        let state = state(&pool).await;
        let folder = Folder::new("zip-twice", &[]);
        let zip = make_zip(
            &folder,
            "tables.zip",
            &[("variations.csv", VARIATIONS), ("tables/variations.csv", VARIATIONS)],
        );

        let error = state.import_archive(&zip, None).await.unwrap_err().to_string();
        assert!(error.contains("more than once"), "{error}");
    }

    #[sqlx::test]
    async fn a_file_that_is_not_a_zip_is_an_error(pool: Pool<Sqlite>) {
        let state = state(&pool).await;
        let folder = Folder::new("zip-not", &[("fake.zip", "this is plain text")]);
        let error = state
            .import_archive(&folder.0.join("fake.zip"), None)
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("not a readable zip"), "{error}");
        assert!(state.import_archive(&folder.0.join("missing.zip"), None).await.is_err());
    }

    #[sqlx::test]
    async fn a_bad_table_in_a_zip_rolls_back_every_table(pool: Pool<Sqlite>) {
        let state = state(&pool).await;
        let folder = Folder::new("zip-rollback", &[]);
        let bad_alleles = "name,contents,sysGeneName,variationName\nfiX1,,NO.SUCH.GENE,\n";
        let mut entries = all_files();
        entries.retain(|(file, _)| *file != "alleles.csv");
        entries.push(("alleles.csv", bad_alleles));
        let zip = make_zip(&folder, "tables.zip", &entries);

        assert!(state.import_archive(&zip, None).await.is_err());
        assert_eq!(count(&pool, "variations").await, 0);
        assert_eq!(count(&pool, "phenotypes").await, 0);
    }

    #[sqlx::test]
    async fn too_many_entries_in_a_zip_is_an_error(pool: Pool<Sqlite>) {
        let state = state(&pool).await;
        let folder = Folder::new("zip-many", &[]);
        let names: Vec<String> = (0..=MAX_ENTRIES).map(|i| format!("note{i}.txt")).collect();
        let entries: Vec<(&str, &str)> = names.iter().map(|n| (n.as_str(), "x")).collect();
        let zip = make_zip(&folder, "tables.zip", &entries);

        let error = state.import_archive(&zip, None).await.unwrap_err().to_string();
        assert!(error.contains("too many entries"), "{error}");
    }

    // The real mIn1 files, zipped the way a user would send them.
    #[sqlx::test]
    async fn a_zip_of_the_real_min1_folder_imports(pool: Pool<Sqlite>) {
        let state = state(&pool).await;
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/mIn1");
        let contents: Vec<(String, String)> = fs::read_dir(&source)
            .unwrap()
            .map(|entry| {
                let path = entry.unwrap().path();
                (
                    format!("mIn1/{}", path.file_name().unwrap().to_str().unwrap()),
                    fs::read_to_string(&path).unwrap(),
                )
            })
            .collect();
        let entries: Vec<(&str, &str)> =
            contents.iter().map(|(f, c)| (f.as_str(), c.as_str())).collect();
        let folder = Folder::new("zip-min1", &[]);
        let zip = make_zip(&folder, "mIn1.zip", &entries);

        let report = state.import_archive(&zip, None).await.unwrap();
        assert_eq!(report.len(), 7);
        assert!(report.iter().all(|r| r.read == r.inserted && r.read > 0));
    }

    // The zip the generator committed (data/mIn1.zip) must load as-is.
    #[sqlx::test]
    async fn the_committed_min1_zip_imports(pool: Pool<Sqlite>) {
        let state = state(&pool).await;
        let zip = Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/mIn1.zip");

        let report = state.import_archive(&zip, None).await.unwrap();
        assert_eq!(report.len(), 7);
        assert!(report.iter().all(|r| r.read == r.inserted && r.read > 0));
        let genotype: String = sqlx::query_scalar(
            "SELECT genotype FROM strains WHERE name = 'mIn1[dpy-10(e128) mIs14]'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(genotype, "dpy-10(e128) mIn1 mIs14 II.");
    }
}
