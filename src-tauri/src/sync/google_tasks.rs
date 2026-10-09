use super::oauth::{self, GoogleOAuthConfig};
use super::SyncError;
use crate::interface::InnerDbState;
use crate::models::cross_design_sync_link::CrossDesignSyncLink;
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
struct GoogleTaskCreate<'a> {
    title: &'a str,
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
    #[serde(default)]
    status: String,
    #[serde(default)]
    updated: String,
    /// Google keeps a task its owner deleted for a while, flagged, rather than
    /// answering 404 - such a task can no longer be updated or moved
    #[serde(default)]
    deleted: bool,
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
    let date = parse_due_date(due_date)?;
    Some(
        chrono::DateTime::<Utc>::from_naive_utc_and_offset(date.and_hms_opt(0, 0, 0)?, Utc)
            .to_rfc3339(),
    )
}

/// worm-world's frontend now writes `due_date` as `Date.toISOString()`
/// (RFC3339), but existing rows from before that fix - and any not yet
/// re-saved - are still in JS's `Date.toString()` format, e.g. "Thu Oct 01
/// 2026 08:30:20 GMT-0600 (Mountain Daylight Time)". Handle both rather than
/// requiring a data migration.
fn parse_due_date(due_date: &str) -> Option<chrono::NaiveDate> {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(due_date) {
        return Some(dt.date_naive());
    }
    if let Ok(d) = chrono::NaiveDate::parse_from_str(due_date, "%Y-%m-%d") {
        return Some(d);
    }
    let without_tz_name = due_date.split('(').next()?.trim();
    if let Ok(dt) = chrono::DateTime::parse_from_str(without_tz_name, "%a %b %d %Y %H:%M:%S GMT%z")
    {
        return Some(dt.date_naive());
    }
    None
}

async fn get_access_token(
    config: &GoogleOAuthConfig,
    sync_account_id: &str,
) -> Result<String, SyncError> {
    if let Some(cached) = super::get_cached_access_token(sync_account_id).await {
        return Ok(cached);
    }

    let refresh_token = oauth::get_secret(sync_account_id)?;
    let token = oauth::refresh_access_token(config, &refresh_token).await?;
    let access_token = token.access_token().secret().clone();
    super::cache_access_token(sync_account_id, &access_token, token.expires_in()).await;
    Ok(access_token)
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
            let _ = oauth::delete_secret(&existing.id);
            state.delete_sync_account(&existing.id).await?;
        }
    }

    let account = SyncAccount {
        id: Uuid::new_v4().to_string(),
        provider: "google".to_string(),
        account_label: email,
        remote_list_id: list_id,
        created_at: Utc::now().to_rfc3339(),
        last_synced_at: None,
    };
    state.insert_sync_account(&account).await?;
    oauth::store_secret(&account.id, &refresh_token)?;

    Ok(account)
}

pub async fn disconnect(state: &InnerDbState, sync_account_id: &str) -> Result<(), SyncError> {
    oauth::delete_secret(sync_account_id)?;
    state.delete_sync_account(sync_account_id).await?;
    Ok(())
}

/// What the push logic needs from the Google Tasks API. Kept small and
/// separate from `reqwest` so the logic that decides what to create, patch,
/// move or recreate can be tested against a fake Google.
trait TasksApi {
    /// Updates a task; `None` when Google answers 404 (not found).
    async fn patch_task(
        &self,
        task_id: &str,
        body: &GoogleTaskUpsert<'_>,
    ) -> Result<Option<GoogleTask>, SyncError>;
    async fn create_task(&self, body: &GoogleTaskUpsert<'_>) -> Result<GoogleTask, SyncError>;
    /// Reads a task; `None` when Google answers 404 (not found).
    async fn get_task(&self, task_id: &str) -> Result<Option<GoogleTask>, SyncError>;
    /// Moves a task under a parent task - Google Tasks requires this as its
    /// own call (`parent` is output-only on the task resource). `false` when
    /// Google answers 404: the task or the parent is not there.
    async fn move_task(&self, task_id: &str, parent_id: &str) -> Result<bool, SyncError>;
}

struct GoogleTasksApi<'a> {
    http: &'a reqwest::Client,
    access_token: &'a str,
    list_id: &'a str,
}

impl TasksApi for GoogleTasksApi<'_> {
    async fn patch_task(
        &self,
        task_id: &str,
        body: &GoogleTaskUpsert<'_>,
    ) -> Result<Option<GoogleTask>, SyncError> {
        let response = self
            .http
            .patch(format!(
                "{TASKS_API_BASE}/lists/{}/tasks/{task_id}",
                self.list_id
            ))
            .bearer_auth(self.access_token)
            .json(body)
            .send()
            .await?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        Ok(Some(
            response.error_for_status()?.json::<GoogleTask>().await?,
        ))
    }

    async fn create_task(&self, body: &GoogleTaskUpsert<'_>) -> Result<GoogleTask, SyncError> {
        Ok(self
            .http
            .post(format!("{TASKS_API_BASE}/lists/{}/tasks", self.list_id))
            .bearer_auth(self.access_token)
            .json(body)
            .send()
            .await?
            .error_for_status()?
            .json::<GoogleTask>()
            .await?)
    }

    async fn get_task(&self, task_id: &str) -> Result<Option<GoogleTask>, SyncError> {
        let response = self
            .http
            .get(format!(
                "{TASKS_API_BASE}/lists/{}/tasks/{task_id}",
                self.list_id
            ))
            .bearer_auth(self.access_token)
            .send()
            .await?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        Ok(Some(
            response.error_for_status()?.json::<GoogleTask>().await?,
        ))
    }

    async fn move_task(&self, task_id: &str, parent_id: &str) -> Result<bool, SyncError> {
        let response = self
            .http
            .post(format!(
                "{TASKS_API_BASE}/lists/{}/tasks/{task_id}/move",
                self.list_id
            ))
            .bearer_auth(self.access_token)
            .query(&[("parent", parent_id)])
            .send()
            .await?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(false);
        }
        response.error_for_status()?;
        Ok(true)
    }
}

fn is_there(task: &Option<GoogleTask>) -> bool {
    matches!(task, Some(t) if !t.deleted)
}

/// Finds or creates the Google Tasks "parent" task used to group every task
/// belonging to one cross design together in the Tasks UI - titled after the
/// cross design's name, with no due date/notes of its own. Cached in
/// `cross_design_sync_links` so repeated pushes reuse the same parent
/// instead of creating a new one every time.
async fn ensure_cross_design_parent<A: TasksApi>(
    state: &InnerDbState,
    account: &SyncAccount,
    api: &A,
    cross_design_id: &str,
) -> Result<String, SyncError> {
    if let Some(link) = state
        .get_cross_design_sync_link(cross_design_id, &account.id)
        .await?
    {
        return Ok(link.remote_parent_task_id);
    }

    let cross_design = state
        .get_cross_design(cross_design_id)
        .await?
        .ok_or_else(|| SyncError::Db(format!("cross design {cross_design_id} not found")))?;

    let created = api
        .create_task(&GoogleTaskUpsert {
            title: &cross_design.name,
            notes: None,
            due: None,
            status: "needsAction",
        })
        .await?;

    state
        .upsert_cross_design_sync_link(&CrossDesignSyncLink {
            cross_design_id: cross_design_id.to_string(),
            sync_account_id: account.id.clone(),
            remote_parent_task_id: created.id.clone(),
        })
        .await?;

    Ok(created.id)
}

enum Attached {
    Yes,
    /// The task itself is gone from Google; it needs to be created again
    TaskIsGone,
}

/// Groups `remote_task_id` under its cross design's parent task. When Google
/// answers 404 to the move, either the parent or the task is missing, and
/// they need different fixes - so find out which before changing anything: a
/// missing parent is created again (once), a missing task is reported so the
/// caller can create it again. (This used to assume the parent was gone and
/// make a new one every time, so a missing task left a stray empty parent in
/// Google's list on every attempt.)
async fn attach_task_to_cross_design_parent<A: TasksApi>(
    state: &InnerDbState,
    account: &SyncAccount,
    api: &A,
    cross_design_id: &str,
    remote_task_id: &str,
) -> Result<Attached, SyncError> {
    let parent_id = ensure_cross_design_parent(state, account, api, cross_design_id).await?;
    if api.move_task(remote_task_id, &parent_id).await? {
        return Ok(Attached::Yes);
    }

    // 404: which one is missing?
    if is_there(&api.get_task(&parent_id).await?) {
        return Ok(Attached::TaskIsGone);
    }
    state
        .delete_cross_design_sync_link(cross_design_id, &account.id)
        .await?;
    let parent_id = ensure_cross_design_parent(state, account, api, cross_design_id).await?;
    if api.move_task(remote_task_id, &parent_id).await? {
        Ok(Attached::Yes)
    } else {
        Ok(Attached::TaskIsGone)
    }
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
    let Some(account) = get_google_account(state).await? else {
        return Ok(());
    };
    let _guard = super::acquire_sync_lock(&account.id).await;
    let config = GoogleOAuthConfig::from_env()?;
    let access_token = get_access_token(&config, &account.id).await?;
    let http = reqwest::Client::new();
    let api = GoogleTasksApi {
        http: &http,
        access_token: &access_token,
        list_id: &account.remote_list_id,
    };
    push_task_with(state, &account, &api, task, title).await
}

async fn push_task_with<A: TasksApi>(
    state: &InnerDbState,
    account: &SyncAccount,
    api: &A,
    task: &Task,
    title: &str,
) -> Result<(), SyncError> {
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

    // Update the task Google already has for this one. A task deleted directly
    // in Google Tasks answers 404 or comes back flagged deleted - either way it
    // is gone, so create a fresh one rather than failing.
    let existing_link = state.get_task_sync_link(&task.id, &account.id).await?;
    let patched = match &existing_link {
        Some(link) => api
            .patch_task(&link.remote_id, &body)
            .await?
            .filter(|remote| !remote.deleted),
        None => None,
    };
    let mut remote = match patched {
        Some(remote) => remote,
        None => api.create_task(&body).await?,
    };

    let mut attached =
        attach_task_to_cross_design_parent(state, account, api, &task.cross_design_id, &remote.id)
            .await?;
    if matches!(attached, Attached::TaskIsGone) {
        // the task vanished between the update and the move: create it again
        remote = api.create_task(&body).await?;
        attached = attach_task_to_cross_design_parent(
            state,
            account,
            api,
            &task.cross_design_id,
            &remote.id,
        )
        .await?;
    }
    if matches!(attached, Attached::TaskIsGone) {
        return Err(SyncError::Http(
            "Google Tasks would not file the task under its design".to_string(),
        ));
    }

    state
        .upsert_task_sync_link(&TaskSyncLink {
            task_id: task.id.clone(),
            sync_account_id: account.id.clone(),
            remote_id: remote.id,
            remote_updated_at: Some(remote.updated),
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
    let Some(account) = get_google_account(state).await? else {
        return Ok(vec![]);
    };
    let _guard = super::acquire_sync_lock(&account.id).await;
    let config = GoogleOAuthConfig::from_env()?;
    let access_token = get_access_token(&config, &account.id).await?;
    let http = reqwest::Client::new();

    let mut request = http
        .get(format!(
            "{TASKS_API_BASE}/lists/{}/tasks",
            account.remote_list_id
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
    fn converts_a_js_date_tostring_timestamp() {
        // JS Date.prototype.toString() format - what worm-world's frontend
        // stored due_date as before switching to toISOString().
        assert_eq!(
            to_google_due_date("Thu Oct 01 2026 08:30:20 GMT-0600 (Mountain Daylight Time)"),
            Some("2026-10-01T00:00:00+00:00".to_string())
        );
    }

    #[test]
    fn returns_none_for_unparseable_input() {
        assert_eq!(to_google_due_date("not a date"), None);
    }

    // ---- the push logic against a fake Google Tasks ----

    use super::{push_task_with, GoogleTask, GoogleTaskUpsert, TasksApi};
    use crate::interface::InnerDbState;
    use crate::models::sync_account::SyncAccount;
    use crate::models::task::{Action, Task};
    use crate::sync::SyncError;
    use sqlx::{Pool, Sqlite};
    use std::collections::HashMap;
    use std::sync::Mutex;

    /// How the fake answers about a task that was deleted in Google Tasks
    #[derive(Clone, Copy, PartialEq)]
    enum DeletedTask {
        /// 404 for a patch and a get
        NotFound,
        /// 200 with `deleted: true`
        Flagged,
        /// 200 for a patch (as if it were fine) but 404 for a move
        PatchLooksFine,
    }

    struct FakeTask {
        title: String,
        deleted: bool,
        parent: Option<String>,
    }

    struct FakeState {
        tasks: HashMap<String, FakeTask>,
        next: u32,
    }

    struct FakeGoogle {
        state: Mutex<FakeState>,
        deleted_behaviour: DeletedTask,
    }

    impl FakeGoogle {
        fn new(deleted_behaviour: DeletedTask) -> Self {
            FakeGoogle {
                state: Mutex::new(FakeState {
                    tasks: HashMap::new(),
                    next: 0,
                }),
                deleted_behaviour,
            }
        }

        fn delete(&self, id: &str) {
            self.state
                .lock()
                .unwrap()
                .tasks
                .get_mut(id)
                .unwrap()
                .deleted = true;
        }

        fn view(&self, id: &str, flagged: bool) -> GoogleTask {
            GoogleTask {
                id: id.to_string(),
                due: None,
                status: "needsAction".to_string(),
                updated: "2026-10-09T00:00:00Z".to_string(),
                deleted: flagged,
            }
        }

        /// titles of the live (not deleted) tasks, sorted
        fn live_titles(&self) -> Vec<String> {
            let mut titles: Vec<String> = self
                .state
                .lock()
                .unwrap()
                .tasks
                .values()
                .filter(|t| !t.deleted)
                .map(|t| t.title.clone())
                .collect();
            titles.sort();
            titles
        }

        fn parent_of(&self, id: &str) -> Option<String> {
            self.state.lock().unwrap().tasks[id].parent.clone()
        }
    }

    impl TasksApi for FakeGoogle {
        async fn patch_task(
            &self,
            task_id: &str,
            body: &GoogleTaskUpsert<'_>,
        ) -> Result<Option<GoogleTask>, SyncError> {
            let mut state = self.state.lock().unwrap();
            let Some(task) = state.tasks.get_mut(task_id) else {
                return Ok(None);
            };
            if task.deleted {
                return Ok(match self.deleted_behaviour {
                    DeletedTask::NotFound => None,
                    DeletedTask::Flagged => Some(self.view(task_id, true)),
                    DeletedTask::PatchLooksFine => Some(self.view(task_id, false)),
                });
            }
            task.title = body.title.to_string();
            Ok(Some(self.view(task_id, false)))
        }

        async fn create_task(&self, body: &GoogleTaskUpsert<'_>) -> Result<GoogleTask, SyncError> {
            let mut state = self.state.lock().unwrap();
            state.next += 1;
            let id = format!("g{}", state.next);
            state.tasks.insert(
                id.clone(),
                FakeTask {
                    title: body.title.to_string(),
                    deleted: false,
                    parent: None,
                },
            );
            Ok(self.view(&id, false))
        }

        async fn get_task(&self, task_id: &str) -> Result<Option<GoogleTask>, SyncError> {
            let state = self.state.lock().unwrap();
            Ok(match state.tasks.get(task_id) {
                None => None,
                Some(t) if t.deleted => match self.deleted_behaviour {
                    DeletedTask::Flagged => Some(self.view(task_id, true)),
                    _ => None,
                },
                Some(_) => Some(self.view(task_id, false)),
            })
        }

        async fn move_task(&self, task_id: &str, parent_id: &str) -> Result<bool, SyncError> {
            let mut state = self.state.lock().unwrap();
            let gone = |s: &FakeState, id: &str| s.tasks.get(id).map_or(true, |t| t.deleted);
            if gone(&state, task_id) || gone(&state, parent_id) {
                return Ok(false);
            }
            state.tasks.get_mut(task_id).unwrap().parent = Some(parent_id.to_string());
            Ok(true)
        }
    }

    async fn database(pool: &Pool<Sqlite>) -> (InnerDbState, SyncAccount) {
        for sql in [
            "INSERT INTO cross_designs (id, name, last_edited, data, editable) VALUES ('D1', 'test7', 'now', '{}', 1)",
            "INSERT INTO tasks (id, action, herm_strain, completed, cross_design_id) VALUES ('T1', 1, 'h', 0, 'D1'), ('T2', 1, 'h', 0, 'D1')",
            "INSERT INTO sync_accounts (id, provider, account_label, remote_list_id, created_at) VALUES ('A1', 'google', 'a@b.c', 'L1', 'now')",
        ] {
            sqlx::query(sql).execute(pool).await.unwrap();
        }
        let account = SyncAccount {
            id: "A1".to_string(),
            provider: "google".to_string(),
            account_label: "a@b.c".to_string(),
            remote_list_id: "L1".to_string(),
            created_at: "now".to_string(),
            last_synced_at: None,
        };
        (
            InnerDbState {
                conn_pool: pool.clone(),
            },
            account,
        )
    }

    fn task(id: &str) -> Task {
        Task {
            id: id.to_string(),
            due_date: Some("2026-10-10".to_string()),
            action: Action::SelfCross,
            herm_strain: "h".to_string(),
            male_strain: None,
            result_strain: None,
            notes: None,
            completed: false,
            cross_design_id: "D1".to_string(),
            child_task_id: None,
            updated_at: None,
            completed_at: None,
        }
    }

    async fn remote_id_of(state: &InnerDbState, task_id: &str) -> String {
        state
            .get_task_sync_link(task_id, "A1")
            .await
            .unwrap()
            .unwrap()
            .remote_id
    }

    async fn parent_link(state: &InnerDbState) -> String {
        state
            .get_cross_design_sync_link("D1", "A1")
            .await
            .unwrap()
            .unwrap()
            .remote_parent_task_id
    }

    #[sqlx::test]
    async fn pushing_files_each_task_under_one_parent_named_for_the_design(pool: Pool<Sqlite>) {
        let (state, account) = database(&pool).await;
        let google = FakeGoogle::new(DeletedTask::NotFound);
        push_task_with(&state, &account, &google, &task("T1"), "step one")
            .await
            .unwrap();
        push_task_with(&state, &account, &google, &task("T2"), "step two")
            .await
            .unwrap();
        // pushing again only updates
        push_task_with(&state, &account, &google, &task("T1"), "step one")
            .await
            .unwrap();

        assert_eq!(google.live_titles(), vec!["step one", "step two", "test7"]);
        let parent = parent_link(&state).await;
        assert_eq!(
            google.parent_of(&remote_id_of(&state, "T1").await),
            Some(parent.clone())
        );
        assert_eq!(
            google.parent_of(&remote_id_of(&state, "T2").await),
            Some(parent)
        );
    }

    async fn a_task_deleted_in_google_is_made_again_without_a_stray_parent(behaviour: DeletedTask) {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let (state, account) = database(&pool).await;
        let google = FakeGoogle::new(behaviour);
        push_task_with(&state, &account, &google, &task("T1"), "step one")
            .await
            .unwrap();
        let first_remote = remote_id_of(&state, "T1").await;
        let parent = parent_link(&state).await;

        google.delete(&first_remote);
        // the date changed and was pushed again, more than once
        for _ in 0..3 {
            push_task_with(&state, &account, &google, &task("T1"), "step one")
                .await
                .unwrap();
        }

        // one fresh task, still under the same, only parent
        assert_eq!(google.live_titles(), vec!["step one", "test7"]);
        assert_eq!(parent_link(&state).await, parent);
        let new_remote = remote_id_of(&state, "T1").await;
        assert_ne!(new_remote, first_remote);
        assert_eq!(google.parent_of(&new_remote), Some(parent));
    }

    #[tokio::test]
    async fn a_deleted_task_that_answers_404_is_made_again_without_a_stray_parent() {
        a_task_deleted_in_google_is_made_again_without_a_stray_parent(DeletedTask::NotFound).await;
    }

    #[tokio::test]
    async fn a_deleted_task_flagged_deleted_is_made_again_without_a_stray_parent() {
        a_task_deleted_in_google_is_made_again_without_a_stray_parent(DeletedTask::Flagged).await;
    }

    #[tokio::test]
    async fn a_deleted_task_that_patches_fine_but_cannot_be_moved_is_made_again_without_a_stray_parent(
    ) {
        a_task_deleted_in_google_is_made_again_without_a_stray_parent(DeletedTask::PatchLooksFine)
            .await;
    }

    #[sqlx::test]
    async fn a_parent_deleted_in_google_is_made_again_once(pool: Pool<Sqlite>) {
        let (state, account) = database(&pool).await;
        let google = FakeGoogle::new(DeletedTask::NotFound);
        push_task_with(&state, &account, &google, &task("T1"), "step one")
            .await
            .unwrap();
        let old_parent = parent_link(&state).await;

        google.delete(&old_parent);
        push_task_with(&state, &account, &google, &task("T1"), "step one")
            .await
            .unwrap();
        push_task_with(&state, &account, &google, &task("T1"), "step one")
            .await
            .unwrap();

        // exactly one parent exists, a new one, and the task is under it
        assert_eq!(google.live_titles(), vec!["step one", "test7"]);
        let new_parent = parent_link(&state).await;
        assert_ne!(new_parent, old_parent);
        assert_eq!(
            google.parent_of(&remote_id_of(&state, "T1").await),
            Some(new_parent)
        );
    }

    #[sqlx::test]
    async fn a_parent_and_a_task_both_deleted_are_each_made_again_once(pool: Pool<Sqlite>) {
        let (state, account) = database(&pool).await;
        let google = FakeGoogle::new(DeletedTask::NotFound);
        push_task_with(&state, &account, &google, &task("T1"), "step one")
            .await
            .unwrap();
        google.delete(&parent_link(&state).await);
        google.delete(&remote_id_of(&state, "T1").await);

        push_task_with(&state, &account, &google, &task("T1"), "step one")
            .await
            .unwrap();

        assert_eq!(google.live_titles(), vec!["step one", "test7"]);
        let parent = parent_link(&state).await;
        assert_eq!(
            google.parent_of(&remote_id_of(&state, "T1").await),
            Some(parent)
        );
    }
}
