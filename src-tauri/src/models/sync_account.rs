use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, TS, sqlx::FromRow)]
#[ts(export, export_to = "../src/models/db/sync/db_SyncAccount.ts")]
#[serde(rename = "db_SyncAccount")]
pub struct SyncAccount {
    pub id: String,
    pub provider: String,
    #[serde(rename = "accountLabel")]
    pub account_label: String,
    #[serde(rename = "googleTaskListId")]
    pub google_task_list_id: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "lastSyncedAt")]
    pub last_synced_at: Option<String>,
}
