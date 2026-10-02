//! Tests for the `update_<table>` methods behind the data tables' Edit
//! buttons: each changes only the non-key columns of the one row its key
//! identifies, and reports an error when no such row exists.

use super::{DbError, InnerDbState};
use crate::models::{
    allele::Allele, allele_expr::AlleleExpression, condition::Condition,
    expr_relation::ExpressionRelation, gene::Gene, phenotype::Phenotype,
    strain_allele::StrainAllele, variation::Variation,
};
use sqlx::{Pool, Sqlite};

async fn exec(pool: &Pool<Sqlite>, sql: &str) {
    sqlx::query(sql).execute(pool).await.unwrap();
}

async fn scalar<T>(pool: &Pool<Sqlite>, sql: &str) -> T
where
    T: for<'r> sqlx::Decode<'r, Sqlite> + sqlx::Type<Sqlite> + Send + Unpin,
{
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

fn is_update_error<T>(result: Result<T, DbError>) -> bool {
    matches!(result, Err(DbError::Update(_)))
}

#[sqlx::test]
async fn update_gene_changes_only_non_key_columns_of_that_gene(pool: Pool<Sqlite>) {
    exec(&pool, "INSERT INTO genes (systematic_name, descriptive_name) VALUES ('A.1', 'old'), ('B.2', 'other')").await;
    let state = InnerDbState {
        conn_pool: pool.clone(),
    };
    let gene = Gene {
        systematic_name: "A.1".into(),
        descriptive_name: Some("unc-5".into()),
        chromosome: None,
        phys_loc: Some(1234),
        gen_loc: Some(-1.5),
    };
    state.update_gene(&gene).await.unwrap();

    let name: String = scalar(
        &pool,
        "SELECT descriptive_name FROM genes WHERE systematic_name = 'A.1'",
    )
    .await;
    let loc: i64 = scalar(
        &pool,
        "SELECT phys_loc FROM genes WHERE systematic_name = 'A.1'",
    )
    .await;
    let other: String = scalar(
        &pool,
        "SELECT descriptive_name FROM genes WHERE systematic_name = 'B.2'",
    )
    .await;
    assert_eq!(
        (name.as_str(), loc, other.as_str()),
        ("unc-5", 1234, "other")
    );

    let missing = Gene {
        systematic_name: "nope".into(),
        ..gene
    };
    assert!(is_update_error(state.update_gene(&missing).await));
}

#[sqlx::test]
async fn update_condition_and_phenotype(pool: Pool<Sqlite>) {
    exec(&pool, "INSERT INTO conditions (name) VALUES ('25C')").await;
    exec(&pool, "INSERT INTO phenotypes (name, wild, short_name) VALUES ('Unc', 0, 'Unc'), ('Unc', 1, 'Unc')").await;
    let state = InnerDbState {
        conn_pool: pool.clone(),
    };

    let condition = Condition {
        name: "25C".into(),
        description: Some("warm".into()),
        male_mating: Some(3),
        lethal: Some(false),
        female_sterile: None,
        arrested: None,
        maturation_days: Some(3.0),
    };
    state.update_condition(&condition).await.unwrap();
    let days: f64 = scalar(
        &pool,
        "SELECT maturation_days FROM conditions WHERE name = '25C'",
    )
    .await;
    assert_eq!(days, 3.0);
    assert!(is_update_error(
        state
            .update_condition(&Condition {
                name: "nope".into(),
                ..condition
            })
            .await
    ));

    let phenotype = Phenotype {
        name: "Unc".into(),
        wild: false,
        short_name: "Uncoordinated".into(),
        description: None,
        male_mating: None,
        lethal: Some(true),
        female_sterile: None,
        arrested: None,
        maturation_days: None,
    };
    state.update_phenotype(&phenotype).await.unwrap();
    // Only the (Unc, wild = false) row changed, not its wild-type twin.
    let mutant: String = scalar(
        &pool,
        "SELECT short_name FROM phenotypes WHERE name = 'Unc' AND wild = 0",
    )
    .await;
    let wild: String = scalar(
        &pool,
        "SELECT short_name FROM phenotypes WHERE name = 'Unc' AND wild = 1",
    )
    .await;
    assert_eq!((mutant.as_str(), wild.as_str()), ("Uncoordinated", "Unc"));
    assert!(is_update_error(
        state
            .update_phenotype(&Phenotype {
                name: "nope".into(),
                ..phenotype
            })
            .await
    ));
}

#[sqlx::test]
async fn update_variation_and_allele(pool: Pool<Sqlite>) {
    exec(&pool, "INSERT INTO variations (allele_name) VALUES ('ed3')").await;
    exec(&pool, "INSERT INTO genes (systematic_name) VALUES ('A.1')").await;
    exec(&pool, "INSERT INTO alleles (name) VALUES ('ed3')").await;
    let state = InnerDbState {
        conn_pool: pool.clone(),
    };

    let variation = Variation {
        allele_name: "ed3".into(),
        chromosome: None,
        phys_loc: Some(99),
        gen_loc: None,
        recomb_suppressor: Some((10, 20)),
        is_location_reference: true,
        percent_loss: Some(0.25),
    };
    state.update_variation(&variation).await.unwrap();
    let start: i64 = scalar(
        &pool,
        "SELECT recomb_suppressor_start FROM variations WHERE allele_name = 'ed3'",
    )
    .await;
    let reference: bool = scalar(
        &pool,
        "SELECT is_location_reference FROM variations WHERE allele_name = 'ed3'",
    )
    .await;
    assert_eq!((start, reference), (10, true));
    assert!(is_update_error(
        state
            .update_variation(&Variation {
                allele_name: "nope".into(),
                ..variation
            })
            .await
    ));

    let allele = Allele {
        name: "ed3".into(),
        contents: Some("a deletion".into()),
        systematic_gene_name: Some("A.1".into()),
        variation_name: Some("ed3".into()),
    };
    state.update_allele(&allele).await.unwrap();
    let gene: String = scalar(
        &pool,
        "SELECT systematic_gene_name FROM alleles WHERE name = 'ed3'",
    )
    .await;
    assert_eq!(gene, "A.1");
    assert!(is_update_error(
        state
            .update_allele(&Allele {
                name: "nope".into(),
                ..allele
            })
            .await
    ));
}

#[sqlx::test]
async fn update_expressions_relations_and_strain_alleles(pool: Pool<Sqlite>) {
    exec(&pool, "INSERT INTO alleles (name) VALUES ('ed3')").await;
    exec(
        &pool,
        "INSERT INTO phenotypes (name, wild, short_name) VALUES ('Unc', 0, 'Unc')",
    )
    .await;
    exec(&pool, "INSERT INTO conditions (name) VALUES ('25C')").await;
    exec(&pool, "INSERT INTO allele_exprs (allele_name, expressing_phenotype_name, expressing_phenotype_wild, dominance) VALUES ('ed3', 'Unc', 0, 1)").await;
    exec(&pool, "INSERT INTO expr_relations (allele_name, expressing_phenotype_name, expressing_phenotype_wild, altering_condition, is_suppressing) VALUES ('ed3', 'Unc', 0, '25C', 0)").await;
    exec(
        &pool,
        "INSERT INTO strains (name, genotype) VALUES ('S1', 'g')",
    )
    .await;
    exec(&pool, "INSERT INTO strain_alleles (strain_name, allele_name, is_on_top, is_on_bot) VALUES ('S1', 'ed3', 1, 0)").await;
    let state = InnerDbState {
        conn_pool: pool.clone(),
    };

    let expr = AlleleExpression {
        allele_name: "ed3".into(),
        expressing_phenotype_name: "Unc".into(),
        expressing_phenotype_wild: false,
        dominance: 2,
    };
    state.update_allele_expr(&expr).await.unwrap();
    let dominance: i64 = scalar(
        &pool,
        "SELECT dominance FROM allele_exprs WHERE allele_name = 'ed3'",
    )
    .await;
    assert_eq!(dominance, 2);
    assert!(is_update_error(
        state
            .update_allele_expr(&AlleleExpression {
                allele_name: "nope".into(),
                ..expr
            })
            .await
    ));

    // The relation's altering_phenotype_* key columns are NULL, which must
    // still match.
    let relation = ExpressionRelation {
        allele_name: "ed3".into(),
        expressing_phenotype_name: "Unc".into(),
        expressing_phenotype_wild: false,
        altering_phenotype_name: None,
        altering_phenotype_wild: None,
        altering_condition: Some("25C".into()),
        is_suppressing: true,
    };
    state.update_expr_relation(&relation).await.unwrap();
    let suppressing: bool = scalar(
        &pool,
        "SELECT is_suppressing FROM expr_relations WHERE allele_name = 'ed3'",
    )
    .await;
    assert!(suppressing);
    assert!(is_update_error(
        state
            .update_expr_relation(&ExpressionRelation {
                altering_condition: Some("nope".into()),
                ..relation
            })
            .await
    ));

    let strain_allele = StrainAllele {
        strain_name: "S1".into(),
        allele_name: "ed3".into(),
        is_on_top: true,
        is_on_bot: true,
    };
    state.update_strain_allele(&strain_allele).await.unwrap();
    let bot: bool = scalar(
        &pool,
        "SELECT is_on_bot FROM strain_alleles WHERE strain_name = 'S1'",
    )
    .await;
    assert!(bot);
    assert!(is_update_error(
        state
            .update_strain_allele(&StrainAllele {
                strain_name: "nope".into(),
                ..strain_allele
            })
            .await
    ));
}
