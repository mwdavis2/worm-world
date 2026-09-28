use super::SyncError;
#[cfg(not(debug_assertions))]
use super::KEYRING_SERVICE;
#[cfg(not(debug_assertions))]
use keyring::Entry;
use oauth2::basic::{BasicClient, BasicTokenResponse};
use oauth2::{
    AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, PkceCodeChallenge,
    PkceCodeVerifier, RedirectUrl, RefreshToken, Scope, TokenUrl,
};
use std::time::Duration;
use tauri::Manager;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const TASKS_SCOPE: &str = "https://www.googleapis.com/auth/tasks";
const EMAIL_SCOPE: &str = "https://www.googleapis.com/auth/userinfo.email";
const AUTH_TIMEOUT: Duration = Duration::from_secs(300);

pub struct GoogleOAuthConfig {
    pub client_id: String,
    pub client_secret: String,
}

impl GoogleOAuthConfig {
    /// Reads GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET, populated into the process
    /// environment from `src-tauri/.env` via `dotenvy::dotenv()` in `main()`.
    pub fn from_env() -> Result<Self, SyncError> {
        let client_id = std::env::var("GOOGLE_CLIENT_ID").map_err(|_| {
            SyncError::Config("GOOGLE_CLIENT_ID is not set - add it to src-tauri/.env".to_string())
        })?;
        let client_secret = std::env::var("GOOGLE_CLIENT_SECRET").map_err(|_| {
            SyncError::Config(
                "GOOGLE_CLIENT_SECRET is not set - add it to src-tauri/.env".to_string(),
            )
        })?;
        Ok(Self {
            client_id,
            client_secret,
        })
    }
}

fn build_client(
    config: &GoogleOAuthConfig,
    redirect_uri: String,
) -> Result<BasicClient, SyncError> {
    let client = BasicClient::new(
        ClientId::new(config.client_id.clone()),
        Some(ClientSecret::new(config.client_secret.clone())),
        AuthUrl::new(AUTH_URL.to_string()).map_err(|e| SyncError::OAuth(e.to_string()))?,
        Some(TokenUrl::new(TOKEN_URL.to_string()).map_err(|e| SyncError::OAuth(e.to_string()))?),
    )
    .set_redirect_uri(RedirectUrl::new(redirect_uri).map_err(|e| SyncError::OAuth(e.to_string()))?);
    Ok(client)
}

/// Runs the full "installed app" OAuth flow: starts a one-shot loopback HTTP
/// listener, opens the system browser to Google's consent screen, waits for
/// the redirect, and exchanges the resulting code for tokens. Returns the
/// access token (short-lived) and refresh token (long-lived, to be stored in
/// the OS keychain by the caller).
pub async fn run_auth_flow(
    config: &GoogleOAuthConfig,
    app_handle: &tauri::AppHandle,
) -> Result<BasicTokenResponse, SyncError> {
    let server = tiny_http::Server::http("127.0.0.1:0")
        .map_err(|e| SyncError::OAuth(format!("failed to start local redirect listener: {e}")))?;
    let port = server
        .server_addr()
        .to_ip()
        .ok_or_else(|| SyncError::OAuth("local redirect listener has no IP address".to_string()))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    let client = build_client(config, redirect_uri)?;
    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

    let (auth_url, csrf_token) = client
        .authorize_url(CsrfToken::new_random)
        .add_scope(Scope::new(TASKS_SCOPE.to_string()))
        .add_scope(Scope::new(EMAIL_SCOPE.to_string()))
        .add_extra_param("access_type", "offline")
        .add_extra_param("prompt", "consent")
        .set_pkce_challenge(pkce_challenge)
        .url();

    tauri::api::shell::open(&app_handle.shell_scope(), auth_url.as_str(), None)
        .map_err(|e| SyncError::OAuth(format!("failed to open browser: {e}")))?;

    let (code, returned_state) = wait_for_redirect(server).await?;
    if returned_state.secret() != csrf_token.secret() {
        return Err(SyncError::OAuth(
            "OAuth state mismatch - possible CSRF, aborting".to_string(),
        ));
    }

    exchange_code(&client, code, pkce_verifier).await
}

async fn wait_for_redirect(
    server: tiny_http::Server,
) -> Result<(AuthorizationCode, CsrfToken), SyncError> {
    tokio::task::spawn_blocking(move || {
        let request = server
            .recv_timeout(AUTH_TIMEOUT)
            .map_err(|e| SyncError::OAuth(format!("redirect listener error: {e}")))?
            .ok_or(SyncError::AuthTimeout)?;

        let full_url = format!("http://127.0.0.1{}", request.url());
        let parsed =
            oauth2::url::Url::parse(&full_url).map_err(|e| SyncError::OAuth(e.to_string()))?;

        let mut code = None;
        let mut state = None;
        for (key, value) in parsed.query_pairs() {
            match key.as_ref() {
                "code" => code = Some(value.into_owned()),
                "state" => state = Some(value.into_owned()),
                _ => {}
            }
        }

        let response_body = if code.is_some() {
            "<html><body>Sign-in complete - you can close this tab and return to worm-world.</body></html>"
        } else {
            "<html><body>Sign-in was not completed - you can close this tab.</body></html>"
        };
        let response = tiny_http::Response::from_string(response_body).with_header(
            tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html"[..])
                .expect("static header is valid"),
        );
        let _ = request.respond(response);

        match (code, state) {
            (Some(code), Some(state)) => {
                Ok((AuthorizationCode::new(code), CsrfToken::new(state)))
            }
            _ => Err(SyncError::OAuth(
                "Google did not return an authorization code".to_string(),
            )),
        }
    })
    .await
    .map_err(|e| SyncError::OAuth(format!("redirect listener task panicked: {e}")))?
}

async fn exchange_code(
    client: &BasicClient,
    code: AuthorizationCode,
    pkce_verifier: PkceCodeVerifier,
) -> Result<BasicTokenResponse, SyncError> {
    client
        .exchange_code(code)
        .set_pkce_verifier(pkce_verifier)
        .request_async(oauth2::reqwest::async_http_client)
        .await
        .map_err(|e| SyncError::OAuth(format!("token exchange failed: {e}")))
}

/// Exchanges a stored refresh token for a fresh, short-lived access token.
/// Called before every push/pull rather than caching an access token, since
/// this app has no existing background-token-refresh scheduler and access
/// tokens are cheap to re-derive (Google does not rate-limit this path
/// meaningfully for a single-user desktop client).
pub async fn refresh_access_token(
    config: &GoogleOAuthConfig,
    refresh_token: &str,
) -> Result<BasicTokenResponse, SyncError> {
    // The redirect URI is unused for a refresh-token grant, but oauth2's
    // BasicClient requires one to be set at construction time.
    let client = build_client(config, "http://127.0.0.1:0/callback".to_string())?;
    client
        .exchange_refresh_token(&RefreshToken::new(refresh_token.to_string()))
        .request_async(oauth2::reqwest::async_http_client)
        .await
        .map_err(|e| SyncError::OAuth(format!("token refresh failed: {e}")))
}

#[cfg(not(debug_assertions))]
fn keyring_entry(sync_account_id: &str) -> Result<Entry, SyncError> {
    Entry::new(KEYRING_SERVICE, sync_account_id).map_err(SyncError::from)
}

/// Debug builds only: `tauri dev` recompiles the binary on every source
/// change, and since each rebuild isn't stably code-signed, macOS treats it
/// as a new app and re-prompts for Keychain access every time. Rather than
/// eat that dialog on every hot-reload during development, debug builds
/// store the refresh token in a plain local file instead - **plaintext on
/// disk**, only ever on the developer's own machine, never in a release
/// build (gated by `cfg(debug_assertions)`, which is false for `tauri
/// build`). Release builds always use the OS keychain via `keyring_entry`.
#[cfg(debug_assertions)]
fn dev_token_path(sync_account_id: &str) -> Result<std::path::PathBuf, SyncError> {
    let proj_dirs = directories::ProjectDirs::from("edu", "UofUBiology", "WormWorld")
        .ok_or_else(|| SyncError::Config("no project data directory".to_string()))?;
    let dir = proj_dirs.data_dir().join("dev-refresh-tokens");
    std::fs::create_dir_all(&dir)
        .map_err(|e| SyncError::Config(format!("failed to create dev token dir: {e}")))?;
    Ok(dir.join(format!("{sync_account_id}.token")))
}

pub fn store_refresh_token(sync_account_id: &str, refresh_token: &str) -> Result<(), SyncError> {
    #[cfg(debug_assertions)]
    {
        std::fs::write(dev_token_path(sync_account_id)?, refresh_token)
            .map_err(|e| SyncError::Config(format!("failed to write dev token file: {e}")))
    }
    #[cfg(not(debug_assertions))]
    {
        keyring_entry(sync_account_id)?.set_password(refresh_token)?;
        Ok(())
    }
}

pub fn get_refresh_token(sync_account_id: &str) -> Result<String, SyncError> {
    #[cfg(debug_assertions)]
    {
        std::fs::read_to_string(dev_token_path(sync_account_id)?)
            .map_err(|e| SyncError::Config(format!("failed to read dev token file: {e}")))
    }
    #[cfg(not(debug_assertions))]
    {
        Ok(keyring_entry(sync_account_id)?.get_password()?)
    }
}

pub fn delete_refresh_token(sync_account_id: &str) -> Result<(), SyncError> {
    #[cfg(debug_assertions)]
    {
        match std::fs::remove_file(dev_token_path(sync_account_id)?) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(SyncError::Config(format!(
                "failed to remove dev token file: {e}"
            ))),
        }
    }
    #[cfg(not(debug_assertions))]
    {
        keyring_entry(sync_account_id)?.delete_password()?;
        Ok(())
    }
}
