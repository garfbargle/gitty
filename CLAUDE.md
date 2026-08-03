# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Standing quality contract

`AGENTS.md` and `CONSTITUTION.md` apply in full to every session and delegated
agent. Before implementation, fixes, refactors, UI changes, or review, load the
project `gitty-quality` skill, `docs/README.md`, relevant specs/ADRs, and
relevant portions of `DESIGN.md`. Establish the observable problem and root
cause before editing; report reproducible verification rather than an
unsupported completion claim.

Every subagent prompt must name its objective, exact scope, acceptance
behavior, required corpus, and verification. Keep review agents read-only.
Concurrent writers or stateful verification runs use isolated Git worktrees so
one agent cannot move the commit or mutate the files another agent is judging.
These are Gitty rules; they do not import another project's workflow runtime.

## What this is

Gitty is a cross-platform Tauri 2 desktop Git client: React 19 + TypeScript frontend (`src/`), Rust backend (`src-tauri/`). It shells out to the system `git` binary — there is no embedded Git library (no libgit2/gitoxide). Anything Git-related is implemented by constructing argv for `git -C <repo> …` and parsing the output.

There is also `web-demo/` — a **separate product**: a simulated, browser-only Git workflow deployed to Cloudflare for gitty.c0di.com. It never touches local repos or the shell. Do not share code or logic between it and the desktop app.

## Commands

```bash
npm install
npm run tauri dev          # run the desktop app (Vite on :1420 + Rust)

npm run build              # tsc && vite build — the frontend typecheck gate
cd src-tauri && cargo check # the Rust gate
cd src-tauri && cargo test  # Rust unit tests (the only tests in the repo)
cd src-tauri && cargo test --lib editors::tests::<name>   # single test

npm run dev:demo           # web demo dev server
npm run build:demo
npm run deploy:demo        # wrangler deploy

npm run tauri build        # unsigned bundle for the current platform
npm run build:macos        # signed + notarized (needs .env.macos-signing.local)
npm run build:windows      # NSIS + MSI, run on Windows
```

There is no linter and no frontend test runner. `npm run build` and `cargo check` are the checks.

## Architecture

### The frontend/backend contract

Every backend capability is a `#[tauri::command]` registered in the `generate_handler!` list at the bottom of `src-tauri/src/lib.rs` (~90 commands). The frontend calls them with `invoke<T>("command_name", { … })`.

Payload structs are `#[serde(rename_all = "camelCase")]`, so Rust `ahead_commits` arrives in TS as `aheadCommits`. TS mirrors of these structs live in `src/types.ts` and are maintained **by hand** — nothing generates them. Changing a Rust payload struct means editing `src/types.ts` in the same change, or the mismatch only shows up at runtime.

Adding a command requires three edits: the `#[tauri::command]` fn, its entry in `generate_handler!`, and the TS type + call site.

### Rust backend layout (`src-tauri/src/`)

- `lib.rs` (~5.3k lines) — every Git operation plus the command registry. The core helpers are `git()` / `git_owned()` (capture output, `Err` on non-zero exit with the full command echoed into the message), `git_raw()` (returns `(success, stdout, stderr)` when a non-zero exit is expected), and `git_network_owned{,_with_progress}()` — the network variants spawn `git` with piped stdio and an **activity-based** watchdog (idle timeout, deliberately no total-runtime cap, so a slow-but-progressing backup isn't killed). All variants set `GIT_TERMINAL_PROMPT=0`; Git must never block on an interactive credential prompt.
- `discovery.rs` — background scan of standard dev directories for repos, streamed to the UI via `repo-discovery-started` / `repo-discovery-finished` events.
- `summarize.rs` — NVIDIA NIM (Llama 3.1 8B) commit-message generation from staged diffs.
- `settings.rs` — app-level settings persisted as JSON in the Tauri app config dir (includes the NVIDIA API key, which stays local).
- `runner.rs` — detects npm/cargo/make/script tasks in a repo and streams their stdout/stderr to the UI as `action-output` / `action-finished` events.
- `repo_icon.rs`, `editors.rs` — per-repo icon resolution; IDE/editor detection and launch.

### Frontend layout (`src/`)

`App.tsx` (~3.6k lines) is the single stateful container. Components under `src/components/` are largely presentational and receive state + callbacks as props; `src/lib/` holds pure helpers (diff parsing, graph layout, timeline navigation, status-code formatting) that are the right place for new logic.

### Refresh model — the part that bites

There is **no polling**. State refreshes only on explicit user action, window focus, or after an operation completes. `repo_snapshot` is the one fat read that returns branch, changes, commits, graph, remotes, branches, tags and divergence in a single call (it fans out across `std::thread::scope` internally); `repo_changes`, `repo_enrich` and `repo_focus_state` are the narrower follow-ups.

Because refreshes are concurrent and a fast repo-switch can land stale results, `App.tsx` guards every async read with a monotonic counter compared against a ref before committing to state — `selectRepoRequestRef`, `snapshotGenerationRef`, `changesRefreshRequestRef`. A late result whose generation no longer matches is **dropped, not applied**. The backend can also abort a superseded snapshot with the `__superseded__` sentinel, which the frontend swallows silently rather than surfacing as an error. Any new async read into shared state needs the same guard, or you reintroduce the stale-overwrite bug these exist to prevent.

Staging is optimistic: `src/lib/git.ts` (`applyStageToChanges`) rewrites the two-character porcelain status locally for instant feedback, then a real refresh reconciles.

## Product direction

`docs/SIMPLIFICATION_PLAN.md` and `docs/SUBTREE_PROPOSAL.md` are the live design docs and encode locked decisions worth honoring:

- **No Git vocabulary in the UI.** Users see "Update from main", "Merge into main", "linked folder" — never rebase, subtree, worktree, detached HEAD.
- **"Update from main" is always `git rebase --autostash`** — one predictable behavior.
- **Worktrees and `git subtree` are hidden engines**, used so operations on other branches never change the user's checkout out from under them.
- Nothing moves the user's files without an explicitly worded confirmation.
- Push force is always `--force-with-lease`.

## Releases

Version lives in three places — `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`. Pushing a `v*` tag triggers `.github/workflows/release-windows.yml`, which runs `scripts/sync-version-from-tag.mjs` to reconcile all three from the tag before building. Tag and app version must match.
