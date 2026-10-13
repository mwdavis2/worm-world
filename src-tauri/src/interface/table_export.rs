//! Writes a data table as a CSV file in the format its importer reads (the same
//! columns the shipped seed files use), so an exported table can be imported
//! again, or edited in a spreadsheet and imported into another database.
use super::{DbError, InnerDbState};
use sqlx::Row;
use std::path::Path;

/// A column of the file: its header and the SQL that makes its text.
struct Column {
    header: &'static str,
    sql: &'static str,
}

const fn col(header: &'static str, sql: &'static str) -> Column {
    Column { header, sql }
}

const BOOL_IS_LOCATION_REFERENCE: &str =
    "CASE WHEN is_location_reference THEN 'true' ELSE 'false' END";
const BOOL_IS_ON_TOP: &str = "CASE WHEN is_on_top THEN 'true' ELSE 'false' END";
const BOOL_IS_ON_BOT: &str = "CASE WHEN is_on_bot THEN 'true' ELSE 'false' END";

/// The columns (importer header, source) and the ordering of an exportable table.
fn columns_of(table: &str) -> Option<(Vec<Column>, &'static str)> {
    let plain = |names: &[&'static str]| names.iter().map(|n| col(n, n)).collect::<Vec<_>>();
    Some(match table {
        "genes" => (
            vec![
                col("sysName", "systematic_name"),
                col("descName", "descriptive_name"),
                col("chromosome", "chromosome"),
                col("physLoc", "phys_loc"),
                col("geneticLoc", "gen_loc"),
            ],
            "rowid",
        ),
        "conditions" => (
            plain(&[
                "name",
                "description",
                "male_mating",
                "lethal",
                "female_sterile",
                "arrested",
                "maturation_days",
            ]),
            "name",
        ),
        "variations" => (
            vec![
                col("alleleName", "allele_name"),
                col("chromosome", "chromosome"),
                col("physLoc", "phys_loc"),
                col("geneticLoc", "gen_loc"),
                col("recombSuppressorStart", "recomb_suppressor_start"),
                col("recombSuppressorEnd", "recomb_suppressor_end"),
                col("isLocationReference", BOOL_IS_LOCATION_REFERENCE),
                col("percentLoss", "percent_loss"),
            ],
            "rowid",
        ),
        "phenotypes" => (
            plain(&[
                "name",
                "wild",
                "short_name",
                "description",
                "male_mating",
                "lethal",
                "male_crossing_defective",
                "female_crossing_defective",
                "self_crossing_defective",
                "him",
                "arrested",
                "maturation_days",
            ]),
            "name, wild",
        ),
        "alleles" => (
            vec![
                col("name", "name"),
                col("contents", "contents"),
                col("sysGeneName", "systematic_gene_name"),
                col("variationName", "variation_name"),
            ],
            "rowid",
        ),
        "allele_exprs" => (
            vec![
                col("alleleName", "allele_name"),
                col("expressingPhenotypeName", "expressing_phenotype_name"),
                col("expressingPhenotypeWild", "expressing_phenotype_wild"),
                col("dominance", "dominance"),
            ],
            "rowid",
        ),
        "expr_relations" => (
            plain(&[
                "allele_name",
                "expressing_phenotype_name",
                "expressing_phenotype_wild",
                "altering_phenotype_name",
                "altering_phenotype_wild",
                "altering_condition",
                "is_suppressing",
                "altering_phenotype_maternal",
            ]),
            "rowid",
        ),
        "allele_conversions" => (
            vec![
                col("sourceAllele", "source_allele"),
                col("productAllele", "product_allele"),
                col("driverPhenotypeName", "driver_phenotype_name"),
                col("driverPhenotypeWild", "driver_phenotype_wild"),
                col("percentConversion", "percent_conversion"),
                col("description", "description"),
            ],
            "rowid",
        ),
        "strains" => (plain(&["name", "genotype", "description"]), "name"),
        "strain_alleles" => (
            vec![
                col("strainName", "strain_name"),
                col("alleleName", "allele_name"),
                col("isOnTop", BOOL_IS_ON_TOP),
                col("isOnBot", BOOL_IS_ON_BOT),
            ],
            "rowid",
        ),
        _ => return None,
    })
}

impl InnerDbState {
    /// Writes every row of `table` to `path` as a CSV file whose header is the
    /// one the table's importer reads; returns how many rows were written. An
    /// empty value is written for a NULL.
    pub async fn export_table_csv(&self, table: &str, path: &Path) -> Result<u32, DbError> {
        let (columns, order) = columns_of(table).ok_or_else(|| {
            DbError::Query(format!("{table} is not a table that can be exported"))
        })?;
        let select = columns
            .iter()
            .map(|c| format!("COALESCE(CAST({} AS TEXT), '')", c.sql))
            .collect::<Vec<_>>()
            .join(", ");
        // `table` is one of the fixed names matched above
        let sql = format!("SELECT {select} FROM {table} ORDER BY {order}");
        let rows = sqlx::query(&sql)
            .fetch_all(&self.conn_pool)
            .await
            .map_err(|e| DbError::Query(e.to_string()))?;

        let mut writer = csv::Writer::from_path(path)
            .map_err(|e| DbError::Query(format!("Unable to write {path:?}: {e}")))?;
        writer
            .write_record(columns.iter().map(|c| c.header))
            .map_err(|e| DbError::Query(e.to_string()))?;
        for row in &rows {
            let record = (0..columns.len())
                .map(|i| row.try_get::<String, _>(i))
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| DbError::Query(e.to_string()))?;
            writer
                .write_record(&record)
                .map_err(|e| DbError::Query(e.to_string()))?;
        }
        writer
            .flush()
            .map_err(|e| DbError::Query(format!("Unable to write {path:?}: {e}")))?;
        Ok(rows.len() as u32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Sqlite};
    use std::fs;

    const TABLES: [&str; 10] = [
        "genes",
        "conditions",
        "variations",
        "phenotypes",
        "alleles",
        "allele_exprs",
        "expr_relations",
        "allele_conversions",
        "strains",
        "strain_alleles",
    ];

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("ww-export-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    async fn count(pool: &Pool<Sqlite>, table: &str) -> i64 {
        sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[sqlx::test(fixtures("full_db"))]
    async fn every_table_exports_with_one_line_per_row_and_the_importer_header(pool: Pool<Sqlite>) {
        let state = InnerDbState {
            conn_pool: pool.clone(),
        };
        let dir = temp_dir("rows");
        for table in TABLES {
            let path = dir.join(format!("{table}.csv"));
            let written = state.export_table_csv(table, &path).await.unwrap();
            assert_eq!(i64::from(written), count(&pool, table).await, "{table}");
            let text = fs::read_to_string(&path).unwrap();
            let records = csv::Reader::from_reader(text.as_bytes()).records().count();
            assert_eq!(records as u32, written, "{table}");
        }
        let header = fs::read_to_string(dir.join("phenotypes.csv")).unwrap();
        assert_eq!(
            header.lines().next().unwrap(),
            "name,wild,short_name,description,male_mating,lethal,male_crossing_defective,female_crossing_defective,self_crossing_defective,him,arrested,maturation_days"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[sqlx::test(fixtures("full_db"))]
    async fn an_exported_folder_imports_again_without_error_or_new_rows(pool: Pool<Sqlite>) {
        let state = InnerDbState {
            conn_pool: pool.clone(),
        };
        let dir = temp_dir("roundtrip");
        for table in TABLES {
            state
                .export_table_csv(table, &dir.join(format!("{table}.csv")))
                .await
                .unwrap();
        }
        let before: Vec<i64> = {
            let mut v = vec![];
            for table in TABLES {
                v.push(count(&pool, table).await);
            }
            v
        };
        // every file parses with its importer, and the rows are all already there
        let reports = state.import_folder(&dir).await.unwrap();
        assert_eq!(reports.len(), TABLES.len());
        assert!(reports.iter().all(|r| r.inserted == 0), "{reports:?}");
        let mut after = vec![];
        for table in TABLES {
            after.push(count(&pool, table).await);
        }
        assert_eq!(before, after);
        let _ = fs::remove_dir_all(&dir);
    }

    #[sqlx::test]
    async fn an_unknown_table_is_refused(pool: Pool<Sqlite>) {
        let state = InnerDbState { conn_pool: pool };
        let dir = temp_dir("unknown");
        let err = state
            .export_table_csv("tasks", &dir.join("tasks.csv"))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("not a table that can be exported"));
        let _ = fs::remove_dir_all(&dir);
    }
}
