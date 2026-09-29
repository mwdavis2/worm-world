# WormWorld

![WormWorld](public/wormworld_logo.svg)

A desktop application for geneticists to design strains of _C. Elegans_ worms and schedule cross-breeding tasks.

## Getting started

This application utilizes the Tauri framework to enable the project to build on MacOS, Windows and Linux.

1. Install [Node](https://nodejs.org/en/download/)
2. Install [Rust](https://www.rust-lang.org/tools/install) and run `rustup component add clippy`
3. Install the `sqlx` CLI by running `cargo install sqlx-cli`
4. Platform-specific system dependencies (this project's own CI only exercises macOS/Windows, so the Linux list isn't verified against this repo directly - see [Tauri's own prerequisites guide](https://tauri.app/v1/guides/getting-started/prerequisites) if something doesn't match your setup):
   - **macOS**: the Xcode Command Line Tools - `xcode-select --install` if you don't already have them.
   - **Windows**: Rust's `x86_64-pc-windows-msvc` target (the default on Windows) needs the MSVC linker, which doesn't come with Rust itself - install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **"Desktop development with C++"** workload checked. You also need the [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) - already preinstalled on current Windows 10/11, but worth checking on an older or Server image. If you additionally want to produce a `.msi` installer via `npm run tauri build` (not needed for `npm run tauri dev`), install the [WiX Toolset v3](https://wixtoolset.org/) too.
   - **Linux**: a few packages to build Tauri's native webview. On Debian/Ubuntu:
     ```
     sudo apt update
     sudo apt install libwebkit2gtk-4.0-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
     ```
5. Run `npm install` to install the frontend dependencies.
6. Run `npm run tauri dev`.
7. On the first run above, the database URL is printed out.
   It looks like `sqlite:///<ABSOLUTE PATH TO DB>`.
   Create a `.env` file in the `src-tauri/` folder and add `DATABASE_URL="<THAT DATABASE URL>"` (using the URL format from above _including_ the `sqlite:///`). On Windows, you may need to switch the slash directions.

   > On the first run, we rely on the `sqlx-data.json` file for the database schema info. Once `DATABASE_URL` is specified, it actually queries the database at compile time for the schema. When making schema changes in the database, after you've run a program with new migrations, run `cargo sqlx prepare` to sync that file with the actual schema of the database. This could be a good thing to check in CI/CD with `cargo sqlx prepare --check`.

### Testing task sync (optional)

The scheduling view can sync tasks two-way with Google Tasks and/or Apple Reminders. Neither is required to build or run the app - without them, the "Sync now" button is just a no-op.

- **Google Tasks** needs your own OAuth client, since the project doesn't ship one: in the [Google Cloud Console](https://console.cloud.google.com/), create a project, enable the Tasks API, and create an OAuth 2.0 Client ID of type **Desktop app** (not "Web application" - the app listens on a random localhost port for the redirect, which only the Desktop app client type allows without pre-registering an exact URI). Add the resulting values to `src-tauri/.env`:
  ```
  GOOGLE_CLIENT_ID="<your client id>"
  GOOGLE_CLIENT_SECRET="<your client secret>"
  ```
- **Apple Reminders** needs no setup or `.env` entry - connect it directly from the app's Settings page using an Apple ID and an [app-specific password](https://appleid.apple.com/account/manage).

## Notable Scripts

You can view all available scripts in `package.json`.

- `npm run tauri dev` runs the frontend and backend together
- `npm run tauri build` builds the project into an executable for your platform.
  > On MacOS, run `npm run tauri build -- --target universal-apple-darwin` for a universal binary.
- `npm run test-all` tests the frontend (`vitest`) and backend (`cargo test`)
- `npm run lint` lints the frontend and backend, gives warnings and suggestions, and auto-fixes some formatting errors.
  If your precommit script fails at the linting phase, run this.
- `npm run storybook` launches the storybook server to see components in isolation

## Info

Right now, there are models in 3 places:

1. `src/models/`: This folder has the frontend type models
2. `src-tauri/src/models.rs`: This file has the backend type models
   > Notice the `serde(rename)` decorators that keep the field names consistent between frontend and backend for (de)serialization.
3. `src-tauri/db/migrations/`: This folder holds the SQL migrations.
   The files here should be created with `sqlx migrate add -r <name>`, then you can edit the up and down SQL files.
   - The up commands are run automatically in the `migrate!` method in the program or with `sqlx migrate run`
   - The down commands are only relevant for us in development. You can run `sqlx migrate revert`

The backend code is located in the `src-tauri` folder.

The frontend code is located in the `src` folder.

## Architecture: reusing this as a template

If you're using worm-world as a starting point for a different domain (not _C. elegans_ genetics), here's the boundary between generic scaffolding and genetics-specific code.

**Start here to understand the generic shape**, before diverging into domain-specific work:

- `src-tauri/src/main.rs` - Tauri bootstrap (SQLite pool setup, state management, a background sync-poll loop, and command registration). The registration *pattern* is generic; the specific command list fans out into domain entities immediately.
- `src/main.tsx` + `src/components/Layout/Layout.tsx` - the router/layout shell and the app's nav item list. Both are generic and trivial to retarget for a different set of pages.
- `src-tauri/src/models/filter.rs` + `src-tauri/src/interface/bulk.rs` - a generic filter-group query-building abstraction and a bulk-insert-from-file helper, reused by every entity.
- `src/models/db/` - TypeScript types auto-generated by `ts-rs` from Rust structs (one `db_X.ts` per Rust struct with `#[ts(export)]`). The codegen _pattern_ is generic; the generated files themselves mirror the domain.

**Fully generic, portable as-is:**

- The task-scheduling two-way sync engine (`src-tauri/src/sync.rs`, `sync/google_tasks.rs`, `sync/apple_reminders.rs`, `sync/oauth.rs`) - the OAuth flow, per-account async lock, access-token cache, and both providers' push/pull transports only ever see a plain title string plus a due date/completed/notes/timestamp. None of it references genetics types.
- The react-flow canvas shell (`src/components/Editor/`, `CustomControls/`, `MiddleNode/`, `NoteNode/`, `src/hooks/useFitScale.ts`) and the SVG export layout-resolution engine (`src/utils/svgExport/`) - both are parameterized by node type/size, not hard-coded to strains.
- The Settings page structure and `src/utils/preferences.ts`.

**Mixed - generic shape, genetics baked in:**

- The `Task`/`Action` model and its UI (`TaskItem.tsx`, `TaskList.tsx`, `ToDoView.tsx`). The scheduling _shape_ (due date, completed, notes, sync links) is generic, but the `Task` row hard-codes `herm_strain`/`male_strain`/`result_strain` fields and an `Action` enum (`Cross`/`SelfCross`/`Freeze`/`Pcr`) directly on the row, and the human-readable title sent to Google/Apple is generated from those fields (`TaskItem.tsx`'s `getTaskStatementText`). Swapping in a different domain's "work item" concept means replacing this schema/title logic, not the sync engine itself.

**Domain-specific, expected to be replaced:**

- The genetics models (`Strain`, `Allele`, `Gene`, `Phenotype`, `Condition`, `CrossDesign`, `Variation`) in both `src/models/frontend/` and `src-tauri/src/models/`.
- The breeding-probability engine (`Strain.ts`, `ChromosomePair.ts`, `AllelePair.ts`).
- Cross-designer node types (`StrainNode`), genetics-specific UI (`StrainCard`, `NewAlleleModal`, `StrainFilterModal`, `GeneSearchInput`, and similar), and the data-table pages under `src/pages/data-tables/`.

### Precommits

Right now, we don't have CI/CD running checks on each PR.
Instead, we've set up a precommit Git hooks that run locally before commiting.
Currently, they run the following checks:

- check if a commit message is valid as a [conventional commit](https://www.conventionalcommits.org/en/v1.0.0/).
- Lints the frontend with ESLint
- Auto-formats the backend and frontend code

Additionally, we have a mirrored Github repo that generates builds for each major OS when we push tags to it. The repo is hosted at [https://github.com/worm-world/worm-world](https://github.com/worm-world/worm-world).
