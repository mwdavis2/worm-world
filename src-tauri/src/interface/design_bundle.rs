//! A cross design bundled with the data it needs, so a teammate with a different
//! database can import both.
//!
//! The design's JSON carries its own copies of its strains' alleles, but the
//! data tables (alleles, genes, phenotypes, strains, ...) are not in it. A bundle
//! is a zip archive of `design.ww.json` plus the table files (named as the
//! importers expect, see `folder_import`) holding exactly the rows the design
//! refers to; importing it loads the tables and the design in one transaction.
use super::{folder_import::DESIGN_ENTRY, DbError, InnerDbState};
use crate::models::{
    allele::Allele, allele_expr::AlleleExpressionDb, condition::ConditionDb,
    expr_relation::ExpressionRelationDb, gene::GeneDb, phenotype::PhenotypeDb, strain::Strain,
    strain_allele::StrainAllele, variation::VariationDb,
};
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqliteRow, FromRow, QueryBuilder, Sqlite};
use std::{
    collections::HashSet,
    fs::File,
    io::Write,
    path::Path,
};
use ts_rs::TS;

/// The rows of each table that a design needs.
#[derive(Debug, Default)]
pub struct DesignTables {
    pub genes: Vec<GeneDb>,
    pub conditions: Vec<ConditionDb>,
    pub variations: Vec<VariationDb>,
    pub phenotypes: Vec<PhenotypeDb>,
    pub alleles: Vec<Allele>,
    pub allele_exprs: Vec<AlleleExpressionDb>,
    pub expr_relations: Vec<ExpressionRelationDb>,
    pub strains: Vec<Strain>,
    pub strain_alleles: Vec<StrainAllele>,
}

/// How many rows of one table went into a bundle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/models/db/db_BundleTable.ts")]
#[serde(rename = "db_BundleTable")]
pub struct BundleTable {
    pub table: String,
    pub rows: u32,
}

/// What an export wrote.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/models/db/db_DesignBundleSummary.ts")]
#[serde(rename = "db_DesignBundleSummary")]
pub struct DesignBundleSummary {
    /// The tables written (empty tables are left out).
    pub tables: Vec<BundleTable>,
    /// Alleles the design uses that are not in the data tables, so their rows
    /// could not be bundled (the design still carries its own copies of them).
    #[serde(rename = "missingAlleles")]
    pub missing_alleles: Vec<String>,
}

fn query_error(e: impl std::fmt::Display) -> DbError {
    DbError::Query(e.to_string())
}

fn csv_bytes<T: Serialize>(rows: &[T]) -> Result<Vec<u8>, DbError> {
    let mut writer = csv::Writer::from_writer(Vec::new());
    for row in rows {
        writer.serialize(row).map_err(query_error)?;
    }
    writer.into_inner().map_err(query_error)
}

impl DesignTables {
    /// (table name, rows as CSV bytes, row count) for every non-empty table, in
    /// the order the importer needs.
    fn files(&self) -> Result<Vec<(&'static str, Vec<u8>, usize)>, DbError> {
        let mut files = Vec::new();
        macro_rules! file {
            ($name:literal, $rows:expr) => {
                if !$rows.is_empty() {
                    files.push(($name, csv_bytes(&$rows)?, $rows.len()));
                }
            };
        }
        file!("genes", self.genes);
        file!("conditions", self.conditions);
        file!("variations", self.variations);
        file!("phenotypes", self.phenotypes);
        file!("alleles", self.alleles);
        file!("allele_exprs", self.allele_exprs);
        file!("expr_relations", self.expr_relations);
        file!("strains", self.strains);
        file!("strain_alleles", self.strain_alleles);
        Ok(files)
    }
}

impl InnerDbState {
    /// The rows of `table` whose `column` is one of `names`, in insertion order.
    async fn select_where_in<T>(
        &self,
        select: &str,
        column: &str,
        names: &[String],
    ) -> Result<Vec<T>, DbError>
    where
        T: for<'r> FromRow<'r, SqliteRow> + Send + Unpin,
    {
        if names.is_empty() {
            return Ok(Vec::new());
        }
        let mut builder: QueryBuilder<Sqlite> =
            QueryBuilder::new(format!("{select} WHERE {column} IN ("));
        let mut separated = builder.separated(", ");
        for name in names {
            separated.push_bind(name.clone());
        }
        separated.push_unseparated(") ORDER BY rowid");
        builder
            .build_query_as::<T>()
            .fetch_all(&self.conn_pool)
            .await
            .map_err(query_error)
    }

    /// The data rows a design needs, found by following references from the
    /// alleles and strains it uses:
    /// - strains: those of `strain_names` that exist, with their strain alleles;
    /// - alleles: `allele_names` plus every allele those strains hold;
    /// - their genes and variations, expressions and relations;
    /// - the phenotypes those expressions and relations name, and the conditions
    ///   the relations name.
    ///
    /// Also returns the requested allele names that are not in the database.
    pub async fn collect_design_tables(
        &self,
        allele_names: &[String],
        strain_names: &[String],
    ) -> Result<(DesignTables, Vec<String>), DbError> {
        let strains: Vec<Strain> = self
            .select_where_in(
                "SELECT name, genotype, description FROM strains",
                "name",
                strain_names,
            )
            .await?;
        let found_strains: Vec<String> = strains.iter().map(|s| s.name.clone()).collect();
        let strain_alleles: Vec<StrainAllele> = self
            .select_where_in(
                "SELECT strain_name, allele_name, is_on_top, is_on_bot FROM strain_alleles",
                "strain_name",
                &found_strains,
            )
            .await?;

        let mut wanted: Vec<String> = allele_names.to_vec();
        wanted.extend(strain_alleles.iter().map(|sa| sa.allele_name.clone()));
        wanted.sort();
        wanted.dedup();

        let alleles: Vec<Allele> = self
            .select_where_in(
                "SELECT name, contents, systematic_gene_name, variation_name FROM alleles",
                "name",
                &wanted,
            )
            .await?;
        let found_alleles: Vec<String> = alleles.iter().map(|a| a.name.clone()).collect();
        let missing: Vec<String> = allele_names
            .iter()
            .filter(|name| !found_alleles.contains(name))
            .cloned()
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let mut missing = missing;
        missing.sort();

        let gene_keys: Vec<String> = alleles
            .iter()
            .filter_map(|a| a.systematic_gene_name.clone())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let variation_keys: Vec<String> = alleles
            .iter()
            .filter_map(|a| a.variation_name.clone())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let genes: Vec<GeneDb> = self
            .select_where_in(
                "SELECT systematic_name, descriptive_name, chromosome, phys_loc, gen_loc FROM genes",
                "systematic_name",
                &gene_keys,
            )
            .await?;
        let variations: Vec<VariationDb> = self
            .select_where_in(
                "SELECT allele_name, chromosome, phys_loc, gen_loc, recomb_suppressor_start, recomb_suppressor_end, is_location_reference, percent_loss FROM variations",
                "allele_name",
                &variation_keys,
            )
            .await?;
        let allele_exprs: Vec<AlleleExpressionDb> = self
            .select_where_in(
                "SELECT allele_name, expressing_phenotype_name, expressing_phenotype_wild, dominance FROM allele_exprs",
                "allele_name",
                &found_alleles,
            )
            .await?;
        let expr_relations: Vec<ExpressionRelationDb> = self
            .select_where_in(
                "SELECT allele_name, expressing_phenotype_name, expressing_phenotype_wild, altering_phenotype_name, altering_phenotype_wild, altering_condition, is_suppressing FROM expr_relations",
                "allele_name",
                &found_alleles,
            )
            .await?;

        // Phenotypes and conditions are small tables: read them whole and keep
        // the rows that are referenced.
        let mut phenotype_keys: HashSet<(String, i64)> = HashSet::new();
        for expr in &allele_exprs {
            phenotype_keys.insert((
                expr.expressing_phenotype_name.clone(),
                expr.expressing_phenotype_wild,
            ));
        }
        for relation in &expr_relations {
            phenotype_keys.insert((
                relation.expressing_phenotype_name.clone(),
                relation.expressing_phenotype_wild,
            ));
            if let (Some(name), Some(wild)) = (
                &relation.altering_phenotype_name,
                relation.altering_phenotype_wild,
            ) {
                phenotype_keys.insert((name.clone(), wild));
            }
        }
        let condition_keys: HashSet<String> = expr_relations
            .iter()
            .filter_map(|r| r.altering_condition.clone())
            .collect();
        let phenotypes: Vec<PhenotypeDb> = sqlx::query_as(
            "SELECT name, wild, short_name, description, male_mating, lethal, female_sterile, arrested, maturation_days FROM phenotypes ORDER BY rowid",
        )
        .fetch_all(&self.conn_pool)
        .await
        .map_err(query_error)?;
        let conditions: Vec<ConditionDb> = sqlx::query_as(
            "SELECT name, description, male_mating, lethal, female_sterile, arrested, maturation_days FROM conditions ORDER BY rowid",
        )
        .fetch_all(&self.conn_pool)
        .await
        .map_err(query_error)?;

        Ok((
            DesignTables {
                genes,
                conditions: conditions
                    .into_iter()
                    .filter(|c| condition_keys.contains(&c.name))
                    .collect(),
                variations,
                phenotypes: phenotypes
                    .into_iter()
                    .filter(|p| phenotype_keys.contains(&(p.name.clone(), p.wild)))
                    .collect(),
                alleles,
                allele_exprs,
                expr_relations,
                strains,
                strain_alleles,
            },
            missing,
        ))
    }

    /// Writes a design bundle: a zip with `design.ww.json` and the table files
    /// for the rows the design needs (see `collect_design_tables`).
    pub async fn export_design_bundle(
        &self,
        zip_path: &Path,
        design_json: &str,
        allele_names: &[String],
        strain_names: &[String],
    ) -> Result<DesignBundleSummary, DbError> {
        let (tables, missing_alleles) = self
            .collect_design_tables(allele_names, strain_names)
            .await?;
        let files = tables.files()?;

        let write_error = |e: &dyn std::fmt::Display| {
            DbError::Query(format!("Unable to write {zip_path:?}: {e}"))
        };
        let file = File::create(zip_path).map_err(|e| write_error(&e))?;
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::FileOptions::default();
        writer
            .start_file(DESIGN_ENTRY, options)
            .map_err(|e| write_error(&e))?;
        writer
            .write_all(design_json.as_bytes())
            .map_err(|e| write_error(&e))?;
        let mut summary = Vec::new();
        for (name, bytes, rows) in files {
            writer
                .start_file(format!("{name}.csv"), options)
                .map_err(|e| write_error(&e))?;
            writer.write_all(&bytes).map_err(|e| write_error(&e))?;
            summary.push(BundleTable {
                table: name.to_owned(),
                rows: rows as u32,
            });
        }
        writer.finish().map_err(|e| write_error(&e))?;
        Ok(DesignBundleSummary {
            tables: summary,
            missing_alleles,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::cross_design::CrossDesign;
    use sqlx::{Pool, Sqlite};
    use std::path::PathBuf;

    async fn exec(pool: &Pool<Sqlite>, sql: &str) {
        sqlx::query(sql)
            .execute(pool)
            .await
            .unwrap_or_else(|e| panic!("{sql}: {e}"));
    }

    async fn count(pool: &Pool<Sqlite>, sql: &str) -> i64 {
        sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
    }

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_owned()).collect()
    }

    /// A small database: a design's alleles and strain, plus an unrelated
    /// allele, strain and phenotype that must not be bundled.
    async fn database(pool: &Pool<Sqlite>) -> InnerDbState {
        let state = InnerDbState {
            conn_pool: pool.clone(),
        };
        state.seed_reference_data().await.unwrap();
        for sql in [
            "INSERT INTO variations (allele_name, chromosome, phys_loc, gen_loc) VALUES ('dbV1', 'X', 1000, 1.5)",
            "INSERT INTO phenotypes (name, wild, short_name) VALUES ('DbP', 0, 'DbP'), ('DbP', 1, 'DbP'), ('DbQ', 0, 'DbQ'), ('DbOther', 0, 'DbOther')",
            "INSERT INTO alleles (name, systematic_gene_name) VALUES ('dbA1', 'T14B4.7')",
            "INSERT INTO alleles (name, variation_name) VALUES ('dbA2', 'dbV1'), ('dbOther', NULL)",
            "INSERT INTO alleles (name, contents, systematic_gene_name) VALUES ('dbA3', 'strain only', 'M142.1')",
            "INSERT INTO allele_exprs VALUES ('dbA1', 'DbP', 0, 4), ('dbA2', 'DbQ', 0, 2), ('dbA3', 'DbQ', 0, 2)",
            "INSERT INTO allele_exprs VALUES ('dbOther', 'DbOther', 0, 2)",
            "INSERT INTO expr_relations (allele_name, expressing_phenotype_name, expressing_phenotype_wild, altering_phenotype_name, altering_phenotype_wild, is_suppressing) VALUES ('dbA1', 'DbP', 0, 'DbP', 1, 1)",
            "INSERT INTO expr_relations (allele_name, expressing_phenotype_name, expressing_phenotype_wild, altering_condition, is_suppressing) VALUES ('dbA1', 'DbP', 0, '25C', 0)",
            "INSERT INTO strains (name, genotype, description) VALUES ('DB1', 'dbA1 dbA2 dbA3', 'the design strain'), ('DB2', 'dbOther', 'unrelated')",
            "INSERT INTO strain_alleles VALUES ('DB1', 'dbA1', 1, 1), ('DB1', 'dbA2', 1, 0), ('DB1', 'dbA3', 0, 1), ('DB2', 'dbOther', 1, 1)",
        ] {
            exec(pool, sql).await;
        }
        state
    }

    fn keys<T, K: Ord>(rows: &[T], key: impl Fn(&T) -> K) -> Vec<K> {
        let mut keys: Vec<K> = rows.iter().map(key).collect();
        keys.sort();
        keys
    }

    #[sqlx::test]
    async fn collects_exactly_the_rows_a_design_needs(pool: Pool<Sqlite>) {
        let state = database(&pool).await;
        let (tables, missing) = state
            .collect_design_tables(&names(&["dbA1", "dbA2", "noSuchAllele"]), &names(&["DB1"]))
            .await
            .unwrap();

        assert_eq!(missing, ["noSuchAllele"]);
        // alleles: the two asked for plus dbA3, which only the strain holds
        assert_eq!(
            keys(&tables.alleles, |a| a.name.clone()),
            ["dbA1", "dbA2", "dbA3"]
        );
        // their genes and the variation, and nothing else
        assert_eq!(
            keys(&tables.genes, |g| g.systematic_name.clone()),
            ["M142.1", "T14B4.7"]
        );
        assert_eq!(keys(&tables.variations, |v| v.allele_name.clone()), ["dbV1"]);
        // expressions and relations of those alleles only
        assert_eq!(
            keys(&tables.allele_exprs, |e| e.allele_name.clone()),
            ["dbA1", "dbA2", "dbA3"]
        );
        assert_eq!(tables.expr_relations.len(), 2);
        // phenotypes expressed or named in relations, not the unrelated one
        assert_eq!(
            keys(&tables.phenotypes, |p| (p.name.clone(), p.wild)),
            [("DbP".to_owned(), 0), ("DbP".to_owned(), 1), ("DbQ".to_owned(), 0)]
        );
        // only the condition a relation names
        assert_eq!(keys(&tables.conditions, |c| c.name.clone()), ["25C"]);
        // only the design's strain, with its strain alleles
        assert_eq!(keys(&tables.strains, |s| s.name.clone()), ["DB1"]);
        assert_eq!(tables.strain_alleles.len(), 3);
    }

    #[sqlx::test]
    async fn a_strain_alone_brings_its_alleles(pool: Pool<Sqlite>) {
        let state = database(&pool).await;
        let (tables, missing) = state
            .collect_design_tables(&[], &names(&["DB1", "not a saved strain"]))
            .await
            .unwrap();
        assert!(missing.is_empty());
        assert_eq!(
            keys(&tables.alleles, |a| a.name.clone()),
            ["dbA1", "dbA2", "dbA3"]
        );
        assert_eq!(keys(&tables.strains, |s| s.name.clone()), ["DB1"]);
    }

    #[sqlx::test]
    async fn an_empty_design_bundles_no_rows(pool: Pool<Sqlite>) {
        let state = database(&pool).await;
        let (tables, missing) = state.collect_design_tables(&[], &[]).await.unwrap();
        assert!(missing.is_empty());
        assert!(tables.files().unwrap().is_empty());
    }

    /// A scratch folder removed when dropped.
    struct Scratch(PathBuf);
    impl Scratch {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "worm-world-bundle-{}-{name}",
                std::process::id()
            ));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn design(id: &str) -> CrossDesign {
        CrossDesign {
            id: id.to_owned(),
            name: "Bundled design".to_owned(),
            last_edited: "now".to_owned(),
            data: "{\"nodes\":[]}".to_owned(),
            editable: true,
        }
    }

    /// Empties every table the bundle fills, so the next database state is one a
    /// teammate with none of the design's data would have.
    async fn forget_the_design_data(pool: &Pool<Sqlite>) {
        for sql in [
            "DELETE FROM strain_alleles",
            "DELETE FROM strains",
            "DELETE FROM expr_relations",
            "DELETE FROM allele_exprs",
            "DELETE FROM alleles",
            "DELETE FROM variations",
            "DELETE FROM phenotypes",
        ] {
            exec(pool, sql).await;
        }
    }

    #[sqlx::test]
    async fn a_bundle_round_trips_into_a_database_without_the_data(pool: Pool<Sqlite>) {
        let state = database(&pool).await;
        let scratch = Scratch::new("round-trip");
        let zip = scratch.0.join("design.ww.zip");
        let summary = state
            .export_design_bundle(&zip, "{\"nodes\":[]}", &names(&["dbA1", "dbA2"]), &names(&["DB1"]))
            .await
            .unwrap();
        assert!(summary.missing_alleles.is_empty());
        assert_eq!(summary.tables.iter().find(|t| t.table == "alleles").unwrap().rows, 3);

        // the unrelated rows are not in the file
        let design_json = InnerDbState::read_bundle_design(&zip).unwrap().unwrap();
        assert_eq!(design_json, "{\"nodes\":[]}");

        forget_the_design_data(&pool).await;
        let report = state.import_archive(&zip, Some(&design("D-IMPORTED"))).await.unwrap();
        // the genes and conditions were never removed, so they are kept; every
        // other row had to be added
        for table in &report {
            if table.table == "genes" || table.table == "conditions" {
                assert_eq!(table.inserted, 0, "{}", table.table);
            } else {
                assert_eq!(table.read, table.inserted, "{}", table.table);
            }
        }

        // everything the design needs is back, and nothing dangles
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM alleles").await, 3);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM strain_alleles").await, 3);
        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM expr_relations WHERE altering_condition = '25C'").await,
            1
        );
        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM alleles WHERE name = 'dbA3' AND contents = 'strain only'").await,
            1
        );
        for orphans in [
            "SELECT COUNT(*) FROM allele_exprs e WHERE NOT EXISTS (SELECT 1 FROM phenotypes p WHERE p.name = e.expressing_phenotype_name AND p.wild = e.expressing_phenotype_wild)",
            "SELECT COUNT(*) FROM alleles WHERE variation_name IS NOT NULL AND variation_name NOT IN (SELECT allele_name FROM variations)",
            "SELECT COUNT(*) FROM strain_alleles WHERE allele_name NOT IN (SELECT name FROM alleles)",
        ] {
            assert_eq!(count(&pool, orphans).await, 0, "{orphans}");
        }
        // the unrelated data was never bundled
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM alleles WHERE name = 'dbOther'").await, 0);
        // and the design arrived with the tables
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM cross_designs WHERE id = 'D-IMPORTED'").await, 1);
    }

    #[sqlx::test]
    async fn existing_rows_are_kept_and_counted(pool: Pool<Sqlite>) {
        let state = database(&pool).await;
        let scratch = Scratch::new("kept");
        let zip = scratch.0.join("design.ww.zip");
        state
            .export_design_bundle(&zip, "{}", &names(&["dbA1"]), &[])
            .await
            .unwrap();

        // the teammate already has dbA1, defined differently
        exec(&pool, "UPDATE alleles SET contents = 'the teammate''s version' WHERE name = 'dbA1'").await;
        let report = state.import_archive(&zip, Some(&design("D2"))).await.unwrap();

        let alleles = report.iter().find(|r| r.table == "alleles").unwrap();
        assert_eq!((alleles.read, alleles.inserted), (1, 0));
        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM alleles WHERE name = 'dbA1' AND contents = 'the teammate''s version'").await,
            1
        );
    }

    #[sqlx::test]
    async fn a_design_that_cannot_be_added_rolls_the_tables_back(pool: Pool<Sqlite>) {
        let state = database(&pool).await;
        let scratch = Scratch::new("rollback");
        let zip = scratch.0.join("design.ww.zip");
        state
            .export_design_bundle(&zip, "{}", &names(&["dbA1", "dbA2"]), &names(&["DB1"]))
            .await
            .unwrap();

        forget_the_design_data(&pool).await;
        // a design with this id already exists, so adding it fails
        state.insert_cross_design(&design("DUPLICATE")).await.unwrap();
        let result = state.import_archive(&zip, Some(&design("DUPLICATE"))).await;

        assert!(result.is_err());
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM alleles").await, 0);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM strains").await, 0);
    }

    #[sqlx::test]
    async fn a_plain_data_zip_has_no_design(pool: Pool<Sqlite>) {
        let state = database(&pool).await;
        let scratch = Scratch::new("plain");
        let zip = scratch.0.join("tables.zip");
        let mut writer = zip::ZipWriter::new(File::create(&zip).unwrap());
        writer
            .start_file("variations.csv", zip::write::FileOptions::default())
            .unwrap();
        writer.write_all(b"alleleName,chromosome\nplainV,X\n").unwrap();
        writer.finish().unwrap();

        assert_eq!(InnerDbState::read_bundle_design(&zip).unwrap(), None);
        let _ = state;
    }

    #[sqlx::test]
    async fn a_bundle_with_only_a_design_still_imports(pool: Pool<Sqlite>) {
        let state = database(&pool).await;
        let scratch = Scratch::new("design-only");
        let zip = scratch.0.join("design.ww.zip");
        // a design that uses no saved strains or alleles bundles no tables
        let summary = state
            .export_design_bundle(&zip, "{\"nodes\":[]}", &[], &[])
            .await
            .unwrap();
        assert!(summary.tables.is_empty());

        let report = state.import_archive(&zip, Some(&design("D3"))).await.unwrap();
        assert!(report.is_empty());
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM cross_designs WHERE id = 'D3'").await, 1);
    }

    // The shipped demo data (every kind of row: temperature-sensitive alleles,
    // rescues, balancers, arrays) goes through a bundle and back unchanged.
    #[sqlx::test]
    async fn real_demo_strains_round_trip(pool: Pool<Sqlite>) {
        let state = InnerDbState {
            conn_pool: pool.clone(),
        };
        state.seed_defaults().await.unwrap();
        let strains = names(&["EG10105", "DA438", "nT1[qIs51]", "CB3988", "FX30252"]);
        let before = |table: &'static str| {
            let pool = pool.clone();
            async move { count(&pool, &format!("SELECT COUNT(*) FROM {table}")).await }
        };
        let (tables, missing) = state.collect_design_tables(&[], &strains).await.unwrap();
        assert!(missing.is_empty());
        assert_eq!(tables.strains.len(), 5);
        let alleles_before = before("alleles").await;

        let scratch = Scratch::new("real");
        let zip = scratch.0.join("real.ww.zip");
        state
            .export_design_bundle(&zip, "{}", &[], &strains)
            .await
            .unwrap();

        // remember the strains, drop everything the bundle holds, bring it back
        let genotypes: Vec<(String, String)> =
            sqlx::query_as("SELECT name, genotype FROM strains ORDER BY name")
                .fetch_all(&pool)
                .await
                .unwrap();
        let strain_allele_rows = before("strain_alleles").await;
        let relations_before = before("expr_relations").await;
        for sql in [
            "DELETE FROM strain_alleles",
            "DELETE FROM strains",
            "DELETE FROM expr_relations",
            "DELETE FROM allele_exprs",
            "DELETE FROM alleles",
            "DELETE FROM variations",
            "DELETE FROM phenotypes",
        ] {
            exec(&pool, sql).await;
        }
        state.import_archive(&zip, Some(&design("REAL"))).await.unwrap();

        let restored: Vec<(String, String)> =
            sqlx::query_as("SELECT name, genotype FROM strains ORDER BY name")
                .fetch_all(&pool)
                .await
                .unwrap();
        let expected: Vec<(String, String)> = genotypes
            .into_iter()
            .filter(|(name, _)| strains.contains(name))
            .collect();
        assert_eq!(restored, expected);
        assert!(count(&pool, "SELECT COUNT(*) FROM alleles").await <= alleles_before);
        assert!(count(&pool, "SELECT COUNT(*) FROM alleles").await >= 10);
        assert!(count(&pool, "SELECT COUNT(*) FROM strain_alleles").await <= strain_allele_rows);
        assert!(count(&pool, "SELECT COUNT(*) FROM expr_relations").await <= relations_before);
        for orphans in [
            "SELECT COUNT(*) FROM allele_exprs e WHERE NOT EXISTS (SELECT 1 FROM phenotypes p WHERE p.name = e.expressing_phenotype_name AND p.wild = e.expressing_phenotype_wild)",
            "SELECT COUNT(*) FROM expr_relations r WHERE NOT EXISTS (SELECT 1 FROM allele_exprs e WHERE e.allele_name = r.allele_name AND e.expressing_phenotype_name = r.expressing_phenotype_name AND e.expressing_phenotype_wild = r.expressing_phenotype_wild)",
            "SELECT COUNT(*) FROM alleles WHERE variation_name IS NOT NULL AND variation_name NOT IN (SELECT allele_name FROM variations)",
            "SELECT COUNT(*) FROM alleles WHERE systematic_gene_name IS NOT NULL AND systematic_gene_name NOT IN (SELECT systematic_name FROM genes)",
            "SELECT COUNT(*) FROM strain_alleles WHERE allele_name NOT IN (SELECT name FROM alleles)",
        ] {
            assert_eq!(count(&pool, orphans).await, 0, "{orphans}");
        }
        // no relation was duplicated on the way
        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM expr_relations").await,
            count(&pool, "SELECT COUNT(*) FROM (SELECT 1 FROM expr_relations GROUP BY allele_name, expressing_phenotype_name, expressing_phenotype_wild, COALESCE(altering_phenotype_name, ''), COALESCE(altering_phenotype_wild, -1), COALESCE(altering_condition, ''), is_suppressing)").await
        );
    }
}
