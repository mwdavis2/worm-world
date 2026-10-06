use super::{bulk::Bulk, DbError, InnerDbState, SQLITE_BIND_LIMIT};
use crate::models::{
    filter::{Count, Filter, FilterGroup, FilterQueryBuilder},
    strain::{Strain, StrainFieldName},
    strain_allele::StrainAlleleFieldName,
};

use anyhow::Result;
use sqlx::{QueryBuilder, Sqlite};

impl InnerDbState {
    pub async fn get_strains(&self) -> Result<Vec<Strain>, DbError> {
        match sqlx::query_as!(
            Strain,
            "
            SELECT name, genotype, description FROM strains ORDER BY name
            "
        )
        .fetch_all(&self.conn_pool)
        .await
        {
            Ok(strains) => Ok(strains),
            Err(e) => {
                eprint!("Get alleles error: {e}");
                Err(DbError::Query(e.to_string()))
            }
        }
    }

    pub async fn get_filtered_strains(
        &self,
        filter: &FilterGroup<StrainFieldName>,
    ) -> Result<Vec<Strain>, DbError> {
        let mut qb: QueryBuilder<Sqlite> =
            QueryBuilder::new("SELECT name, genotype, description from strains");
        filter.add_filtered_query(&mut qb, true, true);

        match qb
            .build_query_as::<Strain>()
            .fetch_all(&self.conn_pool)
            .await
        {
            Ok(exprs) => Ok(exprs.into_iter().collect()),
            Err(e) => {
                eprint!("Get filtered strains error: {e}");
                Err(DbError::Query(e.to_string()))
            }
        }
    }

    pub async fn get_count_filtered_strains(
        &self,
        filter: &FilterGroup<StrainFieldName>,
    ) -> Result<u32, DbError> {
        let mut qb: QueryBuilder<Sqlite> =
            QueryBuilder::new("SELECT COUNT(*) as count FROM strains");
        filter.add_filtered_query(&mut qb, true, false);

        match qb
            .build_query_as::<Count>()
            .fetch_one(&self.conn_pool)
            .await
        {
            Ok(count) => Ok(count.count),
            Err(e) => {
                eprint!("Get filtered strain Count error: {e}");
                Err(DbError::Query(e.to_string()))
            }
        }
    }

    pub async fn update_strain(&self, name: String, new_strain: Strain) -> Result<(), DbError> {
        match sqlx::query!(
            "UPDATE strains SET name = ?, genotype = ?, description = ? WHERE name = ?",
            new_strain.name,
            new_strain.genotype,
            new_strain.description,
            name
        )
        .execute(&self.conn_pool)
        .await
        {
            Ok(result) if result.rows_affected() == 0 => Err(DbError::Update(format!(
                "No strain found with name '{name}'"
            ))),
            Ok(_) => Ok(()),
            Err(e) => {
                eprint!("Update strain error: {e}");
                Err(DbError::Update(e.to_string()))
            }
        }
    }

    pub async fn insert_strain(&self, strain: &Strain) -> Result<(), DbError> {
        match sqlx::query!(
            "
            INSERT INTO strains (name, genotype, description)
            VALUES (?, ?, ?)
            ",
            strain.name,
            strain.genotype,
            strain.description,
        )
        .execute(&self.conn_pool)
        .await
        {
            Ok(_) => Ok(()),
            Err(e) => {
                eprint!("Insert strain error: {e}");
                Err(DbError::Insert(e.to_string()))
            }
        }
    }

    pub async fn insert_strains(&self, bulk: Bulk<Strain>) -> Result<(), DbError> {
        let mut conn = self
            .conn_pool
            .acquire()
            .await
            .map_err(|e| DbError::BulkInsert(e.to_string()))?;
        Self::insert_strains_on(&mut conn, bulk).await.map(|_| ())
    }

    /// Inserts on the given connection (so a caller can wrap several tables in
    /// one transaction); returns how many rows were actually added.
    pub(crate) async fn insert_strains_on(
        conn: &mut sqlx::SqliteConnection,
        bulk: Bulk<Strain>,
    ) -> Result<u64, DbError> {
        let mut inserted = 0u64;
        if !bulk.errors.is_empty() {
            return Err(DbError::BulkInsert(format!(
                "Found {} invalid row(s); first error: {}",
                bulk.errors.len(),
                bulk.errors[0].1
            )));
        }
        let bind_limit = SQLITE_BIND_LIMIT / 3;

        let mut data = bulk.data.into_iter().peekable();
        while data.peek().is_some() {
            let chunk = data.by_ref().take(bind_limit - 1).collect::<Vec<_>>();
            let mut qb: QueryBuilder<Sqlite> =
                QueryBuilder::new("INSERT OR IGNORE INTO strains (name, genotype, description)");
            if chunk.len() > bind_limit {
                return Err(DbError::BulkInsert(format!(
                    "Row count exceeds max: {}",
                    bind_limit
                )));
            }
            qb.push_values(chunk, |mut b, item| {
                b.push_bind(item.name)
                    .push_bind(item.genotype)
                    .push_bind(item.description);
            });

            match qb.build().execute(&mut *conn).await {
                Ok(result) => inserted += result.rows_affected(),
                Err(e) => {
                    eprint!("Bulk insert error: {e}");
                    return Err(DbError::BulkInsert(e.to_string()));
                }
            }
        }
        Ok(inserted)
    }

    pub async fn delete_filtered_strains(
        &self,
        filter: &FilterGroup<StrainFieldName>,
    ) -> Result<(), DbError> {
        // strain_alleles has no ON DELETE CASCADE from strains, so a strain
        // with any alleles attached would otherwise always fail this delete
        // on the foreign key. Clear just its strain_alleles rows first - the
        // alleles themselves are untouched and stay reusable by other
        // strains.
        let matching_strains = self.get_filtered_strains(filter).await?;
        if !matching_strains.is_empty() {
            let strain_alleles_filter = FilterGroup::<StrainAlleleFieldName> {
                filters: vec![matching_strains
                    .iter()
                    .map(|strain| {
                        (
                            StrainAlleleFieldName::StrainName,
                            Filter::Equal(strain.name.clone()),
                        )
                    })
                    .collect()],
                order_by: vec![],
                limit: None,
                offset: None,
            };
            self.delete_filtered_strain_alleles(&strain_alleles_filter)
                .await?;
        }

        let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new("DELETE FROM strains");
        filter.add_filtered_query(&mut qb, true, false);

        match qb.build().execute(&self.conn_pool).await {
            Ok(_) => Ok(()),
            Err(e) => {
                eprint!("Delete strain error: {e}");
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
    use crate::models::strain::Strain;
    use crate::InnerDbState;
    use crate::{interface::mock, models::strain::StrainFieldName};
    use anyhow::Result;
    use pretty_assertions::assert_eq;
    use sqlx::{Pool, Sqlite};

    #[sqlx::test(fixtures("full_db"))]
    async fn test_get_strains(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };

        let strains: Vec<Strain> = state.get_strains().await?;
        assert_eq!(strains, mock::strain::get_strains());
        Ok(())
    }

    #[sqlx::test(fixtures("full_db"))]
    async fn test_get_filtered_strains(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };
        let exprs = state
            .get_filtered_strains(&FilterGroup::<StrainFieldName> {
                filters: vec![vec![
                    (StrainFieldName::Name, Filter::Equal("N2".to_string())),
                    (StrainFieldName::Name, Filter::Equal("CB128".to_string())),
                ]],
                order_by: vec![(StrainFieldName::Name, Order::Asc)],
                limit: None,
                offset: None,
            })
            .await?;

        assert_eq!(exprs, mock::strain::get_filtered_strains());
        Ok(())
    }

    #[sqlx::test(fixtures("full_db"))]
    async fn test_get_filtered_strains_alternate_ordering(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };
        let exprs = state
            .get_filtered_strains(&FilterGroup::<StrainFieldName> {
                filters: vec![vec![
                    (StrainFieldName::Name, Filter::Equal("CB128".to_string())),
                    (StrainFieldName::Name, Filter::Equal("N2".to_string())),
                ]],
                order_by: vec![(StrainFieldName::Genotype, Order::Asc)],
                limit: None,
                offset: None,
            })
            .await?;

        assert_eq!(
            exprs,
            mock::strain::get_filtered_strains_alternate_ordering()
        );
        Ok(())
    }

    #[sqlx::test(fixtures("full_db"))]
    async fn test_get_filtered_strains_and_clause(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };
        let exprs = state
            .get_filtered_strains(&FilterGroup::<StrainFieldName> {
                filters: vec![
                    vec![(StrainFieldName::Name, Filter::Equal("N2".to_string()))],
                    vec![(
                        StrainFieldName::Description,
                        Filter::Equal( "C. elegans var Bristol. Generation time is about 3 days. Brood size is about 350. Also CGC reference 257. Isolated from mushroom compost near Bristol, England by L.N. Staniland.".to_string()),
                    )],
                ],
                order_by: vec![],
                limit: None,
                offset: None,
            })
            .await?;

        assert_eq!(exprs, mock::strain::get_filtered_strains_and_clause());
        Ok(())
    }
    #[sqlx::test(fixtures("full_db"))]
    async fn test_get_filtered_strains_and_with_or_clause(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };
        let exprs = state
            .get_filtered_strains(&FilterGroup::<StrainFieldName> {
                filters: vec![
                    vec![(
                        StrainFieldName::Description,
                        Filter::Like("Dpy".to_string()),
                    )],
                    vec![
                        (StrainFieldName::Name, Filter::Equal("EG5071".to_string())),
                        (StrainFieldName::Name, Filter::Like("BT".to_string())),
                    ],
                ],
                order_by: vec![(StrainFieldName::Name, Order::Asc)],
                limit: None,
                offset: None,
            })
            .await?;

        assert_eq!(exprs, mock::strain::get_filtered_strains_and_or_clause());
        Ok(())
    }

    #[sqlx::test(fixtures("full_db"))]
    async fn test_get_count_filtered_strains(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };
        let count = state
            .get_count_filtered_strains(&FilterGroup::<StrainFieldName> {
                filters: vec![],
                order_by: vec![],
                limit: None,
                offset: None,
            })
            .await?;
        assert_eq!(count as usize, mock::strain::get_strains().len());
        Ok(())
    }

    #[sqlx::test(fixtures("full_db"))]
    async fn test_search_strains_by_desc_name(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };
        let exprs = state
            .get_filtered_strains(&FilterGroup::<StrainFieldName> {
                filters: vec![vec![(
                    StrainFieldName::Name,
                    Filter::Like("EG".to_string()),
                )]],
                order_by: vec![(StrainFieldName::Name, Order::Desc)],
                limit: None,
                offset: None,
            })
            .await?;

        assert_eq!(exprs, mock::strain::search_strains_by_desc_name());
        Ok(())
    }

    #[sqlx::test]
    async fn test_insert_strain(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };

        let strains: Vec<Strain> = state.get_strains().await?;
        assert_eq!(strains.len(), 0);

        let expected = Strain {
            name: "N2".to_string(),
            genotype: "C. elegans wild isolate.".to_string(),
            description: Some( "C. elegans var Bristol. Generation time is about 3 days. Brood size is about 350. Also CGC reference 257. Isolated from mushroom compost near Bristol, England by L.N. Staniland.".to_string()),
        };

        state.insert_strain(&expected).await?;
        let strains: Vec<Strain> = state.get_strains().await?;

        assert_eq!(vec![expected], strains);
        Ok(())
    }

    #[sqlx::test]
    async fn test_insert_strain_no_description(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };

        let strains: Vec<Strain> = state.get_strains().await?;
        assert_eq!(strains.len(), 0);

        let expected = Strain {
            name: "MT2495".to_string(),
            genotype: "lin-15B(n744) X.".to_string(),
            description: None,
        };

        state.insert_strain(&expected).await?;
        let strains: Vec<Strain> = state.get_strains().await?;

        assert_eq!(vec![expected], strains);
        Ok(())
    }

    #[sqlx::test]
    async fn test_insert_strains(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };

        let csv_str = "name,genotype,description\nMT2495,lin-15B(n744) X.,\nCB128,dpy-10(e128) II.,Small Dpy.".as_bytes();
        let buf = BufReader::new(csv_str);
        let mut reader = csv::ReaderBuilder::new().has_headers(true).from_reader(buf);
        let bulk: Bulk<Strain> = Bulk::from_reader(&mut reader);

        state.insert_strains(bulk).await?;

        let strains: Vec<Strain> = state.get_strains().await?;
        assert_eq!(
            strains,
            vec![
                Strain {
                    name: "CB128".to_string(),
                    genotype: "dpy-10(e128) II.".to_string(),
                    description: Some("Small Dpy.".to_string()),
                },
                Strain {
                    name: "MT2495".to_string(),
                    genotype: "lin-15B(n744) X.".to_string(),
                    description: None,
                },
            ]
        );
        Ok(())
    }

    #[sqlx::test]
    async fn test_insert_strains_tabs(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };

        let tsv_str = "name\tgenotype\tdescription\nMT2495\tlin-15B(n744) X.\t\nCB128\tdpy-10(e128) II.\tSmall Dpy.".as_bytes();
        let buf = BufReader::new(tsv_str);
        let mut reader = csv::ReaderBuilder::new()
            .has_headers(true)
            .delimiter(b'\t')
            .from_reader(buf);
        let bulk: Bulk<Strain> = Bulk::from_reader(&mut reader);

        state.insert_strains(bulk).await?;

        let strains: Vec<Strain> = state.get_strains().await?;
        assert_eq!(
            strains,
            vec![
                Strain {
                    name: "CB128".to_string(),
                    genotype: "dpy-10(e128) II.".to_string(),
                    description: Some("Small Dpy.".to_string()),
                },
                Strain {
                    name: "MT2495".to_string(),
                    genotype: "lin-15B(n744) X.".to_string(),
                    description: None,
                },
            ]
        );
        Ok(())
    }

    #[sqlx::test(fixtures("strain"))]

    async fn test_delete_filtered_strains(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };

        let mut strains: Vec<Strain> = state.get_strains().await?;
        let orig_len = strains.len();
        assert_eq!(orig_len, mock::strain::get_strains().len());

        let filter = &FilterGroup::<StrainFieldName> {
            filters: vec![vec![(
                StrainFieldName::Name,
                Filter::Equal("N2".to_owned()),
            )]],
            order_by: vec![],
            limit: None,
            offset: None,
        };

        strains = state.get_filtered_strains(filter).await?;
        let filtered_len = strains.len();
        assert!(filtered_len > 0);

        state.delete_filtered_strains(filter).await?;
        strains = state.get_strains().await?;

        assert_eq!(strains.len(), orig_len - filtered_len);

        Ok(())
    }

    #[sqlx::test(fixtures("strain"))]
    async fn test_delete_all_strains(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };

        let mut strains: Vec<Strain> = state.get_strains().await?;
        assert_eq!(strains.len(), mock::strain::get_strains().len());

        let filter = &FilterGroup::<StrainFieldName> {
            filters: vec![],
            order_by: vec![],
            limit: None,
            offset: None,
        };

        state.delete_filtered_strains(filter).await?;
        strains = state.get_strains().await?;

        assert_eq!(strains.len(), 0);

        Ok(())
    }

    // Regression test: deleting a strain that still has strain_alleles rows
    // used to always fail on the strain_alleles.strain_name foreign key,
    // since nothing cleared those rows first and the schema has no
    // ON DELETE CASCADE for it. The fix clears just the deleted strain's own
    // strain_alleles rows - the alleles themselves (and any other strain's
    // use of them) must be untouched.
    #[sqlx::test(fixtures("full_db"))]
    async fn test_delete_filtered_strains_with_alleles_attached(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };

        let alleles_before = state.get_alleles().await?;
        let strain_alleles_before = state.get_strain_alleles().await?;
        let other_strains_ed3_count = strain_alleles_before
            .iter()
            .filter(|sa| sa.allele_name == "ed3" && sa.strain_name != "EG6207")
            .count();
        assert!(other_strains_ed3_count > 0);

        let filter = &FilterGroup::<StrainFieldName> {
            filters: vec![vec![(
                StrainFieldName::Name,
                Filter::Equal("EG6207".to_owned()),
            )]],
            order_by: vec![],
            limit: None,
            offset: None,
        };

        state.delete_filtered_strains(filter).await?;

        let strains_after = state.get_strains().await?;
        assert!(!strains_after.iter().any(|s| s.name == "EG6207"));

        let strain_alleles_after = state.get_strain_alleles().await?;
        assert!(!strain_alleles_after
            .iter()
            .any(|sa| sa.strain_name == "EG6207"));
        // ed3 is still attached to other strains - untouched.
        assert_eq!(
            strain_alleles_after
                .iter()
                .filter(|sa| sa.allele_name == "ed3" && sa.strain_name != "EG6207")
                .count(),
            other_strains_ed3_count
        );

        // The ed3 allele itself must still exist - this is only a cleanup
        // of the join-table rows, never a cascade into alleles.
        let alleles_after = state.get_alleles().await?;
        assert_eq!(alleles_after.len(), alleles_before.len());
        assert!(alleles_after.iter().any(|a| a.name == "ed3"));

        Ok(())
    }
}
