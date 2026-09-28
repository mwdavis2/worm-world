use super::oauth::{self, GoogleOAuthConfig};
use super::SyncError;
use crate::interface::InnerDbState;
use crate::models::sync_account::SyncAccount;
use crate::models::task::Task;
use crate::models::task_sync_link::TaskSyncLink;
use chrono::Utc;
use oauth2::TokenResponse;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const TASKS_API_BASE: &str = "https://tasks.googleapis.com/tasks/v1";
const USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v2/userinfo";

/// worm-world syncs into its own dedicated Google Tasks list rather than a
/// user's existing "My Tasks" list, so it never mixes with - or clutters -
/// tasks the user already manages there.
const WORM_WORLD_LIST_TITLE: &str = "Worm World";

#[derive(Deserialize)]
struct TaskListsResponse {
    #[serde(default)]
    items: Vec<GoogleTaskList>,
}

#[derive(Deserialize)]
struct GoogleTaskList {
    id: String,
    title: String,
}

#[derive(Serialize)]
struct TaskListCreate<'a> {
    title: &'a str,
}

#[derive(Deserialize)]
struct UserInfo {
    email: String,
}

#[derive(Serialize)]
struct GoogleTaskUpsert<'a> {
    title: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    notes: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    due: Option<String>,
    status: &'static str,
}

#[derive(Deserialize)]
struct GoogleTask {
    id: String,
    #[serde(default)]
    due: Option<String>,
    status: String,
    updated: String,
}

#[derive(Deserialize)]
struct GoogleTasksListResponse {
    #[serde(default)]
    items: Vec<GoogleTask>,
}

/// Google Tasks' `due` field only honors the date portion (time is ignored /
/// forced to midnight UTC) - reformat worm-world's stored due_date into an
/// RFC3339 midnight-UTC timestamp so the two representations agree on what
/// "the due date" means, avoiding an off-by-one day from timezone drift.
fn to_google_due_date(due_date: &str) -> Option<String> {
    let date = chrono::DateTime::parse_from_rfc3339(due_date)
        .map(|dt| dt.date_naive())
        .or_else(|_| chrono::NaiveDate::parse_from_str(due_date, "%Y-%m-%d"))
        .ok()?;
    Some(chrono::DateTime::<Utc>::from_utc(date.and_hms_opt(0, 0, 0)?, Utc).to_rfc3339())
}

async fn get_access_token(
    config: &GoogleOAuthConfig,
    sync_account_id: &str,
) -> Result<String, SyncError> {
    let refresh_token = oauth::get_refresh_token(sync_account_id)?;
    let token = oauth::refresh_access_token(config, &refresh_token).await?;
    Ok(token.access_token().secret().clone())
}

/// Finds the "Worm World" list from a prior connection, or creates it if this
/// is the first time connecting - never reuses the account's default "My
/// Tasks" list, so worm-world's own tasks stay out of a user's existing ones.
async fn get_or_create_worm_world_list(
    http: &reqwest::Client,
    access_token: &str,
) -> Result<String, SyncError> {
    let lists = http
        .get(format!("{TASKS_API_BASE}/users/@me/lists"))
        .bearer_auth(access_token)
        .send()
        .await?
        .error_for_status()?
        .json::<TaskListsResponse>()
        .await?;

    if let Some(existing) = lists
        .items
        .into_iter()
        .find(|list| list.title == WORM_WORLD_LIST_TITLE)
    {
        return Ok(existing.id);
    }

    let created = http
        .post(format!("{TASKS_API_BASE}/users/@me/lists"))
        .bearer_auth(access_token)
        .json(&TaskListCreate {
            title: WORM_WORLD_LIST_TITLE,
        })
        .send()
        .await?
        .error_for_status()?
        .json::<GoogleTaskList>()
        .await?;
    Ok(created.id)
}

/// Runs the full "connect" flow: OAuth consent, fetch the account's email and
/// the dedicated "Worm World" task list (created on first connect), persist a
/// `sync_accounts` row, and store the refresh token in the OS keychain. Only
/// one Google account is supported for phase 1 - connecting again replaces
/// the existing one.
pub async fn connect(
    state: &InnerDbState,
    app_handle: &tauri::AppHandle,
) -> Result<SyncAccount, SyncError> {
    let config = GoogleOAuthConfig::from_env()?;
    let token = oauth::run_auth_flow(&config, app_handle).await?;
    let access_token = token.access_token().secret();
    let refresh_token = token
        .refresh_token()
        .ok_or_else(|| {
            SyncError::OAuth(
                "Google did not return a refresh token - try disconnecting any prior worm-world access at https://myaccount.google.com/permissions and reconnecting".to_string(),
            )
        })?
        .secret()
        .clone();

    let http = reqwest::Client::new();
    let email = http
        .get(USERINFO_URL)
        .bearer_auth(access_token)
        .send()
        .await?
        .error_for_status()?
        .json::<UserInfo>()
        .await?
        .email;

    let list_id = get_or_create_worm_world_list(&http, access_token).await?;

    // Only one Google account is supported for phase 1 - replace any existing one.
    for existing in state.get_sync_accounts().await? {
        if existing.provider == "google" {
            let _ = oauth::delete_refresh_token(&existing.id);
            state.delete_sync_account(&existing.id).await?;
        }
    }

    let account = SyncAccount {
        id: Uuid::new_v4().to_string(),
        provider: "google".to_string(),
        account_label: email,
        google_task_list_id: list_id,
        created_at: Utc::now().to_rfc3339(),
        last_synced_at: None,
    };
    state.insert_sync_account(&account).await?;
    oauth::store_refresh_token(&account.id, &refresh_token)?;

    Ok(account)
}

pub async fn disconnect(state: &InnerDbState, sync_account_id: &str) -> Result<(), SyncError> {
    oauth::delete_refresh_token(sync_account_id)?;
    state.delete_sync_account(sync_account_id).await?;
    Ok(())
}

/// Pushes a single task's title/notes/due-date/completion status to Google
/// Tasks, inserting it if this is the first time this task has synced or
/// patching the existing remote resource otherwise. `title` is passed in
/// rather than derived here, since it comes from the frontend's
/// `getTaskStatementText` (rendering a task's genotype strings is
/// frontend-only logic - see `TaskItem.tsx`). A no-op if no Google account is
/// connected; sync failures are the caller's responsibility to treat as
/// best-effort (the local save must never be blocked on this).
pub async fn push_task(state: &InnerDbState, task: &Task, title: &str) -> Result<(), SyncError> {
    let _guard = super::acquire_sync_lock().await;
    let Some(account) = get_google_account(state).await? else {
        return Ok(());
    };
    let config = GoogleOAuthConfig::from_env()?;
    let access_token = get_access_token(&config, &account.id).await?;
    let http = reqwest::Client::new();

    let body = GoogleTaskUpsert {
        title,
        notes: task.notes.as_deref(),
        due: task.due_date.as_deref().and_then(to_google_due_date),
        status: if task.completed {
            "completed"
        } else {
            "needsAction"
        },
    };

    let existing_link = state.get_task_sync_link(&task.id, &account.id).await?;
    let patch_result = match &existing_link {
        Some(link) => Some(
            http.patch(format!(
                "{TASKS_API_BASE}/lists/{}/tasks/{}",
                account.google_task_list_id, link.remote_id
            ))
            .bearer_auth(&access_token)
            .json(&body)
            .send()
            .await?,
        ),
        None => None,
    };

    // A patch 404s if the remote task was deleted directly in Google Tasks
    // (or, before the sync lock existed, orphaned by a duplicate-create
    // race) - fall back to creating a fresh one rather than treating that as
    // a hard failure.
    let needs_create = match &patch_result {
        None => true,
        Some(resp) => resp.status() == reqwest::StatusCode::NOT_FOUND,
    };

    let response = if needs_create {
        http.post(format!(
            "{TASKS_API_BASE}/lists/{}/tasks",
            account.google_task_list_id
        ))
        .bearer_auth(&access_token)
        .json(&body)
        .send()
        .await?
        .error_for_status()?
        .json::<GoogleTask>()
        .await?
    } else {
        patch_result
            .expect("needs_create is false only when patch_result is Some")
            .error_for_status()?
            .json::<GoogleTask>()
            .await?
    };

    state
        .upsert_task_sync_link(&TaskSyncLink {
            task_id: task.id.clone(),
            sync_account_id: account.id,
            remote_id: response.id,
            remote_updated_at: Some(response.updated),
            local_updated_at: task.updated_at.clone(),
        })
        .await?;

    Ok(())
}

/// Pulls remote changes since the account's last sync and applies them to
/// local tasks - per the confirmed conflict policy, only `completed` and
/// `dueDate` flow back (never title/notes, which are worm-world-generated).
/// Returns the local tasks that were changed, so the caller can refresh the
/// frontend's view of them. A no-op if no Google account is connected.
pub async fn pull_updates(state: &InnerDbState) -> Result<Vec<Task>, SyncError> {
    let _guard = super::acquire_sync_lock().await;
    let Some(account) = get_google_account(state).await? else {
        return Ok(vec![]);
    };
    let config = GoogleOAuthConfig::from_env()?;
    let access_token = get_access_token(&config, &account.id).await?;
    let http = reqwest::Client::new();

    let mut request = http
        .get(format!(
            "{TASKS_API_BASE}/lists/{}/tasks",
            account.google_task_list_id
        ))
        .bearer_auth(&access_token)
        .query(&[("showCompleted", "true"), ("showHidden", "true")]);
    if let Some(last_synced_at) = &account.last_synced_at {
        request = request.query(&[("updatedMin", last_synced_at)]);
    }

    let remote_tasks = request
        .send()
        .await?
        .error_for_status()?
        .json::<GoogleTasksListResponse>()
        .await?
        .items;

    let mut changed = vec![];
    for remote in remote_tasks {
        let Some(link) = state
            .get_task_sync_link_by_remote_id(&account.id, &remote.id)
            .await?
        else {
            // A task created directly in Google Tasks has nothing to link to
            // on the worm-world side (every local task originates from a
            // cross-design step) - phase 1 only syncs tasks worm-world
            // already knows about.
            continue;
        };

        let already_seen = link.remote_updated_at.as_deref() == Some(remote.updated.as_str());
        if already_seen {
            continue;
        }

        let Some(mut task) = state
            .get_tasks()
            .await?
            .into_iter()
            .find(|t| t.id == link.task_id)
        else {
            continue;
        };

        task.completed = remote.status == "completed";
        task.completed_at = if task.completed {
            Some(remote.updated.clone())
        } else {
            None
        };
        task.due_date = remote.due.clone().or(task.due_date);
        task.updated_at = Some(Utc::now().to_rfc3339());
        state.update_task(&task).await?;

        state
            .upsert_task_sync_link(&TaskSyncLink {
                task_id: task.id.clone(),
                sync_account_id: account.id.clone(),
                remote_id: remote.id,
                remote_updated_at: Some(remote.updated),
                local_updated_at: task.updated_at.clone(),
            })
            .await?;

        changed.push(task);
    }

    state
        .update_sync_account_last_synced(&account.id, &Utc::now().to_rfc3339())
        .await?;

    Ok(changed)
}

async fn get_google_account(state: &InnerDbState) -> Result<Option<SyncAccount>, SyncError> {
    Ok(state
        .get_sync_accounts()
        .await?
        .into_iter()
        .find(|a| a.provider == "google"))
}

#[cfg(test)]
mod test {
    use super::to_google_due_date;

    #[test]
    fn converts_a_plain_date_to_midnight_utc_rfc3339() {
        assert_eq!(
            to_google_due_date("2026-09-28"),
            Some("2026-09-28T00:00:00+00:00".to_string())
        );
    }

    #[test]
    fn converts_an_rfc3339_timestamp_to_its_midnight_utc_date() {
        assert_eq!(
            to_google_due_date("2026-09-28T15:30:00-07:00"),
            Some("2026-09-28T00:00:00+00:00".to_string())
        );
    }

    #[test]
    fn returns_none_for_unparseable_input() {
        assert_eq!(to_google_due_date("not a date"), None);
    }
}
