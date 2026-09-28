// Correlates a local `Task` to its remote resource on a connected sync
// account (currently only Google Tasks), plus the last-seen "updated"
// timestamp from both sides - the basis for the last-write-wins conflict
// check in `sync::google_tasks::pull_updates`. Internal bookkeeping only;
// not exposed to the frontend.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct TaskSyncLink {
    pub task_id: String,
    pub sync_account_id: String,
    pub remote_id: String,
    pub remote_updated_at: Option<String>,
    pub local_updated_at: Option<String>,
}
