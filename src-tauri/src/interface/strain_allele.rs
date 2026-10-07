use super::{bulk::Bulk, DbError, InnerDbState, SQLITE_BIND_LIMIT};
use crate::models::{
    filter::{Count, FilterGroup, FilterQueryBuilder},
    strain_allele::{StrainAllele, StrainAlleleDb, StrainAlleleFieldName},
};

use anyhow::Result;
use sqlx::{QueryBuilder, Sqlite, SqliteConnection};
use std::collections::{BTreeMap, BTreeSet};

/// One allele a strain holds at a gene or variation, and which homologs it is on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocusRow {
    pub allele: String,
    pub on_top: bool,
    pub on_bot: bool,
}

/// Whether a strain's alleles at ONE gene or variation make a possible strain:
/// - every allele is on at least one homolog;
/// - one allele may be on top, on the bottom, or both (homozygous);
/// - two alleles are allowed only as a compound heterozygote, each on its own
///   single homolog, opposite the other (ed3 on top, ed4 on the bottom);
/// - never more than two.
///
/// Returns what is wrong, ready to show a user.
pub fn check_locus(strain: &str, locus: &str, rows: &[LocusRow]) -> Result<(), String> {
    if let Some(row) = rows.iter().find(|row| !row.on_top && !row.on_bot) {
        return Err(format!(
            "Strain \"{strain}\": allele \"{}\" must be on at least one homolog (top, bottom or both)",
            row.allele
        ));
    }
    let names = |rows: &[LocusRow]| {
        rows.iter()
            .map(|row| format!("\"{}\"", row.allele))
            .collect::<Vec<_>>()
            .join(", ")
    };
    match rows {
        [] | [_] => Ok(()),
        [a, b] => {
            let single_sided = |row: &LocusRow| row.on_top != row.on_bot;
            if single_sided(a) && single_sided(b) && a.on_top != b.on_top {
                Ok(())
            } else {
                Err(format!(
                    "Strain \"{strain}\": {} are both alleles of {locus}, so they can share a strain only as a compound heterozygote - each on one homolog, opposite each other",
                    names(rows)
                ))
            }
        }
        _ => Err(format!(
            "Strain \"{strain}\" has more than two alleles of {locus}: {}",
            names(rows)
        )),
    }
}

#[derive(sqlx::FromRow)]
struct LocusRowDb {
    locus: Option<String>,
    allele_name: String,
    is_on_top: bool,
    is_on_bot: bool,
}

/// Checks every strain in `strain_names` with `check_locus`, per gene or
/// variation. Rows of alleles that belong to neither are not checked.
pub(crate) async fn check_strains(
    conn: &mut SqliteConnection,
    strain_names: &BTreeSet<String>,
) -> Result<(), String> {
    for strain in strain_names {
        let rows: Vec<LocusRowDb> = sqlx::query_as(
            "SELECT COALESCE(a.systematic_gene_name, a.variation_name) AS locus,
                    sa.allele_name AS allele_name, sa.is_on_top AS is_on_top, sa.is_on_bot AS is_on_bot
             FROM strain_alleles sa JOIN alleles a ON a.name = sa.allele_name
             WHERE sa.strain_name = ? ORDER BY sa.rowid",
        )
        .bind(strain)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        let mut loci: BTreeMap<String, Vec<LocusRow>> = BTreeMap::new();
        for row in rows {
            if let Some(locus) = row.locus {
                loci.entry(locus).or_default().push(LocusRow {
                    allele: row.allele_name,
                    on_top: row.is_on_top,
                    on_bot: row.is_on_bot,
                });
            }
        }
        for (locus, rows) in &loci {
            check_locus(strain, locus, rows)?;
        }
    }
    Ok(())
}

impl InnerDbState {
    pub async fn get_strain_alleles(&self) -> Result<Vec<StrainAllele>, DbError> {
        match sqlx::query_as!(
            StrainAlleleDb,
            "
            SELECT strain_name, allele_name, is_on_top, is_on_bot FROM strain_alleles ORDER BY strain_name
            "
        )
        .fetch_all(&self.conn_pool)
        .await
        {
            Ok(strain_alleles) => Ok(strain_alleles.into_iter().map(|e| e.into()).collect()),
            Err(e) => {
                eprint!("Get strain alleles error: {e}");
                Err(DbError::Query(e.to_string()))
            }
        }
    }

    pub async fn get_filtered_strain_alleles(
        &self,
        filter: &FilterGroup<StrainAlleleFieldName>,
    ) -> Result<Vec<StrainAllele>, DbError> {
        let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new(
            "SELECT strain_name, allele_name, is_on_top, is_on_bot from strain_alleles",
        );
        filter.add_filtered_query(&mut qb, true, true);

        match qb
            .build_query_as::<StrainAllele>()
            .fetch_all(&self.conn_pool)
            .await
        {
            Ok(exprs) => Ok(exprs.into_iter().collect()),
            Err(e) => {
                eprint!("Get filtered strain alleles error: {e}");
                Err(DbError::Query(e.to_string()))
            }
        }
    }

    pub async fn get_count_filtered_strain_alleles(
        &self,
        filter: &FilterGroup<StrainAlleleFieldName>,
    ) -> Result<u32, DbError> {
        let mut qb: QueryBuilder<Sqlite> =
            QueryBuilder::new("SELECT COUNT(*) as count FROM strain_alleles");
        filter.add_filtered_query(&mut qb, true, false);

        match qb
            .build_query_as::<Count>()
            .fetch_one(&self.conn_pool)
            .await
        {
            Ok(count) => Ok(count.count),
            Err(e) => {
                eprint!("Get filtered strain alleles count error: {e}");
                Err(DbError::Query(e.to_string()))
            }
        }
    }

    /// Updates which chromosome copies an existing strain allele is on; the
    /// strain and allele identify the row and are never changed.
    pub async fn update_strain_allele(&self, strain_allele: &StrainAllele) -> Result<(), DbError> {
        let mut tx = self
            .conn_pool
            .begin()
            .await
            .map_err(|e| DbError::Update(e.to_string()))?;
        match sqlx::query(
            "UPDATE strain_alleles SET is_on_top = ?, is_on_bot = ?
            WHERE strain_name = ? AND allele_name = ?",
        )
        .bind(strain_allele.is_on_top)
        .bind(strain_allele.is_on_bot)
        .bind(&strain_allele.strain_name)
        .bind(&strain_allele.allele_name)
        .execute(&mut *tx)
        .await
        {
            Ok(result) if result.rows_affected() == 0 => Err(DbError::Update(format!(
                "No strain allele found for strain '{}' and allele '{}'",
                strain_allele.strain_name, strain_allele.allele_name
            ))),
            Ok(_) => {
                // the change must leave a possible strain; dropping tx undoes it
                check_strains(
                    &mut tx,
                    &BTreeSet::from([strain_allele.strain_name.clone()]),
                )
                .await
                .map_err(DbError::Update)?;
                tx.commit()
                    .await
                    .map_err(|e| DbError::Update(e.to_string()))
            }
            Err(e) => {
                eprint!("Update strain allele error: {e}");
                Err(DbError::Update(e.to_string()))
            }
        }
    }

    pub async fn insert_strain_allele(&self, strain_allele: &StrainAllele) -> Result<(), DbError> {
        let mut tx = self
            .conn_pool
            .begin()
            .await
            .map_err(|e| DbError::Insert(e.to_string()))?;
        match sqlx::query!(
            "
            INSERT INTO strain_alleles (strain_name, allele_name, is_on_top, is_on_bot)
            VALUES (?, ?, ?, ?)
            ",
            strain_allele.strain_name,
            strain_allele.allele_name,
            strain_allele.is_on_top,
            strain_allele.is_on_bot,
        )
        .execute(&mut *tx)
        .await
        {
            Ok(_) => {
                // the new row must leave a possible strain; dropping tx undoes it
                check_strains(
                    &mut tx,
                    &BTreeSet::from([strain_allele.strain_name.clone()]),
                )
                .await
                .map_err(DbError::Insert)?;
                tx.commit()
                    .await
                    .map_err(|e| DbError::Insert(e.to_string()))
            }
            Err(e) => {
                eprint!("Insert strain allele error: {e}");
                Err(DbError::Insert(e.to_string()))
            }
        }
    }

    pub async fn insert_strain_alleles(&self, bulk: Bulk<StrainAllele>) -> Result<(), DbError> {
        let mut tx = self
            .conn_pool
            .begin()
            .await
            .map_err(|e| DbError::BulkInsert(e.to_string()))?;
        Self::insert_strain_alleles_on(&mut tx, bulk).await?;
        tx.commit()
            .await
            .map_err(|e| DbError::BulkInsert(e.to_string()))
    }

    /// Inserts on the given connection (so a caller can wrap several tables in
    /// one transaction); returns how many rows were actually added.
    pub(crate) async fn insert_strain_alleles_on(
        conn: &mut sqlx::SqliteConnection,
        bulk: Bulk<StrainAllele>,
    ) -> Result<u64, DbError> {
        let mut inserted = 0u64;
        if !bulk.errors.is_empty() {
            return Err(DbError::BulkInsert(format!(
                "Found {} invalid row(s); first error: {}",
                bulk.errors.len(),
                bulk.errors[0].1
            )));
        }
        let bind_limit = SQLITE_BIND_LIMIT / 4;
        let strain_names: BTreeSet<String> = bulk
            .data
            .iter()
            .map(|row| row.strain_name.clone())
            .collect();

        let mut data = bulk.data.into_iter().peekable();
        while data.peek().is_some() {
            let chunk = data.by_ref().take(bind_limit - 1).collect::<Vec<_>>();
            let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new(
                "INSERT OR IGNORE INTO strain_alleles (strain_name, allele_name, is_on_top, is_on_bot)",
            );
            if chunk.len() > bind_limit {
                return Err(DbError::BulkInsert(format!(
                    "Row count exceeds max: {}",
                    bind_limit
                )));
            }
            qb.push_values(chunk, |mut b, item| {
                b.push_bind(item.strain_name)
                    .push_bind(item.allele_name)
                    .push_bind(item.is_on_top)
                    .push_bind(item.is_on_bot);
            });

            match qb.build().execute(&mut *conn).await {
                Ok(result) => inserted += result.rows_affected(),
                Err(e) => {
                    eprint!("Bulk insert error: {e}");
                    return Err(DbError::BulkInsert(e.to_string()));
                }
            }
        }
        // every strain touched must be a possible strain; the caller's
        // transaction (or the wrapper's) undoes the insert if not
        check_strains(&mut *conn, &strain_names)
            .await
            .map_err(DbError::BulkInsert)?;
        Ok(inserted)
    }

    pub async fn delete_filtered_strain_alleles(
        &self,
        filter: &FilterGroup<StrainAlleleFieldName>,
    ) -> Result<(), DbError> {
        let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new("DELETE FROM strain_alleles");
        filter.add_filtered_query(&mut qb, true, false);

        match qb.build().execute(&self.conn_pool).await {
            Ok(_) => Ok(()),
            Err(e) => {
                eprint!("Delete strain allele error: {e}");
                Err(DbError::Delete(e.to_string()))
            }
        }
    }
}

#[cfg(test)]
mod test {
    use std::io::BufReader;

    use crate::interface::bulk::Bulk;
    use crate::models::filter::{Filter, FilterGroup, Order};
    use crate::models::strain_allele::StrainAllele;
    use crate::InnerDbState;
    use crate::{interface::mock, models::strain_allele::StrainAlleleFieldName};
    use anyhow::Result;
    use pretty_assertions::assert_eq;
    use sqlx::{Pool, Sqlite};

    #[sqlx::test(fixtures("full_db"))]
    async fn test_get_strain_alleles(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };

        let strain_alleles: Vec<StrainAllele> = state.get_strain_alleles().await?;
        assert_eq!(strain_alleles, mock::strain_allele::get_strain_alleles());
        Ok(())
    }

    #[sqlx::test(fixtures("full_db"))]
    async fn test_get_filtered_strain_alleles(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };
        let exprs = state
            .get_filtered_strain_alleles(&FilterGroup::<StrainAlleleFieldName> {
                filters: vec![vec![(
                    StrainAlleleFieldName::AlleleName,
                    Filter::Equal("ed3".to_string()),
                )]],
                order_by: vec![(StrainAlleleFieldName::StrainName, Order::Asc)],
                limit: None,
                offset: None,
            })
            .await?;

        assert_eq!(exprs, mock::strain_allele::get_filtered_strain_alleles());
        Ok(())
    }

    #[sqlx::test(fixtures("full_db"))]
    async fn test_get_filtered_strain_alleles_many_alleles(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };
        let exprs = state
            .get_filtered_strain_alleles(&FilterGroup::<StrainAlleleFieldName> {
                filters: vec![vec![
                    (
                        StrainAlleleFieldName::AlleleName,
                        Filter::Equal("oxTi75".to_string()),
                    ),
                    (
                        StrainAlleleFieldName::AlleleName,
                        Filter::Equal("cn64".to_string()),
                    ),
                    (
                        StrainAlleleFieldName::AlleleName,
                        Filter::Equal("ox11000".to_string()),
                    ),
                    (
                        StrainAlleleFieldName::AlleleName,
                        Filter::Equal("ed3".to_string()),
                    ),
                ]],
                order_by: vec![],
                limit: None,
                offset: None,
            })
            .await?;

        assert_eq!(
            exprs,
            mock::strain_allele::get_filtered_strain_alleles_many_alleles()
        );
        Ok(())
    }

    #[sqlx::test(fixtures("full_db"))]
    async fn test_get_filtered_strain_alleles_and_or_clause(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };
        let exprs = state
            .get_filtered_strain_alleles(&FilterGroup::<StrainAlleleFieldName> {
                filters: vec![
                    vec![(
                        StrainAlleleFieldName::AlleleName,
                        Filter::Equal("ed3".to_string()),
                    )],
                    vec![
                        (
                            StrainAlleleFieldName::StrainName,
                            Filter::Like("BT".to_string()),
                        ),
                        (
                            StrainAlleleFieldName::StrainName,
                            Filter::Like("EG507".to_string()),
                        ),
                    ],
                ],
                order_by: vec![],
                limit: None,
                offset: None,
            })
            .await?;

        assert_eq!(
            exprs,
            mock::strain_allele::get_filtered_strain_alleles_and_or_clause()
        );
        Ok(())
    }

    #[sqlx::test(fixtures("full_db"))]
    async fn test_get_count_filtered_strain_alleles(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };
        let count = state
            .get_count_filtered_strain_alleles(&FilterGroup::<StrainAlleleFieldName> {
                filters: vec![],
                order_by: vec![],
                limit: None,
                offset: None,
            })
            .await?;
        assert_eq!(
            count as usize,
            mock::strain_allele::get_strain_alleles().len()
        );
        Ok(())
    }

    #[sqlx::test(fixtures("strain", "allele"))]
    async fn test_insert_strain_allele(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };

        let strain_alleles: Vec<StrainAllele> = state.get_strain_alleles().await?;
        assert_eq!(strain_alleles.len(), 0);

        let expected = StrainAllele {
            strain_name: "CB128".to_string(),
            allele_name: "e128".to_string(),
            is_on_top: true,
            is_on_bot: true,
        };

        state.insert_strain_allele(&expected).await?;
        let strain_alleles: Vec<StrainAllele> = state.get_strain_alleles().await?;

        assert_eq!(vec![expected], strain_alleles);
        Ok(())
    }

    #[sqlx::test(fixtures("allele", "strain"))]
    async fn test_insert_strain_alleles(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };

        let csv_str =
            "strainName,alleleName,isOnTop,isOnBot\nEG6207,ed3,true,true\nMT2495,n744,true,true\nTN64,cn64,true,true"
                .as_bytes();
        let buf = BufReader::new(csv_str);
        let mut reader = csv::ReaderBuilder::new().has_headers(true).from_reader(buf);
        let bulk: Bulk<StrainAllele> = Bulk::from_reader(&mut reader);

        state.insert_strain_alleles(bulk).await?;

        let strain_alleles: Vec<StrainAllele> = state.get_strain_alleles().await?;
        assert_eq!(
            strain_alleles,
            vec![
                StrainAllele {
                    strain_name: "EG6207".to_string(),
                    allele_name: "ed3".to_string(),
                    is_on_top: true,
                    is_on_bot: true,
                },
                StrainAllele {
                    strain_name: "MT2495".to_string(),
                    allele_name: "n744".to_string(),
                    is_on_top: true,
                    is_on_bot: true,
                },
                StrainAllele {
                    strain_name: "TN64".to_string(),
                    allele_name: "cn64".to_string(),
                    is_on_top: true,
                    is_on_bot: true,
                },
            ]
        );
        Ok(())
    }

    #[sqlx::test(fixtures("strain", "allele"))]
    async fn test_insert_strain_alleles_tabs(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };

        let tsv_str =
            "strainName\talleleName\tisOnTop\tisOnBot\nEG6207\ted3\ttrue\ttrue\nMT2495\tn744\ttrue\ttrue\nTN64\tcn64\ttrue\ttrue"
                .as_bytes();
        let buf = BufReader::new(tsv_str);
        let mut reader = csv::ReaderBuilder::new()
            .has_headers(true)
            .delimiter(b'\t')
            .from_reader(buf);
        let bulk: Bulk<StrainAllele> = Bulk::from_reader(&mut reader);

        state.insert_strain_alleles(bulk).await?;

        let strain_alleles: Vec<StrainAllele> = state.get_strain_alleles().await?;
        assert_eq!(
            strain_alleles,
            vec![
                StrainAllele {
                    strain_name: "EG6207".to_string(),
                    allele_name: "ed3".to_string(),
                    is_on_top: true,
                    is_on_bot: true,
                },
                StrainAllele {
                    strain_name: "MT2495".to_string(),
                    allele_name: "n744".to_string(),
                    is_on_top: true,
                    is_on_bot: true,
                },
                StrainAllele {
                    strain_name: "TN64".to_string(),
                    allele_name: "cn64".to_string(),
                    is_on_top: true,
                    is_on_bot: true,
                },
            ]
        );
        Ok(())
    }

    #[sqlx::test(fixtures("full_db"))]

    async fn test_delete_filtered_strain_alleles(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };

        let mut strain_alleles: Vec<StrainAllele> = state.get_strain_alleles().await?;
        let orig_len = strain_alleles.len();
        assert_eq!(orig_len, mock::strain_allele::get_strain_alleles().len());

        let filter = &FilterGroup::<StrainAlleleFieldName> {
            filters: vec![vec![(
                StrainAlleleFieldName::AlleleName,
                Filter::Equal("ed3".to_string()),
            )]],
            order_by: vec![],
            limit: None,
            offset: None,
        };

        strain_alleles = state.get_filtered_strain_alleles(filter).await?;
        let filtered_len = strain_alleles.len();
        assert!(filtered_len > 0);

        state.delete_filtered_strain_alleles(filter).await?;
        strain_alleles = state.get_strain_alleles().await?;

        assert_eq!(strain_alleles.len(), orig_len - filtered_len);

        Ok(())
    }

    #[sqlx::test(fixtures("full_db"))]
    async fn test_delete_all_strain_alleles(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };

        let mut strain_alleles: Vec<StrainAllele> = state.get_strain_alleles().await?;
        assert_eq!(
            strain_alleles.len(),
            mock::strain_allele::get_strain_alleles().len()
        );

        let filter = &FilterGroup::<StrainAlleleFieldName> {
            filters: vec![],
            order_by: vec![],
            limit: None,
            offset: None,
        };

        state.delete_filtered_strain_alleles(filter).await?;
        strain_alleles = state.get_strain_alleles().await?;

        assert_eq!(strain_alleles.len(), 0);

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::interface::bulk::Bulk;
    use sqlx::{Pool, Sqlite};

    fn row(allele: &str, on_top: bool, on_bot: bool) -> LocusRow {
        LocusRow {
            allele: allele.to_owned(),
            on_top,
            on_bot,
        }
    }

    #[test]
    fn one_allele_may_be_anywhere_but_must_be_on_a_homolog() {
        for (top, bot) in [(true, false), (false, true), (true, true)] {
            assert!(check_locus("S", "g", &[row("a", top, bot)]).is_ok());
        }
        let message = check_locus("S", "g", &[row("a", false, false)]).unwrap_err();
        assert!(message.contains("at least one homolog"), "{message}");
        assert!(check_locus("S", "g", &[]).is_ok());
    }

    #[test]
    fn two_alleles_must_be_a_compound_heterozygote() {
        // each on its own single homolog, opposite each other
        assert!(check_locus("S", "g", &[row("a", true, false), row("b", false, true)]).is_ok());
        assert!(check_locus("S", "g", &[row("a", false, true), row("b", true, false)]).is_ok());
        // same side, or either one homozygous, is impossible
        for rows in [
            [row("a", true, false), row("b", true, false)],
            [row("a", false, true), row("b", false, true)],
            [row("a", true, true), row("b", false, true)],
            [row("a", true, true), row("b", true, true)],
        ] {
            let message = check_locus("S", "g", &rows).unwrap_err();
            assert!(message.contains("compound heterozygote"), "{message}");
        }
    }

    #[test]
    fn more_than_two_alleles_is_impossible() {
        let message = check_locus(
            "S",
            "g",
            &[
                row("a", true, false),
                row("b", false, true),
                row("c", true, false),
            ],
        )
        .unwrap_err();
        assert!(message.contains("more than two"), "{message}");
    }

    async fn database(pool: &Pool<Sqlite>) -> InnerDbState {
        let state = InnerDbState {
            conn_pool: pool.clone(),
        };
        state.seed_reference_data().await.unwrap();
        for sql in [
            // three alleles of unc-119 and one of dpy-10
            "INSERT INTO alleles (name, systematic_gene_name) VALUES ('a1', 'M142.1'), ('a2', 'M142.1'), ('a3', 'M142.1'), ('d1', 'T14B4.7')",
            "INSERT INTO strains (name, genotype) VALUES ('S1', ''), ('S2', '')",
        ] {
            sqlx::query(sql).execute(pool).await.unwrap();
        }
        state
    }

    fn sa(strain: &str, allele: &str, top: bool, bot: bool) -> StrainAllele {
        StrainAllele {
            strain_name: strain.to_owned(),
            allele_name: allele.to_owned(),
            is_on_top: top,
            is_on_bot: bot,
        }
    }

    async fn rows(pool: &Pool<Sqlite>, strain: &str) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM strain_alleles WHERE strain_name = ?")
            .bind(strain)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[sqlx::test]
    async fn adding_one_row_at_a_time_builds_a_compound_heterozygote(pool: Pool<Sqlite>) {
        let state = database(&pool).await;
        state
            .insert_strain_allele(&sa("S1", "a1", true, false))
            .await
            .unwrap();
        state
            .insert_strain_allele(&sa("S1", "a2", false, true))
            .await
            .unwrap();
        // alleles of other genes are never in the way
        state
            .insert_strain_allele(&sa("S1", "d1", true, true))
            .await
            .unwrap();
        assert_eq!(rows(&pool, "S1").await, 3);
    }

    #[sqlx::test]
    async fn a_row_that_makes_an_impossible_strain_is_refused_and_not_added(pool: Pool<Sqlite>) {
        let state = database(&pool).await;
        state
            .insert_strain_allele(&sa("S1", "a1", true, false))
            .await
            .unwrap();

        // on the same homolog as a1
        let error = state
            .insert_strain_allele(&sa("S1", "a2", true, false))
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("compound heterozygote"), "{error}");
        // homozygous next to a1
        assert!(state
            .insert_strain_allele(&sa("S1", "a2", true, true))
            .await
            .is_err());
        // on neither homolog
        assert!(state
            .insert_strain_allele(&sa("S1", "d1", false, false))
            .await
            .is_err());
        assert_eq!(rows(&pool, "S1").await, 1);

        // a third allele after a valid pair
        state
            .insert_strain_allele(&sa("S1", "a2", false, true))
            .await
            .unwrap();
        let error = state
            .insert_strain_allele(&sa("S1", "a3", true, false))
            .await
            .unwrap_err()
            .to_string();
        assert!(
            error.contains("compound heterozygote") || error.contains("more than two"),
            "{error}"
        );
        assert_eq!(rows(&pool, "S1").await, 2);
    }

    #[sqlx::test]
    async fn editing_a_row_cannot_make_an_impossible_strain(pool: Pool<Sqlite>) {
        let state = database(&pool).await;
        state
            .insert_strain_allele(&sa("S1", "a1", true, false))
            .await
            .unwrap();
        state
            .insert_strain_allele(&sa("S1", "a2", false, true))
            .await
            .unwrap();

        // moving a2 to the top (beside a1) or making it homozygous is refused
        assert!(state
            .update_strain_allele(&sa("S1", "a2", true, false))
            .await
            .is_err());
        assert!(state
            .update_strain_allele(&sa("S1", "a2", true, true))
            .await
            .is_err());
        let (top, bot): (bool, bool) = sqlx::query_as(
            "SELECT is_on_top, is_on_bot FROM strain_alleles WHERE strain_name = 'S1' AND allele_name = 'a2'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!((top, bot), (false, true));

        // taking a1 off, leaving a single allele, is fine
        sqlx::query("DELETE FROM strain_alleles WHERE strain_name = 'S1' AND allele_name = 'a1'")
            .execute(&pool)
            .await
            .unwrap();
        state
            .update_strain_allele(&sa("S1", "a2", true, true))
            .await
            .unwrap();
    }

    fn bulk_of(rows: Vec<StrainAllele>) -> Bulk<StrainAllele> {
        Bulk {
            data: rows,
            errors: vec![],
        }
    }

    #[sqlx::test]
    async fn a_bulk_import_with_an_impossible_strain_adds_nothing(pool: Pool<Sqlite>) {
        let state = database(&pool).await;
        let result = state
            .insert_strain_alleles(bulk_of(vec![
                sa("S2", "d1", true, true),
                sa("S1", "a1", true, false),
                sa("S1", "a2", true, false), // same homolog as a1
            ]))
            .await;
        let error = result.unwrap_err().to_string();
        assert!(
            error.contains("S1") && error.contains("compound heterozygote"),
            "{error}"
        );
        // not even the valid rows went in
        assert_eq!(rows(&pool, "S1").await + rows(&pool, "S2").await, 0);
    }

    #[sqlx::test]
    async fn a_bulk_import_of_a_valid_strain_can_be_repeated(pool: Pool<Sqlite>) {
        let state = database(&pool).await;
        let valid = || {
            bulk_of(vec![
                sa("S1", "a1", true, false),
                sa("S1", "a2", false, true),
                sa("S2", "a3", true, true),
            ])
        };
        state.insert_strain_alleles(valid()).await.unwrap();
        state.insert_strain_alleles(valid()).await.unwrap();
        assert_eq!(rows(&pool, "S1").await, 2);
        assert_eq!(rows(&pool, "S2").await, 1);
    }
}
