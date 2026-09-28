pub mod google_tasks;
pub mod oauth;

use serde::Serialize;
use std::sync::OnceLock;
use thiserror::Error;
use tokio::sync::{Mutex, MutexGuard};

/// One `keyring` service name for all sync accounts (entries are keyed by
/// `sync_account_id` as the username) - see `oauth::store_refresh_token`.
/// Only used in release builds; debug builds use a local file instead (see
/// `oauth::dev_token_path`) to avoid a Keychain-access dialog on every
/// `tauri dev` rebuild.
#[cfg(not(debug_assertions))]
pub const KEYRING_SERVICE: &str = "worm-world-task-sync";

static SYNC_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

/// Serializes every push/pull against Google Tasks - without this, two
/// concurrent calls (e.g. React StrictMode's double-invoked mount effect, or
/// a manual "Sync now" click racing the periodic background poll) can both
/// see "no existing link" for the same task before either has written one,
/// and both create a duplicate remote task. Phase 1 only supports a single
/// account, so a single global lock is sufficient - held for the whole
/// duration of a push/pull, not just the check-then-act span, since that's
/// the simplest way to guarantee no interleaving at all.
pub(crate) async fn acquire_sync_lock() -> MutexGuard<'static, ()> {
    SYNC_LOCK.get_or_init(|| Mutex::new(())).lock().await
}

#[derive(Error, Debug, Serialize)]
pub enum SyncError {
    #[error("OAuth error: {0}")]
    OAuth(String),
    #[error("HTTP error: {0}")]
    Http(String),
    #[error("Keyring error: {0}")]
    Keyring(String),
    #[error("Database error: {0}")]
    Db(String),
    #[error("Timed out waiting for the browser sign-in to complete")]
    AuthTimeout,
    #[error("Google account is missing required configuration: {0}")]
    Config(String),
}

impl From<crate::interface::DbError> for SyncError {
    fn from(e: crate::interface::DbError) -> Self {
        SyncError::Db(e.to_string())
    }
}

impl From<reqwest::Error> for SyncError {
    fn from(e: reqwest::Error) -> Self {
        SyncError::Http(e.to_string())
    }
}

impl From<keyring::Error> for SyncError {
    fn from(e: keyring::Error) -> Self {
        SyncError::Keyring(e.to_string())
    }
}
