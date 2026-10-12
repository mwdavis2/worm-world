use super::{bulk::Bulk, DbError, InnerDbState, SQLITE_BIND_LIMIT};
use crate::models::{
    allele_conversion::{AlleleConversion, AlleleConversionDb, AlleleConversionFieldName},
    filter::{Count, FilterGroup, FilterQueryBuilder},
};
use anyhow::Result;
use sqlx::{QueryBuilder, Row, Sqlite};

const COLUMNS: &str = "source_allele, product_allele, driver_phenotype_name, driver_phenotype_wild, percent_conversion, description";

/// A conversion's percent must be a number from 0 to 100.
fn check_percent(percent: f64) -> Result<(), String> {
    if (0.0..=100.0).contains(&percent) {
        Ok(())
    } else {
        Err(format!(
            "The percent converted must be between 0 and 100 (got {percent})"
        ))
    }
}

/// The gene or variation an allele belongs to, or an error if it does not exist.
async fn locus_of(
    conn: &mut sqlx::SqliteConnection,
    allele: &str,
) -> Result<(Option<String>, Option<String>), String> {
    let row =
        sqlx::query("SELECT systematic_gene_name, variation_name FROM alleles WHERE name = ?")
            .bind(allele)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    match row {
        Some(row) => Ok((row.get(0), row.get(1))),
        None => Err(format!("The allele '{allele}' does not exist")),
    }
}

/// A conversion's product must be an allele of the same gene or variation as its
/// source, so that the two sit at one locus and linkage is unchanged.
pub(crate) async fn check_conversion(
    conn: &mut sqlx::SqliteConnection,
    source: &str,
    product: &str,
    percent: f64,
) -> Result<(), String> {
    check_percent(percent)?;
    if source == product {
        return Err("An allele cannot convert into itself".to_owned());
    }
    let (source_gene, source_variation) = locus_of(conn, source).await?;
    let (product_gene, product_variation) = locus_of(conn, product).await?;
    let same_gene = source_gene.is_some() && source_gene == product_gene;
    let same_variation = source_variation.is_some() && source_variation == product_variation;
    if same_gene || same_variation {
        Ok(())
    } else {
        Err(format!(
            "The product '{product}' must be an allele of the same gene or variation as the source '{source}'"
        ))
    }
}

impl InnerDbState {
    pub async fn get_allele_conversions(&self) -> Result<Vec<AlleleConversion>, DbError> {
        match sqlx::query_as::<_, AlleleConversionDb>(&format!(
            "SELECT {COLUMNS} FROM allele_conversions
            ORDER BY source_allele, product_allele, driver_phenotype_name, driver_phenotype_wild"
        ))
        .fetch_all(&self.conn_pool)
        .await
        {
            Ok(rows) => Ok(rows.into_iter().map(|r| r.into()).collect()),
            Err(e) => {
                eprint!("Get Allele Conversions error: {e}");
                Err(DbError::Query(e.to_string()))
            }
        }
    }

    pub async fn get_filtered_allele_conversions(
        &self,
        filter: &FilterGroup<AlleleConversionFieldName>,
    ) -> Result<Vec<AlleleConversion>, DbError> {
        let mut qb: QueryBuilder<Sqlite> =
            QueryBuilder::new(format!("SELECT {COLUMNS} FROM allele_conversions"));
        filter.add_filtered_query(&mut qb, true, true);

        match qb
            .build_query_as::<AlleleConversionDb>()
            .fetch_all(&self.conn_pool)
            .await
        {
            Ok(rows) => Ok(rows.into_iter().map(|r| r.into()).collect()),
            Err(e) => {
                eprint!("Get Filtered Allele Conversions error: {e}");
                Err(DbError::Query(e.to_string()))
            }
        }
    }

    pub async fn get_count_filtered_allele_conversions(
        &self,
        filter: &FilterGroup<AlleleConversionFieldName>,
    ) -> Result<u32, DbError> {
        let mut qb: QueryBuilder<Sqlite> =
            QueryBuilder::new("SELECT COUNT(*) as count FROM allele_conversions");
        filter.add_filtered_query(&mut qb, true, false);

        match qb
            .build_query_as::<Count>()
            .fetch_one(&self.conn_pool)
            .await
        {
            Ok(count) => Ok(count.count),
            Err(e) => {
                eprint!("Get Filtered Allele Conversions Count error: {e}");
                Err(DbError::Query(e.to_string()))
            }
        }
    }

    /// Changes the percent and description of an existing conversion; the
    /// source, product and driver identify the row and are never changed.
    pub async fn update_allele_conversion(
        &self,
        conversion: &AlleleConversion,
    ) -> Result<(), DbError> {
        check_percent(conversion.percent_conversion).map_err(DbError::Update)?;
        match sqlx::query(
            "UPDATE allele_conversions SET percent_conversion = ?, description = ?
            WHERE source_allele = ? AND product_allele = ?
            AND driver_phenotype_name = ? AND driver_phenotype_wild = ?",
        )
        .bind(conversion.percent_conversion)
        .bind(&conversion.description)
        .bind(&conversion.source_allele)
        .bind(&conversion.product_allele)
        .bind(&conversion.driver_phenotype_name)
        .bind(conversion.driver_phenotype_wild)
        .execute(&self.conn_pool)
        .await
        {
            Ok(result) if result.rows_affected() == 0 => Err(DbError::Update(format!(
                "No conversion found from '{}' to '{}' driven by '{}'",
                conversion.source_allele,
                conversion.product_allele,
                conversion.driver_phenotype_name
            ))),
            Ok(_) => Ok(()),
            Err(e) => {
                eprint!("Update allele conversion error: {e}");
                Err(DbError::Update(e.to_string()))
            }
        }
    }

    pub async fn insert_allele_conversion(
        &self,
        conversion: &AlleleConversion,
    ) -> Result<(), DbError> {
        let mut conn = self
            .conn_pool
            .acquire()
            .await
            .map_err(|e| DbError::Insert(e.to_string()))?;
        check_conversion(
            &mut conn,
            &conversion.source_allele,
            &conversion.product_allele,
            conversion.percent_conversion,
        )
        .await
        .map_err(DbError::Insert)?;
        match sqlx::query(&format!(
            "INSERT INTO allele_conversions ({COLUMNS}) VALUES(?, ?, ?, ?, ?, ?)"
        ))
        .bind(&conversion.source_allele)
        .bind(&conversion.product_allele)
        .bind(&conversion.driver_phenotype_name)
        .bind(conversion.driver_phenotype_wild)
        .bind(conversion.percent_conversion)
        .bind(&conversion.description)
        .execute(&mut *conn)
        .await
        {
            Ok(_) => Ok(()),
            Err(e) => {
                eprint!("Insert Allele Conversion error: {e}");
                Err(DbError::Insert(e.to_string()))
            }
        }
    }

    pub async fn insert_allele_conversions(
        &self,
        bulk: Bulk<AlleleConversionDb>,
    ) -> Result<(), DbError> {
        let mut conn = self
            .conn_pool
            .acquire()
            .await
            .map_err(|e| DbError::BulkInsert(e.to_string()))?;
        Self::insert_allele_conversions_on(&mut conn, bulk)
            .await
            .map(|_| ())
    }

    /// Inserts on the given connection (so a caller can wrap several tables in
    /// one transaction); returns how many rows were actually added. Every row
    /// is checked first (same gene or variation, percent from 0 to 100), so a
    /// bad file adds nothing.
    pub(crate) async fn insert_allele_conversions_on(
        conn: &mut sqlx::SqliteConnection,
        bulk: Bulk<AlleleConversionDb>,
    ) -> Result<u64, DbError> {
        let mut inserted = 0u64;
        if !bulk.errors.is_empty() {
            return Err(DbError::BulkInsert(format!(
                "Found {} invalid row(s); first error: {}",
                bulk.errors.len(),
                bulk.errors[0].1
            )));
        }
        for row in &bulk.data {
            check_conversion(
                conn,
                &row.source_allele,
                &row.product_allele,
                row.percent_conversion,
            )
            .await
            .map_err(DbError::BulkInsert)?;
        }
        let bind_limit = SQLITE_BIND_LIMIT / 6;
        let mut data = bulk.data.into_iter().peekable();
        while data.peek().is_some() {
            let chunk = data.by_ref().take(bind_limit - 1).collect::<Vec<_>>();
            let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new(format!(
                "INSERT OR IGNORE INTO allele_conversions ({COLUMNS}) "
            ));
            if chunk.len() > bind_limit {
                return Err(DbError::BulkInsert(format!(
                    "Row count exceeds max: {}",
                    bind_limit
                )));
            }
            qb.push_values(chunk, |mut b, item| {
                b.push_bind(item.source_allele)
                    .push_bind(item.product_allele)
                    .push_bind(item.driver_phenotype_name)
                    .push_bind(item.driver_phenotype_wild)
                    .push_bind(item.percent_conversion)
                    .push_bind(item.description);
            });

            match qb.build().execute(&mut *conn).await {
                Ok(result) => inserted += result.rows_affected(),
                Err(e) => {
                    eprint!("Bulk Insert error: {e}");
                    return Err(DbError::BulkInsert(e.to_string()));
                }
            }
        }
        Ok(inserted)
    }

    pub async fn delete_filtered_allele_conversions(
        &self,
        filter: &FilterGroup<AlleleConversionFieldName>,
    ) -> Result<(), DbError> {
        let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new("DELETE FROM allele_conversions");
        filter.add_filtered_query(&mut qb, true, false);

        match qb.build().execute(&self.conn_pool).await {
            Ok(_) => Ok(()),
            Err(e) => {
                eprint!("Delete Allele Conversion error: {e}");
                Err(DbError::Delete(e.to_string()))
            }
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::interface::bulk::Bulk;
    use crate::models::filter::{Filter, FilterGroup};
    use sqlx::Pool;
    use std::io::BufReader;

    /// Two alleles of one variation (a floxed source and its product), an
    /// allele of another variation, a gene allele pair, and a driver phenotype.
    async fn seed(pool: &Pool<Sqlite>) -> Result<()> {
        for sql in [
            "INSERT INTO genes (systematic_name, descriptive_name, chromosome, phys_loc, gen_loc) VALUES ('G1', 'unc-119', 'III', 100, 1.0)",
            "INSERT INTO variations (allele_name) VALUES ('v1'), ('v2')",
            "INSERT INTO alleles (name, systematic_gene_name, variation_name) VALUES
                ('floxed', NULL, 'v1'), ('excised', NULL, 'v1'), ('other', NULL, 'v2'),
                ('g_a', 'G1', NULL), ('g_b', 'G1', NULL)",
            "INSERT INTO phenotypes (name, wild, short_name) VALUES ('Cre', 1, 'Cre'), ('Flp', 1, 'Flp')",
        ] {
            sqlx::query(sql).execute(pool).await?;
        }
        Ok(())
    }

    fn rule(source: &str, product: &str, driver: &str, percent: f64) -> AlleleConversion {
        AlleleConversion {
            source_allele: source.to_owned(),
            product_allele: product.to_owned(),
            driver_phenotype_name: driver.to_owned(),
            driver_phenotype_wild: true,
            percent_conversion: percent,
            description: None,
        }
    }

    #[sqlx::test]
    async fn test_insert_get_update_delete(pool: Pool<Sqlite>) -> Result<()> {
        seed(&pool).await?;
        let state = InnerDbState { conn_pool: pool };

        state
            .insert_allele_conversion(&rule("floxed", "excised", "Cre", 100.0))
            .await?;
        // gene alleles of one gene are at one locus too
        state
            .insert_allele_conversion(&rule("g_a", "g_b", "Flp", 40.0))
            .await?;

        let all = state.get_allele_conversions().await?;
        assert_eq!(all.len(), 2);
        assert_eq!(all[0], rule("floxed", "excised", "Cre", 100.0));
        assert_eq!(all[1].percent_conversion, 40.0);

        let mut changed = rule("floxed", "excised", "Cre", 75.0);
        changed.description = Some("germline Cre".to_owned());
        state.update_allele_conversion(&changed).await?;
        let found = state
            .get_filtered_allele_conversions(&FilterGroup {
                filters: vec![vec![(
                    AlleleConversionFieldName::SourceAllele,
                    Filter::Equal("floxed".to_owned()),
                )]],
                order_by: vec![],
                limit: None,
                offset: None,
            })
            .await?;
        assert_eq!(found, vec![changed]);
        assert_eq!(
            state
                .get_count_filtered_allele_conversions(&FilterGroup {
                    filters: vec![],
                    order_by: vec![],
                    limit: None,
                    offset: None,
                })
                .await?,
            2
        );

        // updating a row that is not there is an error, not a silent no-op
        assert!(state
            .update_allele_conversion(&rule("floxed", "excised", "Flp", 10.0))
            .await
            .is_err());

        state
            .delete_filtered_allele_conversions(&FilterGroup {
                filters: vec![vec![(
                    AlleleConversionFieldName::SourceAllele,
                    Filter::Equal("floxed".to_owned()),
                )]],
                order_by: vec![],
                limit: None,
                offset: None,
            })
            .await?;
        assert_eq!(state.get_allele_conversions().await?.len(), 1);
        Ok(())
    }

    #[sqlx::test]
    async fn test_rejects_a_product_at_another_locus(pool: Pool<Sqlite>) -> Result<()> {
        seed(&pool).await?;
        let state = InnerDbState { conn_pool: pool };
        let err = state
            .insert_allele_conversion(&rule("floxed", "other", "Cre", 100.0))
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("same gene or variation"), "{err}");
        // a gene allele and a variation allele are not at one locus either
        assert!(state
            .insert_allele_conversion(&rule("floxed", "g_a", "Cre", 100.0))
            .await
            .is_err());
        assert!(state.get_allele_conversions().await?.is_empty());
        Ok(())
    }

    #[sqlx::test]
    async fn test_rejects_bad_percent_missing_allele_and_self(pool: Pool<Sqlite>) -> Result<()> {
        seed(&pool).await?;
        let state = InnerDbState { conn_pool: pool };
        for bad in [
            rule("floxed", "excised", "Cre", 100.5),
            rule("floxed", "excised", "Cre", -1.0),
            rule("floxed", "floxed", "Cre", 50.0),
            rule("floxed", "nothere", "Cre", 50.0),
            rule("nothere", "excised", "Cre", 50.0),
        ] {
            assert!(
                state.insert_allele_conversion(&bad).await.is_err(),
                "{bad:?}"
            );
        }
        // a driver phenotype that does not exist breaks the reference
        assert!(state
            .insert_allele_conversion(&rule("floxed", "excised", "NoSuchPhenotype", 50.0))
            .await
            .is_err());
        assert!(state.get_allele_conversions().await?.is_empty());
        Ok(())
    }

    #[sqlx::test]
    async fn test_bulk_import_from_csv(pool: Pool<Sqlite>) -> Result<()> {
        seed(&pool).await?;
        let state = InnerDbState { conn_pool: pool };
        let csv = "sourceAllele,productAllele,driverPhenotypeName,driverPhenotypeWild,percentConversion,description
floxed,excised,Cre,1,100,germline Cre
g_a,g_b,Flp,1,60,
"
        .as_bytes();
        let mut reader = csv::ReaderBuilder::new()
            .has_headers(true)
            .from_reader(BufReader::new(csv));
        let bulk = Bulk::<AlleleConversionDb>::from_reader(&mut reader);
        state.insert_allele_conversions(bulk).await?;

        let all = state.get_allele_conversions().await?;
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].description.as_deref(), Some("germline Cre"));
        assert_eq!(all[1].description, None);
        assert_eq!(all[1].percent_conversion, 60.0);
        Ok(())
    }

    #[sqlx::test]
    async fn test_bulk_import_adds_nothing_when_one_row_is_bad(pool: Pool<Sqlite>) -> Result<()> {
        seed(&pool).await?;
        let state = InnerDbState { conn_pool: pool };
        let csv = "sourceAllele,productAllele,driverPhenotypeName,driverPhenotypeWild,percentConversion,description
floxed,excised,Cre,1,100,
floxed,other,Cre,1,100,
"
        .as_bytes();
        let mut reader = csv::ReaderBuilder::new()
            .has_headers(true)
            .from_reader(BufReader::new(csv));
        let bulk = Bulk::<AlleleConversionDb>::from_reader(&mut reader);
        assert!(state.insert_allele_conversions(bulk).await.is_err());
        assert!(state.get_allele_conversions().await?.is_empty());
        Ok(())
    }

    #[sqlx::test]
    async fn test_repeat_rows_are_kept_as_they_are(pool: Pool<Sqlite>) -> Result<()> {
        seed(&pool).await?;
        let state = InnerDbState { conn_pool: pool };
        state
            .insert_allele_conversion(&rule("floxed", "excised", "Cre", 100.0))
            .await?;
        // importing the same rule again keeps the first and does not fail
        let csv = "sourceAllele,productAllele,driverPhenotypeName,driverPhenotypeWild,percentConversion,description
floxed,excised,Cre,1,10,
"
        .as_bytes();
        let mut reader = csv::ReaderBuilder::new()
            .has_headers(true)
            .from_reader(BufReader::new(csv));
        let bulk = Bulk::<AlleleConversionDb>::from_reader(&mut reader);
        state.insert_allele_conversions(bulk).await?;
        let all = state.get_allele_conversions().await?;
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].percent_conversion, 100.0);
        Ok(())
    }
}
