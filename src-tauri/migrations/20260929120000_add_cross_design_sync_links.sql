CREATE TABLE cross_design_sync_links (
    cross_design_id TEXT NOT NULL,
    sync_account_id TEXT NOT NULL,
    remote_parent_task_id TEXT NOT NULL,
    PRIMARY KEY (cross_design_id, sync_account_id),
    FOREIGN KEY (cross_design_id) REFERENCES cross_designs (id) ON DELETE CASCADE,
    FOREIGN KEY (sync_account_id) REFERENCES sync_accounts (id) ON DELETE CASCADE
);
