use super::{DbError, InnerDbState};
use crate::models::{sync_account::SyncAccount, task_sync_link::TaskSyncLink};

impl InnerDbState {
    pub async fn get_sync_accounts(&self) -> Result<Vec<SyncAccount>, DbError> {
        match sqlx::query_as!(
            SyncAccount,
            "SELECT id, provider, account_label, google_task_list_id, created_at, last_synced_at FROM sync_accounts ORDER BY id"
        )
        .fetch_all(&self.conn_pool)
        .await
        {
            Ok(accounts) => Ok(accounts),
            Err(e) => {
                eprint!("Get sync accounts error: {e}");
                Err(DbError::Query(e.to_string()))
            }
        }
    }

    pub async fn insert_sync_account(&self, account: &SyncAccount) -> Result<(), DbError> {
        match sqlx::query!(
            "INSERT INTO sync_accounts (id, provider, account_label, google_task_list_id, created_at, last_synced_at)
            VALUES (?, ?, ?, ?, ?, ?)",
            account.id,
            account.provider,
            account.account_label,
            account.google_task_list_id,
            account.created_at,
            account.last_synced_at,
        )
        .execute(&self.conn_pool)
        .await
        {
            Ok(_) => Ok(()),
            Err(e) => {
                eprint!("Insert sync account error: {e}");
                Err(DbError::Insert(e.to_string()))
            }
        }
    }

    pub async fn delete_sync_account(&self, id: &str) -> Result<(), DbError> {
        match sqlx::query!("DELETE FROM sync_accounts WHERE id = ?", id)
            .execute(&self.conn_pool)
            .await
        {
            Ok(_) => Ok(()),
            Err(e) => {
                eprint!("Delete sync account error: {e}");
                Err(DbError::Delete(e.to_string()))
            }
        }
    }

    pub async fn update_sync_account_last_synced(
        &self,
        id: &str,
        last_synced_at: &str,
    ) -> Result<(), DbError> {
        match sqlx::query!(
            "UPDATE sync_accounts SET last_synced_at = ? WHERE id = ?",
            last_synced_at,
            id,
        )
        .execute(&self.conn_pool)
        .await
        {
            Ok(_) => Ok(()),
            Err(e) => {
                eprint!("Update sync account error: {e}");
                Err(DbError::Update(e.to_string()))
            }
        }
    }

    pub async fn get_task_sync_link(
        &self,
        task_id: &str,
        sync_account_id: &str,
    ) -> Result<Option<TaskSyncLink>, DbError> {
        match sqlx::query_as!(
            TaskSyncLink,
            "SELECT task_id, sync_account_id, remote_id, remote_updated_at, local_updated_at
            FROM task_sync_links WHERE task_id = ? AND sync_account_id = ?",
            task_id,
            sync_account_id,
        )
        .fetch_optional(&self.conn_pool)
        .await
        {
            Ok(link) => Ok(link),
            Err(e) => {
                eprint!("Get task sync link error: {e}");
                Err(DbError::Query(e.to_string()))
            }
        }
    }

    pub async fn get_task_sync_link_by_remote_id(
        &self,
        sync_account_id: &str,
        remote_id: &str,
    ) -> Result<Option<TaskSyncLink>, DbError> {
        match sqlx::query_as!(
            TaskSyncLink,
            "SELECT task_id, sync_account_id, remote_id, remote_updated_at, local_updated_at
            FROM task_sync_links WHERE sync_account_id = ? AND remote_id = ?",
            sync_account_id,
            remote_id,
        )
        .fetch_optional(&self.conn_pool)
        .await
        {
            Ok(link) => Ok(link),
            Err(e) => {
                eprint!("Get task sync link by remote id error: {e}");
                Err(DbError::Query(e.to_string()))
            }
        }
    }

    pub async fn get_task_sync_links_for_account(
        &self,
        sync_account_id: &str,
    ) -> Result<Vec<TaskSyncLink>, DbError> {
        match sqlx::query_as!(
            TaskSyncLink,
            "SELECT task_id, sync_account_id, remote_id, remote_updated_at, local_updated_at
            FROM task_sync_links WHERE sync_account_id = ?",
            sync_account_id,
        )
        .fetch_all(&self.conn_pool)
        .await
        {
            Ok(links) => Ok(links),
            Err(e) => {
                eprint!("Get task sync links for account error: {e}");
                Err(DbError::Query(e.to_string()))
            }
        }
    }

    pub async fn upsert_task_sync_link(&self, link: &TaskSyncLink) -> Result<(), DbError> {
        match sqlx::query!(
            "INSERT INTO task_sync_links (task_id, sync_account_id, remote_id, remote_updated_at, local_updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(task_id, sync_account_id) DO UPDATE SET
                remote_id = excluded.remote_id,
                remote_updated_at = excluded.remote_updated_at,
                local_updated_at = excluded.local_updated_at",
            link.task_id,
            link.sync_account_id,
            link.remote_id,
            link.remote_updated_at,
            link.local_updated_at,
        )
        .execute(&self.conn_pool)
        .await
        {
            Ok(_) => Ok(()),
            Err(e) => {
                eprint!("Upsert task sync link error: {e}");
                Err(DbError::Insert(e.to_string()))
            }
        }
    }
}

#[cfg(test)]
mod test {
    use crate::models::sync_account::SyncAccount;
    use crate::models::task_sync_link::TaskSyncLink;
    use crate::InnerDbState;
    use anyhow::Result;
    use pretty_assertions::assert_eq;
    use sqlx::{Pool, Sqlite};

    fn test_account() -> SyncAccount {
        SyncAccount {
            id: "acct1".to_string(),
            provider: "google".to_string(),
            account_label: "person@example.com".to_string(),
            google_task_list_id: "list1".to_string(),
            created_at: "2026-09-28T00:00:00Z".to_string(),
            last_synced_at: None,
        }
    }

    #[sqlx::test]
    async fn test_insert_and_get_sync_accounts(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };
        let account = test_account();

        state.insert_sync_account(&account).await?;
        let accounts = state.get_sync_accounts().await?;

        assert_eq!(vec![account], accounts);
        Ok(())
    }

    #[sqlx::test]
    async fn test_update_sync_account_last_synced(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };
        let account = test_account();
        state.insert_sync_account(&account).await?;

        state
            .update_sync_account_last_synced("acct1", "2026-09-29T00:00:00Z")
            .await?;
        let accounts = state.get_sync_accounts().await?;

        assert_eq!(
            accounts[0].last_synced_at,
            Some("2026-09-29T00:00:00Z".to_string())
        );
        Ok(())
    }

    #[sqlx::test]
    async fn test_delete_sync_account(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };
        let account = test_account();
        state.insert_sync_account(&account).await?;

        state.delete_sync_account("acct1").await?;
        let accounts = state.get_sync_accounts().await?;

        assert_eq!(accounts.len(), 0);
        Ok(())
    }

    #[sqlx::test(fixtures("full_db"))]
    async fn test_upsert_task_sync_link(pool: Pool<Sqlite>) -> Result<()> {
        let state = InnerDbState { conn_pool: pool };
        let account = test_account();
        state.insert_sync_account(&account).await?;

        let link = TaskSyncLink {
            task_id: "1".to_string(),
            sync_account_id: "acct1".to_string(),
            remote_id: "remote1".to_string(),
            remote_updated_at: Some("2026-09-28T00:00:00Z".to_string()),
            local_updated_at: Some("2026-09-28T00:00:00Z".to_string()),
        };
        state.upsert_task_sync_link(&link).await?;

        let fetched = state.get_task_sync_link("1", "acct1").await?;
        assert_eq!(fetched, Some(link.clone()));

        let by_remote = state
            .get_task_sync_link_by_remote_id("acct1", "remote1")
            .await?;
        assert_eq!(by_remote, Some(link.clone()));

        // Upsert again with an updated remote_updated_at - should update in place, not duplicate.
        let updated_link = TaskSyncLink {
            remote_updated_at: Some("2026-09-29T00:00:00Z".to_string()),
            ..link
        };
        state.upsert_task_sync_link(&updated_link).await?;
        let links = state.get_task_sync_links_for_account("acct1").await?;
        assert_eq!(links, vec![updated_link]);

        Ok(())
    }
}
