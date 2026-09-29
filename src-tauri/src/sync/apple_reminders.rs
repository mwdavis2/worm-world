//! Apple Reminders sync via iCloud's CalDAV service (RFC 4791). Unlike
//! Google, Apple exposes no REST API for Reminders - CalDAV, authenticated
//! with an Apple ID + an app-specific password (Basic auth, no OAuth flow at
//! all), is the only route. Discovery is a chain of `PROPFIND` requests;
//! iCloud's `calendar-home-set` typically resolves to a different,
//! partitioned host (e.g. `p34-caldav.icloud.com`) that all further requests
//! must use - `sync_accounts.remote_list_id` stores the full absolute
//! calendar-collection URL on that host, once discovered.
//!
//! Reminders has no Google-Tasks-style parent/subtask nesting, so cross
//! design grouping works differently here: everything goes into one shared
//! "Worm World" list, tagged with the cross design's name via the
//! iCalendar `CATEGORIES` property (surfaced as a filterable "Tag" in the
//! Reminders app).

use super::oauth;
use super::SyncError;
use crate::interface::InnerDbState;
use crate::models::sync_account::SyncAccount;
use crate::models::task::Task;
use crate::models::task_sync_link::TaskSyncLink;
use chrono::Utc;
use icalendar::{Calendar, CalendarComponent, Component, DatePerhapsTime, Todo, TodoStatus};
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use uuid::Uuid;

const INITIAL_HOST: &str = "https://caldav.icloud.com";
const WORM_WORLD_CALENDAR_NAME: &str = "Worm World";

struct AppleCredentials {
    email: String,
    app_password: String,
}

fn credentials_for(account: &SyncAccount) -> Result<AppleCredentials, SyncError> {
    Ok(AppleCredentials {
        email: account.account_label.clone(),
        app_password: oauth::get_secret(&account.id)?,
    })
}

// --- Minimal, prefix-agnostic multistatus XML parsing -----------------
//
// Real CalDAV servers vary in which namespace prefix they use for DAV/CalDAV
// elements (`d:`, `D:`, `cal:`, or none at all), so matching by qualified
// name would be fragile. These helpers match on local name only - a
// pragmatic simplification that's safe here because CalDAV's multistatus
// responses are shallow and machine-generated, not arbitrary untrusted XML.

fn local_name_matches(qname: &[u8], local_name: &str) -> bool {
    let s = std::str::from_utf8(qname).unwrap_or("");
    s == local_name || s.ends_with(&format!(":{local_name}"))
}

/// Text content of the first element anywhere in `xml` whose local name
/// (ignoring any namespace prefix) is `local_name`.
fn find_first_text(xml: &str, local_name: &str) -> Option<String> {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    let mut capturing = false;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Eof) => return None,
            Ok(Event::Start(e)) if local_name_matches(e.name().as_ref(), local_name) => {
                capturing = true;
            }
            Ok(Event::Text(e)) if capturing => {
                return e.decode().ok().map(|c| c.into_owned());
            }
            Ok(Event::CData(e)) if capturing => {
                return Some(String::from_utf8_lossy(e.as_ref()).into_owned());
            }
            Ok(Event::End(e)) if local_name_matches(e.name().as_ref(), local_name) => {
                capturing = false;
            }
            Err(_) => return None,
            _ => {}
        }
        buf.clear();
    }
}

/// Splits a DAV multistatus response into the raw XML of each top-level
/// `<response>` block, so callers can look up fields (href, etag,
/// calendar-data, ...) scoped to one calendar/object at a time instead of
/// getting the first match anywhere in the whole document.
fn split_response_blocks(xml: &str) -> Vec<String> {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    let mut blocks = vec![];
    let mut start: Option<usize> = None;
    loop {
        let pos_before = reader.buffer_position();
        match reader.read_event_into(&mut buf) {
            Ok(Event::Eof) => break,
            Ok(Event::Start(e))
                if local_name_matches(e.name().as_ref(), "response") && start.is_none() =>
            {
                start = Some(pos_before as usize);
            }
            Ok(Event::End(e)) if local_name_matches(e.name().as_ref(), "response") => {
                if let Some(s) = start.take() {
                    let end = reader.buffer_position() as usize;
                    if let Some(slice) = xml.get(s..end) {
                        blocks.push(slice.to_string());
                    }
                }
            }
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    blocks
}

fn resolve_url(base: &str, href: &str) -> String {
    if href.starts_with("http://") || href.starts_with("https://") {
        return href.to_string();
    }
    let base = base.trim_end_matches('/');
    let href = href.trim_start_matches('/');
    format!("{base}/{href}")
}

/// The scheme+authority portion of an absolute URL, e.g.
/// `https://p34-caldav.icloud.com` from
/// `https://p34-caldav.icloud.com/200385701/calendars/`.
fn host_of(url: &str) -> Option<String> {
    let after_scheme = url.split_once("://")?;
    let authority_end = after_scheme.1.find('/').unwrap_or(after_scheme.1.len());
    Some(format!(
        "{}://{}",
        after_scheme.0,
        &after_scheme.1[..authority_end]
    ))
}

struct CurlResponse {
    status: u16,
    etag: Option<String>,
    body: String,
}

/// A marker unlikely to ever appear in a real CalDAV response, used to
/// delimit curl's `-w` trailer (status code + ETag) from the actual
/// response body in its combined stdout stream.
const CURL_RESULT_MARKER: &str = "__WW_CURL_RESULT__";

/// Runs an HTTP request via the system `curl` binary rather than reqwest.
/// Empirically, Apple's iCloud CalDAV endpoint (behind an Akamai edge that
/// does TLS fingerprinting for bot mitigation) silently rejects every
/// request this app's own reqwest-based client sends with a content-free
/// 400 Bad Request, while a byte-for-byte equivalent request via curl
/// succeeds - confirmed with real credentials, and persisting even after
/// switching reqwest between both of its TLS backends (rustls and
/// native-tls). Shelling out to curl sidesteps whatever curl-vs-reqwest
/// fingerprint difference is being detected, since curl is empirically
/// known to work against this specific endpoint. The app-specific password
/// is passed to curl via a `-K -` config file read over stdin, not as a
/// command-line argument, so it never appears in `ps`/Activity Monitor's
/// process listing the way an argv-based `-u` would.
async fn curl_request(
    creds: &AppleCredentials,
    method: &str,
    url: &str,
    extra_headers: &[(&str, &str)],
    body: Option<&str>,
) -> Result<CurlResponse, SyncError> {
    let mut cmd = Command::new("curl");
    cmd.arg("-s")
        .arg("-X")
        .arg(method)
        .arg(url)
        .arg("-K")
        .arg("-")
        .arg("-w")
        .arg(format!(
            "\n{CURL_RESULT_MARKER}%{{http_code}}{CURL_RESULT_MARKER}%header{{etag}}{CURL_RESULT_MARKER}\n"
        ));
    for (key, value) in extra_headers {
        cmd.arg("-H").arg(format!("{key}: {value}"));
    }
    if let Some(b) = body {
        cmd.arg("--data-binary").arg(b);
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| SyncError::Http(format!("failed to spawn curl: {e}")))?;

    if let Some(mut stdin) = child.stdin.take() {
        let config = format!("user = \"{}:{}\"\n", creds.email, creds.app_password);
        stdin
            .write_all(config.as_bytes())
            .await
            .map_err(|e| SyncError::Http(format!("failed to write curl config: {e}")))?;
    }

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| SyncError::Http(format!("curl failed to run: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(SyncError::Http(format!(
            "curl exited with {}: {}",
            output.status,
            stderr.trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut parts = stdout.rsplitn(4, CURL_RESULT_MARKER);
    let _trailing_newline = parts.next().unwrap_or_default();
    let etag_raw = parts.next().unwrap_or_default().trim();
    let status_raw = parts.next().unwrap_or_default().trim();
    let body_text = parts
        .next()
        .unwrap_or_default()
        .trim_end_matches('\n')
        .to_string();

    let status: u16 = status_raw.parse().map_err(|_| {
        SyncError::Http(format!(
            "could not parse curl's status trailer from its output: {stdout}"
        ))
    })?;
    let etag = (!etag_raw.is_empty()).then(|| etag_raw.to_string());

    Ok(CurlResponse {
        status,
        etag,
        body: body_text,
    })
}

/// Checks a response's status, including the response body in the error if
/// it wasn't a success - CalDAV servers routinely explain a 4xx/5xx there.
/// A 401/403 gets a specific, actionable message instead of a raw status
/// dump, since "wrong email or app-specific password" is by far the most
/// likely real-world cause (a typo transcribing a one-time-shown password,
/// or an expired/revoked one) - not something a user should have to
/// decipher from an HTTP status code.
fn ensure_success(response: CurlResponse, action: &str) -> Result<CurlResponse, SyncError> {
    if (200..300).contains(&response.status) {
        return Ok(response);
    }
    if response.status == 401 || response.status == 403 {
        return Err(SyncError::OAuth(
            "Apple rejected that email/app-specific password combination - double-check both, or generate a fresh app-specific password at appleid.apple.com/account/manage and try again".to_string(),
        ));
    }
    Err(SyncError::Http(format!(
        "{action} failed: HTTP {} - {}",
        response.status, response.body
    )))
}

async fn propfind(
    creds: &AppleCredentials,
    url: &str,
    depth: &str,
    body: &str,
) -> Result<String, SyncError> {
    let response = curl_request(
        creds,
        "PROPFIND",
        url,
        &[
            ("Depth", depth),
            ("Content-Type", "application/xml; charset=utf-8"),
        ],
        Some(body),
    )
    .await?;
    Ok(ensure_success(response, &format!("PROPFIND {url}"))?.body)
}

/// Runs the CalDAV discovery chain (principal -> calendar-home-set -> list
/// calendars) and finds or creates the "Worm World" calendar, returning its
/// full absolute URL. `base_host` is updated in place if the
/// calendar-home-set response points at a different (partitioned) host, per
/// iCloud's usual behavior.
async fn discover_worm_world_calendar(
    creds: &AppleCredentials,
    base_host: &mut String,
) -> Result<String, SyncError> {
    let principal_body = propfind(
        creds,
        &format!("{base_host}/"),
        "0",
        r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:current-user-principal/></d:prop>
</d:propfind>"#,
    )
    .await?;
    let principal_href = find_first_text(&principal_body, "href").ok_or_else(|| {
        SyncError::OAuth("iCloud did not return a current-user-principal".to_string())
    })?;
    let principal_url = resolve_url(base_host, &principal_href);

    let home_set_body = propfind(
        creds,
        &principal_url,
        "0",
        r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:prop><cal:calendar-home-set/></d:prop>
</d:propfind>"#,
    )
    .await?;
    let home_set_href = find_first_text(&home_set_body, "href")
        .ok_or_else(|| SyncError::OAuth("iCloud did not return a calendar-home-set".to_string()))?;
    let home_set_url = resolve_url(base_host, &home_set_href);
    if let Some(new_host) = host_of(&home_set_url) {
        *base_host = new_host;
    }

    let calendars_body = propfind(
        creds,
        &home_set_url,
        "1",
        r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname/>
    <cal:supported-calendar-component-set/>
  </d:prop>
</d:propfind>"#,
    )
    .await?;

    for block in split_response_blocks(&calendars_body) {
        // Pragmatic substring check rather than parsing the <comp name="VTODO"/>
        // attribute properly - safe here since this is our own discovery
        // response, not arbitrary input.
        if !block.contains("VTODO") {
            continue;
        }
        if find_first_text(&block, "displayname").as_deref() == Some(WORM_WORLD_CALENDAR_NAME) {
            if let Some(href) = find_first_text(&block, "href") {
                return Ok(resolve_url(&home_set_url, &href));
            }
        }
    }

    // Not found - create it.
    let new_calendar_url = format!("{}{}/", home_set_url.trim_end_matches('/'), Uuid::new_v4());
    let response = curl_request(
        creds,
        "MKCALENDAR",
        &new_calendar_url,
        &[("Content-Type", "application/xml; charset=utf-8")],
        Some(&format!(
            r#"<?xml version="1.0" encoding="utf-8"?>
<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:set>
    <d:prop>
      <d:displayname>{WORM_WORLD_CALENDAR_NAME}</d:displayname>
      <c:supported-calendar-component-set>
        <c:comp name="VTODO"/>
      </c:supported-calendar-component-set>
    </d:prop>
  </d:set>
</c:mkcalendar>"#
        )),
    )
    .await?;
    ensure_success(response, &format!("MKCALENDAR {new_calendar_url}"))?;

    Ok(new_calendar_url)
}

/// Connects an Apple Reminders account: runs discovery, finds/creates the
/// "Worm World" calendar, persists a `sync_accounts` row (`provider:
/// "apple"`), and stores the app-specific password via `oauth::store_secret`.
/// Only one Apple account is supported for phase 1 - connecting again
/// replaces the existing one, matching Google's phase-1 behavior.
pub async fn connect(
    state: &InnerDbState,
    email: &str,
    app_password: &str,
) -> Result<SyncAccount, SyncError> {
    // TEMPORARY diagnostic - lengths only, never the values themselves - to
    // rule out the frontend form not delivering what was typed intact.
    eprintln!(
        "connect_apple_reminders: email.len()={}, app_password.len()={}",
        email.len(),
        app_password.len()
    );

    let creds = AppleCredentials {
        email: email.to_string(),
        app_password: app_password.to_string(),
    };
    let mut base_host = INITIAL_HOST.to_string();
    let calendar_url = discover_worm_world_calendar(&creds, &mut base_host).await?;

    for existing in state.get_sync_accounts().await? {
        if existing.provider == "apple" {
            let _ = oauth::delete_secret(&existing.id);
            state.delete_sync_account(&existing.id).await?;
        }
    }

    let account = SyncAccount {
        id: Uuid::new_v4().to_string(),
        provider: "apple".to_string(),
        account_label: email.to_string(),
        remote_list_id: calendar_url,
        created_at: Utc::now().to_rfc3339(),
        last_synced_at: None,
    };
    state.insert_sync_account(&account).await?;
    oauth::store_secret(&account.id, app_password)?;

    Ok(account)
}

pub async fn disconnect(state: &InnerDbState, sync_account_id: &str) -> Result<(), SyncError> {
    oauth::delete_secret(sync_account_id)?;
    state.delete_sync_account(sync_account_id).await?;
    Ok(())
}

fn due_date_to_naive(due_date: &str) -> Option<chrono::NaiveDate> {
    super::google_tasks::parse_due_date(due_date)
}

fn naive_to_stored_string(date: chrono::NaiveDate) -> Option<String> {
    Some(
        chrono::DateTime::<Utc>::from_naive_utc_and_offset(date.and_hms_opt(0, 0, 0)?, Utc)
            .to_rfc3339(),
    )
}

/// Pushes a single task to the shared "Worm World" Reminders list, inserting
/// a new VTODO if this is the first time this task has synced or
/// overwriting the existing one otherwise (CalDAV has no partial PATCH -
/// every PUT resends the whole object). `title` is passed in for the same
/// reason as Google's `push_task` - genotype rendering is frontend-only. A
/// no-op if no Apple account is connected.
pub async fn push_task(state: &InnerDbState, task: &Task, title: &str) -> Result<(), SyncError> {
    let Some(account) = get_apple_account(state).await? else {
        return Ok(());
    };
    let _guard = super::acquire_sync_lock(&account.id).await;
    let creds = credentials_for(&account)?;

    let cross_design = state
        .get_cross_design(&task.cross_design_id)
        .await?
        .ok_or_else(|| SyncError::Db(format!("cross design {} not found", task.cross_design_id)))?;

    let existing_link = state.get_task_sync_link(&task.id, &account.id).await?;
    let uid = existing_link
        .as_ref()
        .map(|link| link.remote_id.clone())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let object_url = format!("{}{}.ics", account.remote_list_id, uid);

    let mut todo = Todo::new();
    todo.uid(&uid).summary(title);
    if let Some(notes) = &task.notes {
        todo.description(notes);
    }
    if let Some(due) = task.due_date.as_deref().and_then(due_date_to_naive) {
        todo.due(due);
    }
    todo.add_property("CATEGORIES", &cross_design.name);
    if task.completed {
        todo.status(TodoStatus::Completed);
        todo.completed(Utc::now());
    } else {
        todo.status(TodoStatus::NeedsAction);
    }
    let todo = todo.done();

    let mut calendar = Calendar::new();
    calendar.push(todo);
    let ics_body = calendar.to_string();

    let response = curl_request(
        &creds,
        "PUT",
        &object_url,
        &[("Content-Type", "text/calendar; charset=utf-8")],
        Some(&ics_body),
    )
    .await?;
    let response = ensure_success(response, &format!("PUT {object_url}"))?;
    let etag = response.etag;

    state
        .upsert_task_sync_link(&TaskSyncLink {
            task_id: task.id.clone(),
            sync_account_id: account.id,
            remote_id: uid,
            remote_updated_at: etag,
            local_updated_at: task.updated_at.clone(),
        })
        .await?;

    Ok(())
}

/// Pulls remote changes by re-listing every VTODO in the "Worm World"
/// calendar and comparing ETags against what's stored - phase 1 accepts the
/// cost of re-listing everything every time rather than tracking a
/// sync-token, the same trade-off already made for Google's
/// `updatedMin`-based polling. Per the confirmed conflict policy, only
/// `completed`/`dueDate` flow back, never title/notes/categories. A no-op if
/// no Apple account is connected.
pub async fn pull_updates(state: &InnerDbState) -> Result<Vec<Task>, SyncError> {
    let Some(account) = get_apple_account(state).await? else {
        return Ok(vec![]);
    };
    let _guard = super::acquire_sync_lock(&account.id).await;
    let creds = credentials_for(&account)?;

    let response = curl_request(
        &creds,
        "REPORT",
        &account.remote_list_id,
        &[
            ("Depth", "1"),
            ("Content-Type", "application/xml; charset=utf-8"),
        ],
        Some(
            r#"<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VTODO"/>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>"#,
        ),
    )
    .await?;
    let body = ensure_success(response, &format!("REPORT {}", account.remote_list_id))?.body;

    let mut changed = vec![];
    for block in split_response_blocks(&body) {
        let Some(href) = find_first_text(&block, "href") else {
            continue;
        };
        let Some(etag) = find_first_text(&block, "getetag") else {
            continue;
        };
        let Some(calendar_data) = find_first_text(&block, "calendar-data") else {
            continue;
        };

        let Some(link) = state
            .get_task_sync_link_by_remote_id(&account.id, &href_uid(&href))
            .await?
        else {
            // A reminder created directly in the Reminders app has nothing
            // to link to on the worm-world side - phase 1 only syncs tasks
            // worm-world already knows about.
            continue;
        };

        if link.remote_updated_at.as_deref() == Some(etag.as_str()) {
            continue;
        }

        let Ok(parsed) = calendar_data.parse::<Calendar>() else {
            continue;
        };
        let Some(remote_todo) = parsed.components.iter().find_map(|c| match c {
            CalendarComponent::Todo(t) => Some(t),
            _ => None,
        }) else {
            continue;
        };

        let Some(mut task) = state
            .get_tasks()
            .await?
            .into_iter()
            .find(|t| t.id == link.task_id)
        else {
            continue;
        };

        task.completed = remote_todo.get_status() == Some(TodoStatus::Completed);
        task.completed_at = if task.completed {
            Some(Utc::now().to_rfc3339())
        } else {
            None
        };
        if let Some(DatePerhapsTime::Date(date)) = remote_todo.get_due() {
            task.due_date = naive_to_stored_string(date).or(task.due_date);
        }
        task.updated_at = Some(Utc::now().to_rfc3339());
        state.update_task(&task).await?;

        state
            .upsert_task_sync_link(&TaskSyncLink {
                task_id: task.id.clone(),
                sync_account_id: account.id.clone(),
                remote_id: href_uid(&href),
                remote_updated_at: Some(etag),
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

/// `task_sync_links.remote_id` stores the object's UID (matching how
/// `push_task` names it, `<uid>.ics`) rather than the full href, so a
/// pulled object's href needs converting back to that same UID for lookup.
fn href_uid(href: &str) -> String {
    href.rsplit('/')
        .next()
        .unwrap_or(href)
        .trim_end_matches(".ics")
        .to_string()
}

async fn get_apple_account(state: &InnerDbState) -> Result<Option<SyncAccount>, SyncError> {
    Ok(state
        .get_sync_accounts()
        .await?
        .into_iter()
        .find(|a| a.provider == "apple"))
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn resolve_url_handles_absolute_and_relative_hrefs() {
        assert_eq!(
            resolve_url("https://caldav.icloud.com", "/200385701/principal/"),
            "https://caldav.icloud.com/200385701/principal/"
        );
        assert_eq!(
            resolve_url(
                "https://caldav.icloud.com",
                "https://p34-caldav.icloud.com/200385701/calendars/"
            ),
            "https://p34-caldav.icloud.com/200385701/calendars/"
        );
    }

    #[test]
    fn host_of_extracts_scheme_and_authority() {
        assert_eq!(
            host_of("https://p34-caldav.icloud.com/200385701/calendars/"),
            Some("https://p34-caldav.icloud.com".to_string())
        );
    }

    #[test]
    fn href_uid_strips_path_and_extension() {
        assert_eq!(
            href_uid("/200385701/calendars/AB12/9c1f2e3a-b4d5.ics"),
            "9c1f2e3a-b4d5"
        );
    }

    #[test]
    fn find_first_text_ignores_namespace_prefix() {
        let xml = r#"<d:multistatus xmlns:d="DAV:">
            <d:response><d:href>/foo/</d:href></d:response>
        </d:multistatus>"#;
        assert_eq!(find_first_text(xml, "href"), Some("/foo/".to_string()));
    }

    #[test]
    fn split_response_blocks_separates_each_response() {
        let xml = r#"<d:multistatus xmlns:d="DAV:">
            <d:response><d:href>/a/</d:href></d:response>
            <d:response><d:href>/b/</d:href></d:response>
        </d:multistatus>"#;
        let blocks = split_response_blocks(xml);
        assert_eq!(blocks.len(), 2);
        assert_eq!(find_first_text(&blocks[0], "href"), Some("/a/".to_string()));
        assert_eq!(find_first_text(&blocks[1], "href"), Some("/b/".to_string()));
    }
}
