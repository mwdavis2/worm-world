#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]
use anyhow::Result;
use directories::ProjectDirs;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    Pool, Sqlite,
};
use std::{path::Path, str::FromStr, time::Duration};
use tauri::Manager;
use thiserror::Error;
use tokio::sync::RwLock;

mod interface;
use interface::{
    cascade::{CascadeTable, DependentRows},
    design_bundle::DesignBundleSummary,
    folder_import::TableImport,
    DbError, InnerDbState,
};

mod models;
use models::{
    allele::{Allele, AlleleFieldName},
    allele_expr::{AlleleExpression, AlleleExpressionFieldName},
    condition::{Condition, ConditionFieldName},
    cross_design::{CrossDesign, CrossDesignFieldName},
    expr_relation::{ExpressionRelation, ExpressionRelationFieldName},
    filter::FilterGroup,
    gene::{Gene, GeneFieldName},
    phenotype::{Phenotype, PhenotypeFieldName},
    strain::{Strain, StrainFieldName},
    strain_allele::{StrainAllele, StrainAlleleFieldName},
    sync_account::SyncAccount,
    task::{Task, TaskFieldName},
    variation::{Variation, VariationFieldName},
};

mod sync;
use sync::SyncError;

/// How often the app polls Google Tasks for remote changes while running -
/// Neither Google Tasks nor CalDAV support push/webhook notifications, so
/// periodic polling (plus a pull on launch and a manual "Sync now") is the
/// only way to pick up changes made on the remote side (e.g. checking a task
/// off on a phone).
const SYNC_POLL_INTERVAL: Duration = Duration::from_secs(300);

#[tokio::main]
async fn main() {
    // Populates GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET (and anything else in
    // src-tauri/.env) into the process environment; harmless if the file is
    // absent (e.g. a build with sync not configured).
    dotenvy::dotenv().ok();

    let pool = sqlite_setup()
        .await
        .expect("Failed to set up sqlite3 database.");

    tauri::Builder::default()
        .manage(DbState(RwLock::new(InnerDbState { conn_pool: pool })))
        .setup(|app| {
            let handle = app.handle();
            tokio::spawn(async move {
                let mut interval = tokio::time::interval(SYNC_POLL_INTERVAL);
                loop {
                    interval.tick().await;
                    let state = handle.state::<DbState>();
                    let state_guard = state.0.read().await;
                    if let Err(e) = sync::pull_updates(&state_guard).await {
                        eprintln!("Background task sync failed: {e}");
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // genes
            get_genes,
            get_filtered_genes,
            get_count_filtered_genes,
            insert_gene,
            insert_genes_from_file,
            import_data_tables_zip,
            read_bundle_design,
            export_design_bundle,
            delete_filtered_genes,
            // conditions
            get_conditions,
            get_filtered_conditions,
            get_count_filtered_conditions,
            get_altering_conditions,
            insert_condition,
            insert_conditions_from_file,
            delete_filtered_conditions,
            // phenotypes
            get_phenotypes,
            get_filtered_phenotypes,
            get_count_filtered_phenotypes,
            get_altering_phenotypes,
            insert_phenotype,
            insert_phenotypes_from_file,
            delete_filtered_phenotypes,
            // variations
            get_variations,
            get_filtered_variations,
            get_count_filtered_variations,
            get_location_reference_variations,
            insert_variation,
            insert_variations_from_file,
            delete_filtered_variations,
            // allele_exprs
            get_allele_exprs,
            get_filtered_allele_exprs,
            get_count_filtered_allele_exprs,
            insert_allele_expr,
            insert_allele_exprs_from_file,
            delete_filtered_allele_exprs,
            // alleles
            get_alleles,
            get_filtered_alleles,
            get_count_filtered_alleles,
            get_unused_allele_names,
            get_unused_variation_names,
            get_unused_phenotype_keys,
            get_filtered_alleles_with_gene_filter,
            insert_allele,
            insert_alleles_from_file,
            delete_filtered_alleles,
            // expr_relations
            get_expr_relations,
            get_filtered_expr_relations,
            get_count_filtered_expr_relations,
            insert_expr_relation,
            insert_expr_relations_from_file,
            delete_filtered_expr_relations,
            // tasks
            get_tasks,
            get_filtered_tasks,
            insert_task,
            update_task,
            delete_task,
            delete_tasks,
            delete_all_tasks,
            // task sync
            get_sync_accounts,
            connect_google_tasks,
            disconnect_google_tasks,
            push_task_to_sync_accounts,
            sync_all_accounts_now,
            // cross_designs
            get_cross_designs,
            get_filtered_cross_designs,
            insert_cross_design,
            update_cross_design,
            delete_cross_design,
            // strains
            get_strains,
            get_filtered_strains,
            get_count_filtered_strains,
            insert_strain,
            insert_strains_from_file,
            update_gene,
            update_condition,
            update_phenotype,
            update_variation,
            update_allele,
            update_allele_expr,
            update_expr_relation,
            update_strain_allele,
            update_strain,
            delete_filtered_strains,
            get_delete_impact,
            delete_with_dependents,
            // strain_alleles,
            get_strain_alleles,
            get_filtered_strain_alleles,
            get_count_filtered_strain_alleles,
            insert_strain_allele,
            insert_strain_alleles_from_file,
            delete_filtered_strain_alleles,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub struct DbState(pub RwLock<InnerDbState>);

#[derive(Error, Debug)]
pub enum SqlSetupError {
    #[error("Failed to get valid project data directory from OS")]
    NoProjectDir,
}

async fn sqlite_setup() -> Result<Pool<Sqlite>> {
    let proj_dirs =
        ProjectDirs::from("edu", "UofUBiology", "WormWorld").ok_or(SqlSetupError::NoProjectDir)?;
    let database_dir = proj_dirs.data_dir().join("db");
    std::fs::create_dir_all(database_dir.clone())?;

    let database_file = database_dir.join("worm.sqlite");
    let database_url = format!("sqlite:///{}", database_file.to_str().unwrap());
    println!("{}", database_url);

    // Must be checked before connecting, which creates the file.
    let first_run = interface::seed::is_first_run(&database_file);
    let sqlite_pool = connect_and_migrate(&database_url).await?;

    if first_run {
        let state = InnerDbState {
            conn_pool: sqlite_pool.clone(),
        };
        if let Err(err) = state.seed_defaults().await {
            // A brand-new database holds no user data, so rather than keep a
            // half-seeded one, start over with a clean empty database and
            // let the app run (the tables are just empty).
            eprintln!("Could not load the default data on first run: {err}");
            sqlite_pool.close().await;
            interface::seed::remove_database_files(&database_file);
            return connect_and_migrate(&database_url).await;
        }
    }

    Ok(sqlite_pool)
}

async fn connect_and_migrate(database_url: &str) -> Result<Pool<Sqlite>> {
    let pool_timeout = Duration::from_secs(30);
    let connection_options = SqliteConnectOptions::from_str(database_url)?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(pool_timeout);

    let sqlite_pool = SqlitePoolOptions::new()
        .max_connections(100)
        .acquire_timeout(pool_timeout)
        .connect_with(connection_options)
        .await?;

    sqlx::migrate!().run(&sqlite_pool).await?;

    Ok(sqlite_pool)
}

/* #region genes */
#[tauri::command]
async fn get_genes(state: tauri::State<'_, DbState>) -> Result<Vec<Gene>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_genes().await
}

#[tauri::command]
async fn get_filtered_genes(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<GeneFieldName>,
) -> Result<Vec<Gene>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_filtered_genes(&filter).await
}

#[tauri::command]
async fn get_count_filtered_genes(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<GeneFieldName>,
) -> Result<u32, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_count_filtered_genes(&filter).await
}

#[tauri::command]
async fn insert_gene(state: tauri::State<'_, DbState>, gene: Gene) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.insert_gene(&gene).await
}

#[tauri::command]
async fn insert_genes_from_file(
    state: tauri::State<'_, DbState>,
    path: String,
) -> Result<TableImport, DbError> {
    let state_guard = state.0.read().await;
    state_guard
        .import_table_file("genes", Path::new(&path))
        .await
}

/// Imports every table file in a zip archive (genes.csv, alleles.csv, ...) in
/// one transaction (see `interface::folder_import`). A cross design, if given,
/// is added in the same transaction (the design of a design bundle).
#[tauri::command]
async fn import_data_tables_zip(
    state: tauri::State<'_, DbState>,
    path: String,
    cross_design: Option<CrossDesign>,
) -> Result<Vec<TableImport>, DbError> {
    let state_guard = state.0.read().await;
    state_guard
        .import_archive(Path::new(&path), cross_design.as_ref())
        .await
}

/// The design inside a design bundle (`design.ww.json`), or `None` if the zip
/// holds only data tables.
#[tauri::command]
async fn read_bundle_design(path: String) -> Result<Option<String>, DbError> {
    InnerDbState::read_bundle_design(Path::new(&path))
}

/// Writes a cross design bundled with the data table rows it needs (see
/// `interface::design_bundle`).
#[tauri::command]
async fn export_design_bundle(
    state: tauri::State<'_, DbState>,
    path: String,
    design_json: String,
    allele_names: Vec<String>,
    strain_names: Vec<String>,
) -> Result<DesignBundleSummary, DbError> {
    let state_guard = state.0.read().await;
    state_guard
        .export_design_bundle(Path::new(&path), &design_json, &allele_names, &strain_names)
        .await
}

#[tauri::command]
async fn delete_filtered_genes(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<GeneFieldName>,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.delete_filtered_genes(&filter).await
}
/* #endregion genes */

/* #region conditions */
#[tauri::command]
async fn get_conditions(state: tauri::State<'_, DbState>) -> Result<Vec<Condition>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_conditions().await
}

#[tauri::command]
async fn get_filtered_conditions(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<ConditionFieldName>,
) -> Result<Vec<Condition>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_filtered_conditions(&filter).await
}

#[tauri::command]
async fn get_count_filtered_conditions(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<ConditionFieldName>,
) -> Result<u32, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_count_filtered_conditions(&filter).await
}

#[tauri::command]
async fn get_altering_conditions(
    state: tauri::State<'_, DbState>,
    expr_relation_filter: FilterGroup<ExpressionRelationFieldName>,
    condition_filter: FilterGroup<ConditionFieldName>,
) -> Result<Vec<Condition>, DbError> {
    let state_guard = state.0.read().await;
    state_guard
        .get_altering_conditions(&expr_relation_filter, &condition_filter)
        .await
}

#[tauri::command]
async fn insert_condition(
    state: tauri::State<'_, DbState>,
    condition: Condition,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.insert_condition(&condition).await
}

#[tauri::command]
async fn insert_conditions_from_file(
    state: tauri::State<'_, DbState>,
    path: String,
) -> Result<TableImport, DbError> {
    let state_guard = state.0.read().await;
    state_guard
        .import_table_file("conditions", Path::new(&path))
        .await
}

#[tauri::command]
async fn delete_filtered_conditions(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<ConditionFieldName>,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.delete_filtered_conditions(&filter).await
}
/* #endregion conditions */

/* #region phenotypes */
#[tauri::command]
async fn get_phenotypes(state: tauri::State<'_, DbState>) -> Result<Vec<Phenotype>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_phenotypes().await
}

#[tauri::command]
async fn get_filtered_phenotypes(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<PhenotypeFieldName>,
) -> Result<Vec<Phenotype>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_filtered_phenotypes(&filter).await
}

#[tauri::command]
async fn get_count_filtered_phenotypes(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<PhenotypeFieldName>,
) -> Result<u32, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_count_filtered_phenotypes(&filter).await
}

#[tauri::command]
async fn get_altering_phenotypes(
    state: tauri::State<'_, DbState>,
    expr_relation_filter: FilterGroup<ExpressionRelationFieldName>,
    phenotype_filter: FilterGroup<PhenotypeFieldName>,
) -> Result<Vec<Phenotype>, DbError> {
    let state_guard = state.0.read().await;
    state_guard
        .get_altering_phenotypes(&expr_relation_filter, &phenotype_filter)
        .await
}

#[tauri::command]
async fn insert_phenotype(
    state: tauri::State<'_, DbState>,
    phenotype: Phenotype,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.insert_phenotype(&phenotype).await
}

#[tauri::command]
async fn insert_phenotypes_from_file(
    state: tauri::State<'_, DbState>,
    path: String,
) -> Result<TableImport, DbError> {
    let state_guard = state.0.read().await;
    state_guard
        .import_table_file("phenotypes", Path::new(&path))
        .await
}
#[tauri::command]
async fn delete_filtered_phenotypes(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<PhenotypeFieldName>,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.delete_filtered_phenotypes(&filter).await
}
/* #endregion phenotypes */

/* #region variations */
#[tauri::command]
async fn get_variations(state: tauri::State<'_, DbState>) -> Result<Vec<Variation>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_variations().await
}

#[tauri::command]
async fn get_filtered_variations(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<VariationFieldName>,
) -> Result<Vec<Variation>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_filtered_variations(&filter).await
}

#[tauri::command]
async fn get_count_filtered_variations(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<VariationFieldName>,
) -> Result<u32, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_count_filtered_variations(&filter).await
}

#[tauri::command]
async fn get_location_reference_variations(
    state: tauri::State<'_, DbState>,
) -> Result<Vec<Variation>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_location_reference_variations().await
}

#[tauri::command]
async fn insert_variation(
    state: tauri::State<'_, DbState>,
    variation: Variation,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.insert_variation(&variation).await
}

#[tauri::command]
async fn insert_variations_from_file(
    state: tauri::State<'_, DbState>,
    path: String,
) -> Result<TableImport, DbError> {
    let state_guard = state.0.read().await;
    state_guard
        .import_table_file("variations", Path::new(&path))
        .await
}

#[tauri::command]
async fn delete_filtered_variations(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<VariationFieldName>,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.delete_filtered_variations(&filter).await
}
/* #endregion variations */

/* #region allele_exprs */
#[tauri::command]
async fn get_allele_exprs(
    state: tauri::State<'_, DbState>,
) -> Result<Vec<AlleleExpression>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_allele_exprs().await
}

#[tauri::command]
async fn get_filtered_allele_exprs(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<AlleleExpressionFieldName>,
) -> Result<Vec<AlleleExpression>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_filtered_allele_exprs(&filter).await
}

#[tauri::command]
async fn get_count_filtered_allele_exprs(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<AlleleExpressionFieldName>,
) -> Result<u32, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_count_filtered_allele_exprs(&filter).await
}

#[tauri::command]
async fn insert_allele_expr(
    state: tauri::State<'_, DbState>,
    allele_expr: AlleleExpression,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.insert_allele_expr(&allele_expr).await
}

#[tauri::command]
async fn insert_allele_exprs_from_file(
    state: tauri::State<'_, DbState>,
    path: String,
) -> Result<TableImport, DbError> {
    let state_guard = state.0.read().await;
    state_guard
        .import_table_file("allele_exprs", Path::new(&path))
        .await
}

#[tauri::command]
async fn delete_filtered_allele_exprs(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<AlleleExpressionFieldName>,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.delete_filtered_allele_exprs(&filter).await
}

#[tauri::command]
async fn get_alleles(state: tauri::State<'_, DbState>) -> Result<Vec<Allele>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_alleles().await
}

#[tauri::command]
async fn get_filtered_alleles(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<AlleleFieldName>,
) -> Result<Vec<Allele>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_filtered_alleles(&filter).await
}

#[tauri::command]
async fn get_count_filtered_alleles(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<AlleleFieldName>,
) -> Result<u32, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_count_filtered_alleles(&filter).await
}

#[tauri::command]
async fn get_unused_allele_names(state: tauri::State<'_, DbState>) -> Result<Vec<String>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_unused_allele_names().await
}

#[tauri::command]
async fn get_unused_variation_names(
    state: tauri::State<'_, DbState>,
) -> Result<Vec<String>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_unused_variation_names().await
}

#[tauri::command]
async fn get_unused_phenotype_keys(
    state: tauri::State<'_, DbState>,
) -> Result<Vec<(String, bool)>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_unused_phenotype_keys().await
}

#[tauri::command]
async fn get_filtered_alleles_with_gene_filter(
    state: tauri::State<'_, DbState>,
    allele_filter: FilterGroup<AlleleFieldName>,
    gene_filter: FilterGroup<GeneFieldName>,
) -> Result<Vec<(Allele, Gene)>, DbError> {
    let state_guard = state.0.read().await;
    state_guard
        .get_filtered_alleles_with_gene_filter(&allele_filter, &gene_filter)
        .await
}

#[tauri::command]
async fn insert_allele(state: tauri::State<'_, DbState>, allele: Allele) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.insert_allele(&allele).await
}

#[tauri::command]
async fn insert_alleles_from_file(
    state: tauri::State<'_, DbState>,
    path: String,
) -> Result<TableImport, DbError> {
    let state_guard = state.0.read().await;
    state_guard
        .import_table_file("alleles", Path::new(&path))
        .await
}

#[tauri::command]
async fn delete_filtered_alleles(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<AlleleFieldName>,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.delete_filtered_alleles(&filter).await
}

#[tauri::command]
async fn get_expr_relations(
    state: tauri::State<'_, DbState>,
) -> Result<Vec<ExpressionRelation>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_expr_relations().await
}

#[tauri::command]
async fn get_filtered_expr_relations(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<ExpressionRelationFieldName>,
) -> Result<Vec<ExpressionRelation>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_filtered_expr_relations(&filter).await
}

#[tauri::command]
async fn get_count_filtered_expr_relations(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<ExpressionRelationFieldName>,
) -> Result<u32, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_count_filtered_expr_relations(&filter).await
}

#[tauri::command]
async fn insert_expr_relation(
    state: tauri::State<'_, DbState>,
    expr_relation: ExpressionRelation,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.insert_expr_relation(&expr_relation).await
}

#[tauri::command]
async fn insert_expr_relations_from_file(
    state: tauri::State<'_, DbState>,
    path: String,
) -> Result<TableImport, DbError> {
    let state_guard = state.0.read().await;
    state_guard
        .import_table_file("expr_relations", Path::new(&path))
        .await
}
#[tauri::command]
async fn delete_filtered_expr_relations(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<ExpressionRelationFieldName>,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.delete_filtered_expr_relations(&filter).await
}

#[tauri::command]
async fn get_tasks(state: tauri::State<'_, DbState>) -> Result<Vec<Task>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_tasks().await
}

#[tauri::command]
async fn get_filtered_tasks(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<TaskFieldName>,
) -> Result<Vec<Task>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_filtered_tasks(&filter).await
}
#[tauri::command]
async fn insert_task(state: tauri::State<'_, DbState>, task: Task) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.insert_task(&task).await
}

#[tauri::command]
async fn update_task(state: tauri::State<'_, DbState>, task: Task) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.update_task(&task).await
}

#[tauri::command]
async fn delete_task(state: tauri::State<'_, DbState>, id: String) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.delete_task(id).await
}

#[tauri::command]
async fn delete_tasks(
    state: tauri::State<'_, DbState>,
    cross_design: String,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.delete_tasks(cross_design).await
}

#[tauri::command]
async fn delete_all_tasks(state: tauri::State<'_, DbState>) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.delete_all_tasks().await
}

#[tauri::command]
async fn get_sync_accounts(state: tauri::State<'_, DbState>) -> Result<Vec<SyncAccount>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_sync_accounts().await
}

#[tauri::command]
async fn connect_google_tasks(
    state: tauri::State<'_, DbState>,
    app_handle: tauri::AppHandle,
) -> Result<SyncAccount, SyncError> {
    let state_guard = state.0.read().await;
    sync::google_tasks::connect(&state_guard, &app_handle).await
}

#[tauri::command]
async fn disconnect_google_tasks(
    state: tauri::State<'_, DbState>,
    sync_account_id: String,
) -> Result<(), SyncError> {
    let state_guard = state.0.read().await;
    sync::google_tasks::disconnect(&state_guard, &sync_account_id).await
}

#[tauri::command]
async fn push_task_to_sync_accounts(
    state: tauri::State<'_, DbState>,
    task: Task,
    title: String,
) -> Result<(), SyncError> {
    let state_guard = state.0.read().await;
    sync::push_task(&state_guard, &task, &title).await
}

#[tauri::command]
async fn sync_all_accounts_now(state: tauri::State<'_, DbState>) -> Result<Vec<Task>, SyncError> {
    let state_guard = state.0.read().await;
    sync::pull_updates(&state_guard).await
}

#[tauri::command]
async fn get_cross_designs(state: tauri::State<'_, DbState>) -> Result<Vec<CrossDesign>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_cross_designs().await
}

#[tauri::command]
async fn get_filtered_cross_designs(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<CrossDesignFieldName>,
) -> Result<Vec<CrossDesign>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_filtered_cross_designs(&filter).await
}

#[tauri::command]
async fn insert_cross_design(
    state: tauri::State<'_, DbState>,
    cross_design: CrossDesign,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.insert_cross_design(&cross_design).await
}

#[tauri::command]
async fn update_cross_design(
    state: tauri::State<'_, DbState>,
    cross_design: CrossDesign,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.update_cross_design(&cross_design).await
}

#[tauri::command]
async fn delete_cross_design(state: tauri::State<'_, DbState>, id: String) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.delete_cross_design(id).await
}

#[tauri::command]
async fn get_strains(state: tauri::State<'_, DbState>) -> Result<Vec<Strain>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_strains().await
}

#[tauri::command]
async fn get_count_filtered_strains(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<StrainFieldName>,
) -> Result<u32, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_count_filtered_strains(&filter).await
}

#[tauri::command]
async fn get_filtered_strains(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<StrainFieldName>,
) -> Result<Vec<Strain>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_filtered_strains(&filter).await
}

#[tauri::command]
async fn insert_strain(state: tauri::State<'_, DbState>, strain: Strain) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.insert_strain(&strain).await
}

#[tauri::command]
async fn insert_strains_from_file(
    state: tauri::State<'_, DbState>,
    path: String,
) -> Result<TableImport, DbError> {
    let state_guard = state.0.read().await;
    state_guard
        .import_table_file("strains", Path::new(&path))
        .await
}

#[tauri::command]
async fn update_gene(state: tauri::State<'_, DbState>, gene: Gene) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.update_gene(&gene).await
}

#[tauri::command]
async fn update_condition(
    state: tauri::State<'_, DbState>,
    condition: Condition,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.update_condition(&condition).await
}

#[tauri::command]
async fn update_phenotype(
    state: tauri::State<'_, DbState>,
    phenotype: Phenotype,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.update_phenotype(&phenotype).await
}

#[tauri::command]
async fn update_variation(
    state: tauri::State<'_, DbState>,
    variation: Variation,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.update_variation(&variation).await
}

#[tauri::command]
async fn update_allele(state: tauri::State<'_, DbState>, allele: Allele) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.update_allele(&allele).await
}

#[tauri::command]
async fn update_allele_expr(
    state: tauri::State<'_, DbState>,
    allele_expr: AlleleExpression,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.update_allele_expr(&allele_expr).await
}

#[tauri::command]
async fn update_expr_relation(
    state: tauri::State<'_, DbState>,
    expr_relation: ExpressionRelation,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.update_expr_relation(&expr_relation).await
}

#[tauri::command]
async fn update_strain_allele(
    state: tauri::State<'_, DbState>,
    strain_allele: StrainAllele,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.update_strain_allele(&strain_allele).await
}

#[tauri::command]
async fn update_strain(
    state: tauri::State<'_, DbState>,
    name: String,
    new_strain: Strain,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.update_strain(name, new_strain).await
}

#[tauri::command]
async fn delete_filtered_strains(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<StrainFieldName>,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.delete_filtered_strains(&filter).await
}
/* #endregion strains */

/* #region cascading deletes */
#[tauri::command]
async fn get_delete_impact(
    state: tauri::State<'_, DbState>,
    table: CascadeTable,
    key: Vec<String>,
) -> Result<Vec<DependentRows>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_delete_impact(table, key).await
}

#[tauri::command]
async fn delete_with_dependents(
    state: tauri::State<'_, DbState>,
    table: CascadeTable,
    key: Vec<String>,
) -> Result<u32, DbError> {
    let state_guard = state.0.read().await;
    state_guard.delete_with_dependents(table, key).await
}
/* #endregion cascading deletes */

/* #region strain_alleles */
#[tauri::command]
async fn get_strain_alleles(
    state: tauri::State<'_, DbState>,
) -> Result<Vec<StrainAllele>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_strain_alleles().await
}

#[tauri::command]
async fn get_count_filtered_strain_alleles(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<StrainAlleleFieldName>,
) -> Result<u32, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_count_filtered_strain_alleles(&filter).await
}

#[tauri::command]
async fn get_filtered_strain_alleles(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<StrainAlleleFieldName>,
) -> Result<Vec<StrainAllele>, DbError> {
    let state_guard = state.0.read().await;
    state_guard.get_filtered_strain_alleles(&filter).await
}

#[tauri::command]
async fn insert_strain_allele(
    state: tauri::State<'_, DbState>,
    strain_allele: StrainAllele,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.insert_strain_allele(&strain_allele).await
}

#[tauri::command]
async fn insert_strain_alleles_from_file(
    state: tauri::State<'_, DbState>,
    path: String,
) -> Result<TableImport, DbError> {
    let state_guard = state.0.read().await;
    state_guard
        .import_table_file("strain_alleles", Path::new(&path))
        .await
}

#[tauri::command]
async fn delete_filtered_strain_alleles(
    state: tauri::State<'_, DbState>,
    filter: FilterGroup<StrainAlleleFieldName>,
) -> Result<(), DbError> {
    let state_guard = state.0.read().await;
    state_guard.delete_filtered_strain_alleles(&filter).await
}
