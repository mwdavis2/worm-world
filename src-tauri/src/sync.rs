pub mod google_tasks;
pub mod oauth;

use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use thiserror::Error;
use tokio::sync::{Mutex, OwnedMutexGuard};

/// One `keyring` service name for all sync accounts (entries are keyed by
/// `sync_account_id` as the username) - see `oauth::store_secret`. Only used
/// in release builds; debug builds use a local file instead (see
/// `oauth::dev_secret_path`) to avoid a Keychain-access dialog on every
/// `tauri dev` rebuild.
#[cfg(not(debug_assertions))]
pub const KEYRING_SERVICE: &str = "worm-world-task-sync";

static SYNC_LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();

/// Serializes every push/pull against one sync account - without this, two
/// concurrent calls for the *same* account (e.g. React StrictMode's
/// double-invoked mount effect, or a manual "Sync now" click racing the
/// periodic background poll) can both see "no existing link" for the same
/// task before either has written one, and both create a duplicate remote
/// task. Keyed per-account (not one global lock) so a future second provider
/// would never have to wait on this one; they'd touch different remote
/// servers and different `task_sync_links` rows, so there'd be nothing to
/// race between them in the first place. Held for the whole duration of a
/// push/pull, not just the check-then-act span, since that's the simplest
/// way to guarantee no interleaving at all.
pub(crate) async fn acquire_sync_lock(sync_account_id: &str) -> OwnedMutexGuard<()> {
    let per_account_lock = {
        let mut locks = SYNC_LOCKS
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .await;
        locks
            .entry(sync_account_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    };
    per_account_lock.lock_owned().await
}

/// Access tokens keyed by sync_account_id, cached in memory until shortly
/// before Google's own expiry. Without this, every single push/pull did its
/// own live refresh-token network round-trip to Google's OAuth endpoint -
/// harmless for one task, but "Sync now" pushes every task on every page
/// load, so a handful of tasks meant a handful of serialized refresh calls
/// (through `acquire_sync_lock`) before any of the real work even started.
static ACCESS_TOKEN_CACHE: OnceLock<Mutex<HashMap<String, (String, Instant)>>> = OnceLock::new();

/// One minute of slack before Google's own expiry, so a token already in
/// flight when it "expires" doesn't get rejected mid-request.
const ACCESS_TOKEN_EXPIRY_SLACK: Duration = Duration::from_secs(60);

pub(crate) async fn get_cached_access_token(sync_account_id: &str) -> Option<String> {
    let cache = ACCESS_TOKEN_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let guard = cache.lock().await;
    guard
        .get(sync_account_id)
        .filter(|(_, expires_at)| *expires_at > Instant::now())
        .map(|(token, _)| token.clone())
}

pub(crate) async fn cache_access_token(
    sync_account_id: &str,
    access_token: &str,
    expires_in: Option<Duration>,
) {
    let ttl = expires_in
        .unwrap_or(Duration::from_secs(3600))
        .saturating_sub(ACCESS_TOKEN_EXPIRY_SLACK);
    let cache = ACCESS_TOKEN_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    cache.lock().await.insert(
        sync_account_id.to_string(),
        (access_token.to_string(), Instant::now() + ttl),
    );
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
    #[error("Sync account is missing required configuration: {0}")]
    Config(String),
}

/// Pushes a task to every connected sync account. Currently only Google
/// Tasks is supported; `push_task` is already a no-op when no Google account
/// is connected. Kept as its own function (rather than inlining the call at
/// every call site) so a future second provider can be dispatched here
/// sequentially, per-account, without touching callers.
pub async fn push_task(
    state: &crate::interface::InnerDbState,
    task: &crate::models::task::Task,
    title: &str,
) -> Result<(), SyncError> {
    google_tasks::push_task(state, task, title).await
}

/// Pulls remote changes from every connected sync account. Currently only
/// Google Tasks is supported - see `push_task`'s doc comment.
pub async fn pull_updates(
    state: &crate::interface::InnerDbState,
) -> Result<Vec<crate::models::task::Task>, SyncError> {
    google_tasks::pull_updates(state).await
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
