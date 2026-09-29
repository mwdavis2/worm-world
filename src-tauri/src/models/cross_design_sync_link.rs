// Correlates a `CrossDesign` to the Google Tasks "parent" task created to
// group all of its tasks together in the Tasks UI - see
// `sync::google_tasks::ensure_cross_design_parent`. Internal bookkeeping
// only; not exposed to the frontend.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct CrossDesignSyncLink {
    pub cross_design_id: String,
    pub sync_account_id: String,
    pub remote_parent_task_id: String,
}
