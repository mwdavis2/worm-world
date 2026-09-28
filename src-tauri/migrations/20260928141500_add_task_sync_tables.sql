CREATE TABLE sync_accounts (
    id TEXT NOT NULL PRIMARY KEY,
    provider TEXT NOT NULL,
    account_label TEXT NOT NULL,
    google_task_list_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_synced_at TEXT NULL
);

CREATE TABLE task_sync_links (
    task_id TEXT NOT NULL,
    sync_account_id TEXT NOT NULL,
    remote_id TEXT NOT NULL,
    remote_updated_at TEXT NULL,
    local_updated_at TEXT NULL,
    PRIMARY KEY (task_id, sync_account_id),
    FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
    FOREIGN KEY (sync_account_id) REFERENCES sync_accounts (id) ON DELETE CASCADE
);
