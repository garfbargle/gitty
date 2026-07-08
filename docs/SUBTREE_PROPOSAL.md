# Linked folders — subtree support for Gitty

A proposal, written to match `SIMPLIFICATION_PLAN.md`: phased, independently
shippable, opinionated, and allergic to git vocabulary.

## North star

A **linked folder** is a folder in your repo that mirrors another repo. You add
it once. After that it gets the same two verbs everything else in Gitty gets:

- **Update** — pull the source repo's new work into the folder.
- **Send changes back** — push your local edits to the folder upstream (Phase 3,
  gated).

The files are *really in your repo* — committed, not pointed-at — so a fresh
clone just works. No second checkout, no detached HEAD, nothing to initialize.

The mechanism is `git subtree`, used internally — never named in the UI, the
same way worktrees are the hidden engine behind "Merge into main." The user
sees a folder and a button; git's history grafting stays git's problem.

## Why subtree, not submodule

This is the locked-in framing, and it's the whole reason the feature fits Gitty
rather than fighting it:

| Submodule | Subtree (linked folder) |
|---|---|
| A pointer to another repo | The actual files, committed in your tree |
| Clone needs a second step (`submodule update --init`) | Clone just works |
| Detached HEAD, `.gitmodules`, separate index | One repo, one index |
| Teaches the user five new nouns | Teaches them zero |

Submodules require exactly the terminal literacy the north star bans. Subtrees
push the complexity into git plumbing we hide. For a client whose pitch is "no
git vocabulary a non-terminal user wouldn't recognize," subtree is the only
choice that stays on-brand.

## The words (copy table — same idiom as Phase 4)

| Git | For humans |
|---|---|
| `git subtree add` | Add a linked folder |
| `git subtree pull` | **Update** (the same verb branches use) |
| `git subtree push` | Send changes back |
| `--prefix=<dir>` | the folder |
| `--squash` (always on) | *(never shown)* |
| `git-subtree-split: <sha>` | *(never shown)* |
| subtree `split` / `rejoin` | *(not exposed at all)* |
| vendoring / monorepo / prefix merge | *(never shown)* |

## Locked decisions

1. **Squash, always.** `--squash` on both add and update. Your history gets one
   tidy commit per sync ("Update `vendor/ui-kit` to v2.1"), never the foreign
   repo's entire commit history dumped into your log. One predictable behavior —
   the direct analogue of "Update from main = rebase, always."

2. **Inline URL, no remote pollution.** A linked folder carries its own source
   URL + branch. We do **not** create named git remotes for it. `git remote -v`
   and the Remotes section of the settings drawer stay about *your* repo's
   remotes, uncluttered.

3. **Update behaves like Update-from-main.** `git subtree pull` is a merge; on
   divergence it conflicts. We run it with an autostash guard, in place on the
   current branch, and route any conflict straight into the **existing**
   `ConflictResolver`. subtree pull leaves a standard merge state (`MERGE_HEAD`
   + unmerged files), and every conflict command already takes `path` and runs
   `normalize_repo` — so `merge_status`, `conflict_sides`, `resolve_conflict`,
   `complete_merge`, `abort_merge` all work against a linked-folder update with
   **zero component changes**. Same reuse dividend the merge/rebase collapse got.

4. **History is the source of truth; the manifest is a hint.** Squash commits
   carry `git-subtree-dir:` and `git-subtree-split:` trailers. So the *list* of
   linked folders and each one's last-synced point are **recovered from
   `git log`** — they survive a fresh clone with no config file at all. The one
   thing history doesn't record is *where the folder came from* (URL + branch).
   That lives in a small committed manifest so teammates get one-click Update
   too. If the manifest is missing, Gitty simply asks for the URL the first time
   you Update, then remembers. Deleting the manifest never breaks anything — it
   just costs a re-entry.

5. **Pull in before push back.** Updating a folder *from* upstream is the 90%
   case and low-risk. Pushing your local edits *back* upstream needs write access
   to the source and is genuinely advanced — it ships in Phase 3, behind a
   clear confirm, only after Update has proven out.

## Where it lives (no new screen)

The north star is "one screen, one timeline." Linked folders are repo
*configuration*, so their home is the existing **`RepoSettingsDrawer`**, in a
new **"Linked folders"** section directly under Remotes — reusing the same
draft-list-and-Save idiom that's already there.

Each row:

```
📁  vendor/ui-kit            github.com/acme/ui-kit · main     ● in sync
📁  docs/shared-guides       github.com/acme/guides · main     ↓2   [ Update ]
```

- folder icon · the folder path · source (`host/repo · branch`) · a status dot
  (green "in sync" / amber "2 updates") · an **Update** button, shown only when
  behind.
- **"Add linked folder"** opens a small dialog — folder name, git URL, branch —
  the same shape as `BranchCreateDialog` / `TagCreateDialog`.

Styling comes free from the existing tokens: `--accent` for the Update button,
`--success` / `--warning` for the status dot, `--radius-sm` rows,
`settings-field` / `settings-input` classes. Nothing new to design.

**Not in Phase 1/2:** a behind-chip on the timeline. Awareness surfacing is
Phase 3 — keep the one timeline untouched until the drawer version earns it.

## Backend plan (Rust — reuses every primitive)

All commands are `async` and offloaded via `tauri::async_runtime::spawn_blocking`,
exactly like `push_repo` / `file_diff` — subtree ops walk history *and* hit the
network, so they must never block the UI thread.

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkedFolder {
    prefix: String,          // "vendor/ui-kit"
    url: String,             // source repo
    branch: String,          // source ref
    behind: Option<i64>,     // updates available, None if unknown/offline
    last_synced_short: Option<String>,
    dirty: bool,             // uncommitted edits inside the folder
}
```

New commands:

- `list_linked_folders(path) -> Vec<LinkedFolder>` — scan `git log` for subtree
  trailers, merge with the manifest for URLs, compute `behind` by comparing the
  recorded split SHA against the source ref (a light `ls-remote`, or after a
  fetch).
- `add_linked_folder(path, prefix, url, branch) -> ActionResult` — validate the
  prefix is inside the repo and empty, then
  `git subtree add --prefix=<prefix> <url> <branch> --squash`; write the manifest
  entry.
- `update_linked_folder(path, prefix) -> UpdateOutcome` — autostash guard, then
  `git subtree pull --prefix=<prefix> <url> <branch> --squash`. Reuse the
  `UpdateOutcome` shape (`"updated" | "conflicts" | "up_to_date"`); on conflict
  return `conflict_files` and let the existing resolver + `complete_merge` finish.
- `remove_linked_folder(path, prefix, delete_files)` — drop the manifest entry;
  optionally `git rm -r <prefix>`.
- *(Phase 3)* `contribute_linked_folder(path, prefix) -> ActionResult` —
  `git subtree push --prefix=<prefix> <url> <branch>`.

Add one helper in the `git_raw` family — `git_subtree(...)` — because subtree,
like `merge`, signals conflicts via a non-zero exit while still producing useful
stdout.

**Honesty check:** `git subtree` ships as a contrib script and isn't guaranteed
on every Git. Probe once (`git subtree --help`); if it's absent, show a
plain-words "This copy of Git doesn't include subtree support" note instead of a
raw error. (Homebrew git and Git-for-Windows include it; some minimal Linux
builds don't.)

## Data model

`.gitty/subtrees.json` — committed, tiny, human-readable, created only on first
add:

```json
[
  { "folder": "vendor/ui-kit", "url": "https://github.com/acme/ui-kit.git", "branch": "main" }
]
```

It's a **hint cache, not the source of truth** — the folders and their sync
points come from history. That's what makes the feature robust: a teammate who
clones gets the folders regardless, and the manifest just spares them typing the
URL.

## Conflict story (verbatim reuse)

`git subtree pull` merges into HEAD. On conflict it leaves the standard merge
state that `merge_status` already detects (`rev_exists(MERGE_HEAD)`) and that
`resolve_conflict` / `conflict_sides` / `complete_merge` / `abort_merge` already
drive — all `path`-based. So a linked-folder update that conflicts flows through
the exact `ConflictResolver` UI the app already ships, with the labels reading
naturally ("your version" / "the source's version"). **No new conflict UI.**

## Phasing (independently shippable)

**Phase 1 — Backend primitives, no UI change. — DONE**

- [x] `SubtreeManifestEntry` + `LinkedFolder` structs (Rust) and the `LinkedFolder`
      TS type (`src/types.ts`). Manifest decision locked: **committed**
      `.gitty/subtrees.json`.
- [x] Helpers: `subtree_manifest_path` / `read_subtree_manifest` /
      `write_subtree_manifest` (hint cache — a missing/corrupt manifest is never
      fatal); `subtree_available` / `ensure_subtree_available` (probe the contrib
      script, plain-words error when absent); `git_subtree` (editors + prompts
      disabled, `git_raw`-style); `validate_prefix` (reject absolute / `..` /
      empty); `discover_subtree_prefixes` (recover folders + last-synced short SHA
      from the `git-subtree-dir:` / `git-subtree-split:` squash trailers, so the
      list survives a fresh clone with no manifest); `subtree_pull_outcome`.
- [x] Commands, registered in `generate_handler!`: `list_linked_folders`
      (local-only, no network — Update fetches on demand), `add_linked_folder`
      (`subtree add --squash` → write manifest), `update_linked_folder`
      (clean-tree guard → `subtree pull --squash`; conflicts return the shared
      `UpdateOutcome`), `remove_linked_folder` (drop manifest; optional staged
      `git rm -r`).
- [x] `cargo check` clean; `tsc --noEmit` clean.
- [x] Git-level smoke test (11 checks, all pass): add; trailer discovery; clean
      pull after upstream moves; up-to-date no-op; conflict → unmerged files +
      `MERGE_HEAD` → resolve → commit (the existing `complete_merge` path) →
      clean tree; `git rm -r` staged for a normal commit.
- Finding folded into code: `git subtree pull` reports a no-op as **"Subtree is
  already at commit …"**, not "up to date" — `subtree_pull_outcome` matches it so
  a no-op isn't mislabeled "Updated".

Invisible release. Nothing user-facing changed yet.

### Decisions taken during Phase 1 (were open in the proposal)
- **Update requires a clean tree** rather than autostashing. A subtree pull is a
  merge and can't `--autostash`; stashing *around* a possibly-conflicting merge
  complicates completion. v1 returns a plain-words "save or set aside your
  changes first." Autostash-around parked for later.
- **The manifest write is an uncommitted change** to `.gitty/subtrees.json` after
  `subtree add`, committed by the user through the normal flow (so teammates
  inherit it). Not auto-committed — that would be a surprise write.
- **`known_source`** added to `LinkedFolder`: a folder recovered from history
  without a manifest hint is still listed (Update disabled until the UI collects
  its URL). Wires up the graceful-degradation path from Locked Decision 4.

**Phase 2 — The drawer. — DONE (needs live check)**

- [x] `LinkedFoldersSection` inside `RepoSettingsDrawer` (under Remotes): loads via
      `list_linked_folders`, lists each folder as `icon · prefix · source·branch ·
      "edited"?` with an **Update** button and a remove (trash) button. Empty state
      pitches the feature in plain words.
- [x] Inline **Add linked folder** form (folder / URL / branch, branch defaults to
      `main`) — the Remotes-draft idiom, not a stacked modal. Calls
      `add_linked_folder`.
- [x] `src/lib/subtrees.ts` — typed `invoke` wrappers (`listLinkedFolders`,
      `addLinkedFolder`, `updateLinkedFolder`, `removeLinkedFolder`), mirroring
      `lib/repoIcons.ts`.
- [x] Conflict reuse with **no `ConflictResolver` changes**: `IntegrationOp` gains a
      `"subtree"` kind (+ `prefix`). `runLinkedFolderUpdate` closes the drawer on
      conflict and hands off to the shared resolver; a subtree pull is a merge, so
      it *completes* via `complete_merge` and *aborts* via `abort_merge` (the merge
      branches of `completeIntegration` / `cancelIntegration`), resolving in the
      main checkout (`conflictPath` = the repo, no worktree). Labels read
      "your work" vs "`<prefix>` source"; the panel says "Update `<prefix>` from
      its source" / "Finish update".
- [x] Subtree ops are gated out of the timeline `integrationPreview` — a folder
      pull isn't a branch integration, so the one timeline is untouched.
- [x] CSS for `.subtree-list` / `.subtree-item` / `.subtree-add-form`, all on the
      existing tokens (light/dark parity free).
- [x] `tsc --noEmit` clean; `npm run build` clean (JS 327 KB); `cargo check` clean
      (the `.exists()` list filter — see below).

### Decisions taken during Phase 2
- **Discovery must gate on presence.** History keeps a removed subtree's squash
  commits forever, so `list_linked_folders` now filters to prefixes whose folder
  still exists on disk. This is what makes removal actually drop a folder from the
  list.
- **Remove = unlink + delete files** (one action, clear confirm): drops the
  manifest entry *and* stages `git rm -r` for the user's next commit. Keeping files
  while forgetting the source is a confusing half-state, so it isn't a button
  (the backend still supports `deleteFiles: false`).
- **Update requires a known source.** A folder recovered from history without a
  manifest hint lists with its Update disabled and a "re-add to set the source"
  tooltip. Inline source-editing is deferred.

### NEEDS LIVE VERIFICATION
Backend sequences are smoke-tested (Phase 1) and the React is build-verified, but
the click-path can't be driven headlessly. A real run should confirm: Add a folder
→ it appears + `.gitty/subtrees.json` shows in Changes; Update clean → toast +
timeline gains a squash commit; Update with a conflict → drawer closes, resolver
opens, Finish update commits and returns to now; Remove → folder leaves the list
and a staged deletion appears.

**Phase 3 — Awareness + Send changes back.** Optional behind-chip surfacing, and
the gated `contribute_linked_folder`. Only after Phase 2 proves out.

## What we deliberately don't build

- No `subtree split`, no rejoin, no history surgery UI.
- No submodule support — subtree is the opinionated pick, not one option of two.
- No foreign per-commit history in your log (that's what squash buys).
- No named remotes per folder.
- No timeline changes in Phases 1–2.

## The one decision to lock

Everything above is settled except this, and it's a genuine judgment call:

> **Manifest committed to the repo, or stored gitty-local?**

Recommendation: **committed.** It gives teammates one-click Update and matches
subtree's whole "it just works for everyone who clones" value. The
history-marker fallback means either choice degrades gracefully — worst case
without a manifest, Gitty asks for the URL once and remembers it. But committed
is the choice that makes linked folders feel like a property of the repo rather
than a private note on one machine.

## NEEDS LIVE VERIFICATION (before shipping Phase 2)

Per house style, the git *sequences* are smoke-testable headless, but confirm in
a real run: that `git subtree pull --squash` on a diverged folder leaves exactly
the merge state `complete_merge` expects; that `behind` computes correctly
against a moving source; and that the recover-from-history path repopulates the
list after the manifest is deleted.
