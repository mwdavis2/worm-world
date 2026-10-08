//! Deleting a row together with the rows that depend on it (todo #26).
//!
//! The tables reference each other (genes and variations -> alleles ->
//! allele expressions -> expression relations, strains -> strain alleles,
//! phenotypes and conditions -> expressions and relations), and the foreign
//! keys refuse to delete a row something still refers to. The data tables ask
//! `get_delete_impact` what a delete would take with it, show that to the user,
//! and then call `delete_with_dependents`, which removes everything in one
//! transaction (all of it, or none of it).
//!
//! Deleting an allele (or a gene's alleles) also removes a variation that no
//! remaining allele uses, since nothing else could ever use it.

use super::{DbError, InnerDbState};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/models/db/db_CascadeTable.ts")]
#[serde(rename = "db_CascadeTable")]
pub enum CascadeTable {
    Genes,
    Variations,
    Alleles,
    AlleleExprs,
    Phenotypes,
    Conditions,
    Strains,
}

/// The rows of one table that a delete would also remove
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/models/db/db_DependentRows.ts")]
#[serde(rename = "db_DependentRows")]
pub struct DependentRows {
    /// Table name as shown to the user, e.g. "strain alleles"
    pub table: String,
    pub count: u32,
    /// Row names, listed only for variations (the user is told which go)
    pub names: Vec<String>,
}

enum Bind {
    Text(String),
    Int(i64),
}

struct Step {
    label: &'static str,
    table: &'static str,
    where_sql: String,
    binds: Vec<Bind>,
    /// The row the user asked to delete (the rest are its dependents)
    main: bool,
    names: Vec<String>,
}

fn key_binds(table: CascadeTable, key: &[String]) -> Result<Vec<Bind>, DbError> {
    let arity = match table {
        CascadeTable::AlleleExprs => 3,
        CascadeTable::Phenotypes => 2,
        _ => 1,
    };
    if key.len() != arity {
        return Err(DbError::Delete(format!(
            "A {table:?} row is identified by {arity} value(s), got {}",
            key.len()
        )));
    }
    let wild = |s: &String| Bind::Int(i64::from(s == "1" || s.eq_ignore_ascii_case("true")));
    Ok(match table {
        CascadeTable::AlleleExprs => vec![
            Bind::Text(key[0].clone()),
            Bind::Text(key[1].clone()),
            wild(&key[2]),
        ],
        CascadeTable::Phenotypes => vec![Bind::Text(key[0].clone()), wild(&key[1])],
        _ => vec![Bind::Text(key[0].clone())],
    })
}

fn copy_binds(binds: &[Bind]) -> Vec<Bind> {
    binds
        .iter()
        .map(|b| match b {
            Bind::Text(s) => Bind::Text(s.clone()),
            Bind::Int(i) => Bind::Int(*i),
        })
        .collect()
}

impl InnerDbState {
    /// Variations that no allele outside `alleles_where` uses, among those the
    /// alleles `alleles_where` selects: they would be left with nothing
    /// pointing at them. (`COALESCE`: an allele with no gene has a NULL, not
    /// false, for a gene condition, and must still count as outside it.)
    async fn orphaned_variations(
        &self,
        alleles_where: &str,
        binds: &[Bind],
    ) -> Result<Vec<String>, DbError> {
        let sql = format!(
            "SELECT DISTINCT variation_name FROM alleles
             WHERE ({alleles_where}) AND variation_name IS NOT NULL
             AND variation_name NOT IN (
                 SELECT variation_name FROM alleles
                 WHERE NOT COALESCE(({alleles_where}), 0) AND variation_name IS NOT NULL
             )
             ORDER BY variation_name"
        );
        let mut query = sqlx::query_scalar::<_, String>(&sql);
        for bind in binds {
            query = match bind {
                Bind::Text(s) => query.bind(s.clone()),
                Bind::Int(i) => query.bind(*i),
            };
        }
        query
            .fetch_all(&self.conn_pool)
            .await
            .map_err(|e| DbError::Query(e.to_string()))
    }

    /// The steps that delete a row and what depends on it, dependents first
    async fn delete_steps(
        &self,
        table: CascadeTable,
        key: &[String],
    ) -> Result<Vec<Step>, DbError> {
        let binds = key_binds(table, key)?;
        let step = |label: &'static str, table: &'static str, where_sql: &str, main: bool| Step {
            label,
            table,
            where_sql: where_sql.to_string(),
            binds: copy_binds(&binds),
            main,
            names: vec![],
        };
        // Steps that remove a set of alleles and everything hanging off them
        let allele_steps = |alleles_where: &str| {
            let selected = format!("SELECT name FROM alleles WHERE {alleles_where}");
            vec![
                step(
                    "expression relations",
                    "expr_relations",
                    &format!("allele_name IN ({selected})"),
                    false,
                ),
                step(
                    "allele expressions",
                    "allele_exprs",
                    &format!("allele_name IN ({selected})"),
                    false,
                ),
                step(
                    "strain alleles",
                    "strain_alleles",
                    &format!("allele_name IN ({selected})"),
                    false,
                ),
            ]
        };
        // The alleles themselves, then the variations nothing else uses
        let alleles_and_variations = |alleles_where: &str, main: bool, orphans: Vec<String>| {
            let mut steps = vec![step("alleles", "alleles", alleles_where, main)];
            if !orphans.is_empty() {
                steps.push(Step {
                    label: "variations",
                    table: "variations",
                    where_sql: format!(
                        "allele_name IN (SELECT value FROM json_each(?{}))",
                        binds.len() + 1
                    ),
                    binds: {
                        let mut b = copy_binds(&binds);
                        b.push(Bind::Text(serde_json::to_string(&orphans).unwrap()));
                        b
                    },
                    main: false,
                    names: orphans,
                });
            }
            steps
        };

        Ok(match table {
            CascadeTable::Alleles => {
                let cond = "name = ?1";
                let orphans = self.orphaned_variations(cond, &binds).await?;
                let mut steps = allele_steps(cond);
                steps.extend(alleles_and_variations(cond, true, orphans));
                steps
            }
            CascadeTable::Genes => {
                let cond = "systematic_gene_name = ?1";
                let orphans = self.orphaned_variations(cond, &binds).await?;
                let mut steps = allele_steps(cond);
                steps.extend(alleles_and_variations(cond, false, orphans));
                steps.push(step("genes", "genes", "systematic_name = ?1", true));
                steps
            }
            CascadeTable::Variations => {
                // Its alleles go with it, so the variation itself is deleted
                // last as the main row and needs no orphan check
                let cond = "variation_name = ?1";
                let mut steps = allele_steps(cond);
                steps.extend(alleles_and_variations(cond, false, vec![]));
                steps.push(step("variations", "variations", "allele_name = ?1", true));
                steps
            }
            CascadeTable::AlleleExprs => {
                let this = "allele_name = ?1 AND expressing_phenotype_name = ?2 AND expressing_phenotype_wild = ?3";
                vec![
                    step("expression relations", "expr_relations", this, false),
                    step("allele expressions", "allele_exprs", this, true),
                ]
            }
            CascadeTable::Phenotypes => vec![
                step(
                    "expression relations",
                    "expr_relations",
                    "(expressing_phenotype_name = ?1 AND expressing_phenotype_wild = ?2)
                     OR (altering_phenotype_name = ?1 AND altering_phenotype_wild = ?2)",
                    false,
                ),
                step(
                    "allele expressions",
                    "allele_exprs",
                    "expressing_phenotype_name = ?1 AND expressing_phenotype_wild = ?2",
                    false,
                ),
                step("phenotypes", "phenotypes", "name = ?1 AND wild = ?2", true),
            ],
            CascadeTable::Conditions => vec![
                step(
                    "expression relations",
                    "expr_relations",
                    "altering_condition = ?1",
                    false,
                ),
                step("conditions", "conditions", "name = ?1", true),
            ],
            CascadeTable::Strains => vec![
                step(
                    "strain alleles",
                    "strain_alleles",
                    "strain_name = ?1",
                    false,
                ),
                step("strains", "strains", "name = ?1", true),
            ],
        })
    }

    /// What deleting the row would also delete (only tables with rows to go)
    pub async fn get_delete_impact(
        &self,
        table: CascadeTable,
        key: Vec<String>,
    ) -> Result<Vec<DependentRows>, DbError> {
        let mut impact = Vec::new();
        for step in self.delete_steps(table, &key).await? {
            if step.main {
                continue;
            }
            let sql = format!(
                "SELECT COUNT(*) FROM {} WHERE {}",
                step.table, step.where_sql
            );
            let mut query = sqlx::query_scalar::<_, i64>(&sql);
            for bind in &step.binds {
                query = match bind {
                    Bind::Text(s) => query.bind(s.clone()),
                    Bind::Int(i) => query.bind(*i),
                };
            }
            let count = query
                .fetch_one(&self.conn_pool)
                .await
                .map_err(|e| DbError::Query(e.to_string()))?;
            if count > 0 {
                impact.push(DependentRows {
                    table: step.label.to_string(),
                    count: count as u32,
                    names: step.names,
                });
            }
        }
        Ok(impact)
    }

    /// Deletes the row and its dependents in one transaction; returns how many
    /// rows of the row's own table were deleted (0 if it was not there)
    pub async fn delete_with_dependents(
        &self,
        table: CascadeTable,
        key: Vec<String>,
    ) -> Result<u32, DbError> {
        let steps = self.delete_steps(table, &key).await?;
        let mut tx = self
            .conn_pool
            .begin()
            .await
            .map_err(|e| DbError::Delete(e.to_string()))?;
        let mut deleted = 0;
        for step in steps {
            let sql = format!("DELETE FROM {} WHERE {}", step.table, step.where_sql);
            let mut query = sqlx::query(&sql);
            for bind in &step.binds {
                query = match bind {
                    Bind::Text(s) => query.bind(s.clone()),
                    Bind::Int(i) => query.bind(*i),
                };
            }
            let result = query.execute(&mut *tx).await.map_err(|e| {
                eprint!("Delete with dependents error: {e}");
                DbError::Delete(e.to_string())
            })?;
            if step.main {
                deleted = result.rows_affected() as u32;
            }
        }
        tx.commit()
            .await
            .map_err(|e| DbError::Delete(e.to_string()))?;
        Ok(deleted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Sqlite};

    async fn exec(pool: &Pool<Sqlite>, sql: &str) {
        sqlx::query(sql).execute(pool).await.unwrap();
    }

    async fn count(pool: &Pool<Sqlite>, table: &str) -> i64 {
        sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(pool)
            .await
            .unwrap()
    }

    /// gene G; variations v1 (alleles a1, a2: shared) and v2 (allele a3);
    /// phenotypes p (expressed by a1, a3) and q (alters a1's p); condition c;
    /// strain s with a1 and a3
    async fn seed(pool: &Pool<Sqlite>) {
        for sql in [
            "INSERT INTO genes (systematic_name) VALUES ('G')",
            "INSERT INTO variations (allele_name) VALUES ('v1'), ('v2')",
            "INSERT INTO alleles (name, systematic_gene_name, variation_name) VALUES
                ('a1', 'G', 'v1'), ('a2', NULL, 'v1'), ('a3', NULL, 'v2'), ('a4', NULL, NULL)",
            "INSERT INTO phenotypes (name, wild, short_name) VALUES ('p', 0, 'p'), ('q', 0, 'q')",
            "INSERT INTO conditions (name) VALUES ('c')",
            "INSERT INTO allele_exprs (allele_name, expressing_phenotype_name, expressing_phenotype_wild, dominance)
                VALUES ('a1', 'p', 0, 0), ('a3', 'p', 0, 0)",
            "INSERT INTO expr_relations (allele_name, expressing_phenotype_name, expressing_phenotype_wild,
                altering_phenotype_name, altering_phenotype_wild, altering_condition, is_suppressing)
                VALUES ('a1', 'p', 0, 'q', 0, NULL, 1), ('a3', 'p', 0, NULL, NULL, 'c', 0)",
            "INSERT INTO strains (name, genotype) VALUES ('s', '')",
            "INSERT INTO strain_alleles (strain_name, allele_name, is_on_top, is_on_bot)
                VALUES ('s', 'a1', 1, 1), ('s', 'a3', 1, 1)",
        ] {
            exec(pool, sql).await;
        }
    }

    fn key(values: &[&str]) -> Vec<String> {
        values.iter().map(|s| s.to_string()).collect()
    }

    fn summary(impact: &[DependentRows]) -> Vec<(String, u32)> {
        impact.iter().map(|d| (d.table.clone(), d.count)).collect()
    }

    #[sqlx::test]
    async fn deleting_an_allele_takes_its_rows_and_a_variation_nothing_else_uses(
        pool: Pool<Sqlite>,
    ) {
        seed(&pool).await;
        let state = InnerDbState {
            conn_pool: pool.clone(),
        };
        let impact = state
            .get_delete_impact(CascadeTable::Alleles, key(&["a3"]))
            .await
            .unwrap();
        assert_eq!(
            summary(&impact),
            vec![
                ("expression relations".to_string(), 1),
                ("allele expressions".to_string(), 1),
                ("strain alleles".to_string(), 1),
                ("variations".to_string(), 1),
            ]
        );
        assert_eq!(impact[3].names, vec!["v2"]);

        assert_eq!(
            state
                .delete_with_dependents(CascadeTable::Alleles, key(&["a3"]))
                .await
                .unwrap(),
            1
        );
        assert_eq!(count(&pool, "alleles").await, 3);
        assert_eq!(count(&pool, "variations").await, 1); // v2 went, v1 stays
        assert_eq!(count(&pool, "strain_alleles").await, 1);
        assert_eq!(count(&pool, "allele_exprs").await, 1);
        assert_eq!(count(&pool, "expr_relations").await, 1);
        assert_eq!(count(&pool, "phenotypes").await, 2); // shared rows stay
    }

    #[sqlx::test]
    async fn a_variation_another_allele_still_uses_is_kept(pool: Pool<Sqlite>) {
        seed(&pool).await;
        let state = InnerDbState {
            conn_pool: pool.clone(),
        };
        // a1 shares v1 with a2, so v1 must stay
        let impact = state
            .get_delete_impact(CascadeTable::Alleles, key(&["a1"]))
            .await
            .unwrap();
        assert!(impact.iter().all(|d| d.table != "variations"));
        state
            .delete_with_dependents(CascadeTable::Alleles, key(&["a1"]))
            .await
            .unwrap();
        assert_eq!(count(&pool, "variations").await, 2);

        // a2 is now the last allele on v1, so deleting it takes v1 too
        state
            .delete_with_dependents(CascadeTable::Alleles, key(&["a2"]))
            .await
            .unwrap();
        assert_eq!(count(&pool, "variations").await, 1);
    }

    #[sqlx::test]
    async fn an_allele_without_dependents_has_an_empty_impact(pool: Pool<Sqlite>) {
        seed(&pool).await;
        let state = InnerDbState { conn_pool: pool };
        let impact = state
            .get_delete_impact(CascadeTable::Alleles, key(&["a4"]))
            .await
            .unwrap();
        assert!(impact.is_empty());
    }

    #[sqlx::test]
    async fn deleting_a_variation_takes_its_alleles_and_theirs(pool: Pool<Sqlite>) {
        seed(&pool).await;
        let state = InnerDbState {
            conn_pool: pool.clone(),
        };
        let impact = state
            .get_delete_impact(CascadeTable::Variations, key(&["v1"]))
            .await
            .unwrap();
        assert_eq!(
            summary(&impact),
            vec![
                ("expression relations".to_string(), 1),
                ("allele expressions".to_string(), 1),
                ("strain alleles".to_string(), 1),
                ("alleles".to_string(), 2),
            ]
        );
        state
            .delete_with_dependents(CascadeTable::Variations, key(&["v1"]))
            .await
            .unwrap();
        assert_eq!(count(&pool, "variations").await, 1);
        assert_eq!(count(&pool, "alleles").await, 2); // a3, a4
    }

    #[sqlx::test]
    async fn deleting_a_gene_takes_its_alleles_and_the_variations_left_unused(pool: Pool<Sqlite>) {
        seed(&pool).await;
        let state = InnerDbState {
            conn_pool: pool.clone(),
        };
        // a1 (gene G) shares v1 with a2, which is not G's: v1 stays
        let impact = state
            .get_delete_impact(CascadeTable::Genes, key(&["G"]))
            .await
            .unwrap();
        assert_eq!(
            summary(&impact),
            vec![
                ("expression relations".to_string(), 1),
                ("allele expressions".to_string(), 1),
                ("strain alleles".to_string(), 1),
                ("alleles".to_string(), 1),
            ]
        );
        state
            .delete_with_dependents(CascadeTable::Genes, key(&["G"]))
            .await
            .unwrap();
        assert_eq!(count(&pool, "genes").await, 0);
        assert_eq!(count(&pool, "alleles").await, 3);
        assert_eq!(count(&pool, "variations").await, 2);
    }

    #[sqlx::test]
    async fn deleting_a_phenotype_takes_expressions_and_relations_using_it_either_way(
        pool: Pool<Sqlite>,
    ) {
        seed(&pool).await;
        let state = InnerDbState {
            conn_pool: pool.clone(),
        };
        // q only appears as an altering phenotype of a1's relation
        let impact = state
            .get_delete_impact(CascadeTable::Phenotypes, key(&["q", "false"]))
            .await
            .unwrap();
        assert_eq!(
            summary(&impact),
            vec![("expression relations".to_string(), 1)]
        );
        // p is expressed by a1 and a3: both expressions and both relations go
        let impact = state
            .get_delete_impact(CascadeTable::Phenotypes, key(&["p", "0"]))
            .await
            .unwrap();
        assert_eq!(
            summary(&impact),
            vec![
                ("expression relations".to_string(), 2),
                ("allele expressions".to_string(), 2),
            ]
        );
        state
            .delete_with_dependents(CascadeTable::Phenotypes, key(&["p", "0"]))
            .await
            .unwrap();
        assert_eq!(count(&pool, "phenotypes").await, 1);
        assert_eq!(count(&pool, "allele_exprs").await, 0);
        assert_eq!(count(&pool, "expr_relations").await, 0);
    }

    #[sqlx::test]
    async fn deleting_a_condition_a_strain_or_an_expression_takes_what_depends_on_it(
        pool: Pool<Sqlite>,
    ) {
        seed(&pool).await;
        let state = InnerDbState {
            conn_pool: pool.clone(),
        };
        state
            .delete_with_dependents(CascadeTable::Conditions, key(&["c"]))
            .await
            .unwrap();
        assert_eq!(count(&pool, "conditions").await, 0);
        assert_eq!(count(&pool, "expr_relations").await, 1);

        state
            .delete_with_dependents(CascadeTable::Strains, key(&["s"]))
            .await
            .unwrap();
        assert_eq!(count(&pool, "strains").await, 0);
        assert_eq!(count(&pool, "strain_alleles").await, 0);
        assert_eq!(count(&pool, "alleles").await, 4); // alleles stay

        state
            .delete_with_dependents(CascadeTable::AlleleExprs, key(&["a1", "p", "0"]))
            .await
            .unwrap();
        assert_eq!(count(&pool, "allele_exprs").await, 1);
        assert_eq!(count(&pool, "expr_relations").await, 0);
    }

    #[sqlx::test]
    async fn deleting_a_row_that_is_not_there_deletes_nothing(pool: Pool<Sqlite>) {
        seed(&pool).await;
        let state = InnerDbState {
            conn_pool: pool.clone(),
        };
        assert_eq!(
            state
                .delete_with_dependents(CascadeTable::Strains, key(&["nope"]))
                .await
                .unwrap(),
            0
        );
        assert_eq!(count(&pool, "strains").await, 1);
    }

    #[sqlx::test]
    async fn a_wrong_key_length_is_an_error(pool: Pool<Sqlite>) {
        let state = InnerDbState { conn_pool: pool };
        assert!(matches!(
            state
                .delete_with_dependents(CascadeTable::Phenotypes, key(&["p"]))
                .await,
            Err(DbError::Delete(_))
        ));
    }
}
