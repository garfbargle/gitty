# Gitty simplification plan

Working file. Check items off as phases land; add notes inline. Each phase is
independently shippable, in order. Phase 4 depends on Phase 1.

## North star

One screen. One timeline that's always visible. Two verbs on it. Nothing ever
moves the user's files without a clearly-worded ask. No git vocabulary that a
person who's never used a terminal wouldn't recognize.

The mechanism that makes this possible is **git worktrees, used internally** —
not a headline feature, but the reason the app stops jumping: operations on
*other* branches happen in *other* folders, so the user's checkout never
changes out from under them.

## Locked decisions

1. **"Update from main" = rebase, always.** `git rebase --autostash`. One
   predictable behavior; `--force-with-lease` push already exists for after.
2. **Timeline lanes: main + current branch**, plus **one sibling lane** for the
   branch whose tip commit is newer than main's tip (the "most recently active
   other branch"), when one exists. No lane forest.
3. **History table is deleted.** The timeline + click-to-see-diff replaces it.
   Future idea (not now): render *all* other branches as super-faint strands on
   the timeline as the one-spot-to-see-everything view.

## Why (verified findings, 2026-07-03)

- No `git rebase` support exists anywhere in `src/` or `src-tauri/` — yet
  "get back onto main" is the app's most-needed verb.
- No `git worktree` support exists anywhere.
- `merge_execute` (`src-tauri/src/lib.rs`) runs `git switch <target>` before
  merging — "Merge into main" physically moves the user onto main, which is
  what forces the `returnBranch` bookkeeping and "Back to working tree" button.
- "Return to {branch}" is a `git reset --hard` behind a `window.confirm`
  (`src/App.tsx` `resumeBranch`) — one misread dialog from data loss.
- Switching branches with unsaved changes fails with raw git error text
  (`checkout_branch` is a bare `git switch`, no autostash).
- Merge UI lives in 3 places (TopBar strip, MergePanel wizard, ConflictResolver);
  the wizard has a fake step (`fetchState = done ? "done" : "done"` — shows
  "Fetch latest · Up to date" without ever fetching) and its "Update target"
  step ignores failure (`let _ = git_raw(... "--ff-only" ...)`).
- `App.tsx` is ~2,970 lines with 40 `useState` hooks and four overlapping
  modes: `viewMode`, `viewingCommit` (preview), `visitSession` (detached
  checkout), `mergeSession` — each with its own escape-hatch button.
- Ahead/behind counts render in 3 different places (PushButton, context chips,
  merge strip).
- Clicking a timeline commit is already a safe preview (no disk change) — keep
  that behavior; only chrome churn needs fixing.

---

## Phase 1 — Backend primitives (Rust only, no UI change) — DONE

- [x] Shared helpers: `git_rebase` (editor-disabled runner), `combine_output`,
      `rebase_in_progress`, `ensure_worktree`, `existing_worktree_for`,
      `worktrees_root` / `repo_key` / `sanitize_ref`, `sibling_tip`.
- [x] `update_branch(path, onto)` — `git rebase --autostash <onto>` (onto
      defaults to trunk). Returns `UpdateOutcome { status: "updated" |
      "conflicts" | "up_to_date", conflictFiles, message, output }`.
- [x] `update_continue(path)` / `update_abort(path)` / `update_status(path)` —
      wrappers over `git rebase --continue / --abort` + git-path detection of
      `rebase-merge` / `rebase-apply`.
- [x] `ensure_worktree(repo, branch)` — lazily create/reuse a linked worktree
      under `<temp>/gitty-worktrees/<repo-key>/<branch>` (temp dir avoids
      AppHandle plumbing; scratch space, recreated on demand). Handles: trunk
      already checked out in the main folder (operate in place), git-known
      existing worktree (reuse), stale dirs (`worktree prune` + remove).
- [x] `merge_into_trunk(path, source)` — merge runs **inside the trunk
      worktree**; user's checkout/branch/uncommitted work untouched. Returns
      `MergeOutcome` with a `worktree` path. Because every conflict command
      (`resolve_conflict`, `conflict_sides`, `complete_merge`, `abort_merge`)
      already takes `path` and runs `normalize_repo` (which resolves a
      worktree's own toplevel), they work against the worktree with **no
      changes** — the frontend just passes `outcome.worktree` as `path`.
- [x] `open_commit_worktree(path, hash)` → returns a detached worktree path
      (frontend reveals via `@tauri-apps/plugin-opener`).
      `cleanup_commit_worktrees(path)` removes them.
- [x] `checkout_branch` dirty-switch: `git switch` carries non-conflicting
      changes automatically; the one clobber case now returns a plain-words
      error instead of git plumbing. (Full carry/set-aside dialog deferred to
      Phase 4 with the mode work.)
- [x] `repo_snapshot` gains `siblingTip` (name, tip commit, ahead/behind),
      chosen from `branch_list` (already sorted newest-first) only when newer
      than trunk's tip. No extra git calls beyond one divergence + tip log.
- [x] `cargo check` clean; `tsc --noEmit` clean; TS types added
      (`SiblingTip`, `UpdateOutcome`, `UpdateStatus`, `MergeOutcome.worktree`,
      `RepoSnapshot.siblingTip`).
- [x] Git-level smoke tests (6 scenarios, all pass): merge-into-trunk via
      worktree while on feature; merge conflict → resolve → complete in
      worktree; rebase `--autostash` with dirty tree → conflict → continue,
      stash restored; detached commit worktree; dirty switch clobber → friendly
      error; dirty switch non-conflicting → carried across.

**Registered commands:** `merge_into_trunk`, `update_branch`,
`update_continue`, `update_abort`, `update_status`, `open_commit_worktree`,
`cleanup_commit_worktrees`.

**Shipped as:** invisible release. Nothing user-facing changed yet.

### Notes for later phases
- Pushing trunk after a worktree merge: the merge advances `main` *locally*;
  the existing push flow pushes the *current* branch. Phase 3 needs a "push
  main" affordance (can push from the main checkout — the ref is shared).
- Rebase conflict completion uses `update_continue`, NOT `complete_merge`
  (rebase has no `MERGE_HEAD`; it loops commit-by-commit). The ConflictResolver
  must branch on merge-vs-update in Phase 3.
- `merge_into_trunk` resets a stale `MERGE_HEAD` in the trunk worktree before a
  fresh attempt — deterministic, since that worktree is gitty-owned scratch.

## Phase 2 — One timeline, no view modes — CORE DONE

- [x] Deleted the Changes/History tab switch: removed `viewMode` state + the
      `ViewMode` type from `App.tsx`, and the segmented control from
      `TopBar.tsx`. The timeline is now a permanent band; the pane below shows
      the selection — changes by default, a commit's files+diff when clicked
      (the working view already did this, so History was redundant).
- [x] Removed all `viewMode !== "working"` guards from ~6 effects (auto-select
      first file, focus-refresh, Enter/Mod-A/arrow keyboard handlers, merge
      analysis) — with one view they were always true.
- [x] Deleted `HistoryTable.tsx` (~297 lines), the `history-full` render
      branch, `historySplit` / `historyOrientation` state, `historyCommits`
      memo, and `graphCommits` pagination (`loadMoreCommits`, `commitsHasMore`,
      `loadingMoreCommits`, `loadingMoreCommitsRef`) — nothing else consumed
      them. Pruned now-unused imports (`appendUniqueCommits`, `COMMIT_PAGE_SIZE`,
      `commitsPageHasMore`, `pickerCommits`, `SplitOrientation`).
- [x] Wired `siblingTip` through to `HistoryTimeline` as a lightweight
      awareness chip in the context bar (branch name + ahead count, click to
      switch). `tsc` + `npm run build` clean; no dangling references.

### Deferred to Phase 3 (needs the timeline rework + live visual verification)
- [ ] Promote the ghost-lane rendering to the primary visual (main upper lane,
      current forked below, dashed = new on main, solid = yours). Kept the
      existing lanes as-is for now.
- [ ] Draw the sibling as a full ghost *lane* (currently a chip) with
      preview/switch on click.
- [ ] Replace the remaining context-chip *sentences* ("in sync", "N behind")
      with pure visual. These live alongside the merge-strip which Phase 3
      removes, so do it together.

**Shipped as:** "one screen" release. `viewMode` gone, one view, table deleted.

### Note
- Deep-history pagination is gone with the table. The timeline shows the recent
  window (INITIAL_COMMIT_LIMIT). Accept for now; revisit if users need older
  commits (parked in Later).
- Dead HistoryTable CSS (and a comment referencing the deleted file) remain in
  `App.css` — Phase 5 sweep.

## Phase 3 — Merge and update collapse to two buttons

On any branch that isn't main, the timeline shows exactly two actions:

- **Update from main** → `update_branch` (Phase 1). No direction picker, no
  swap link, no wizard, no step checklist.
- **Merge into main** → `merge_into_trunk` (Phase 1). User never leaves their
  branch. Success = one line + a Push button.

Conflicts are the only state that gets a dedicated surface: keep
`ConflictResolver`, rewire it to work in the trunk worktree, apply the copy
table below.

- [ ] Add the two buttons to the timeline band (shown when current ≠ trunk;
      "Update" only enabled when behind, "Merge" only when ahead).
- [ ] Delete `MergePanel.tsx` (~346 lines).
- [ ] Delete the TopBar merge strip (~190 lines: partner `<select>`, direction
      arrow, chips, clear button) and its props
      (`mergeStripAvailable/mergeIncoming/mergeSource/mergeTargetName/
      mergePartner/mergeCandidates/onMergePartnerChange/onClearMerge/
      mergeActive/aheadOfBase/baseBehind/mergeConflictState/onOpenMerge/
      onExitMerge`).
- [ ] Remove `MergeSession.returnBranch`, `mergeTarget`, `mergePushed`,
      `mergeAnalysis*` pre-flight machinery, `MergeDirection`, and the
      background conflict pre-check effect (~8 `useState`s). Merge/update
      outcomes come from running the verb, not from predicting it.
- [ ] Delete `merge_execute`'s `git switch <target>` path and `merge_branch` /
      `merge_analysis` commands once nothing calls them.
- [ ] Verify: merge with conflicts → resolver appears (in trunk worktree) →
      complete → push. Update with conflicts → resolver → continue/abort.

**Ships as:** "two verbs" release.

## Phase 4 — Kill the modes, fix the words

- [ ] "Visit Commit" / Time Travel → **"Open this version in a folder"** via
      `open_commit_worktree`. Delete `visitSession`, `VisitCommitDialog.tsx`
      (~139 lines), "Return to Latest", the stash bookkeeping, and the three
      "return to latest before…" guards.
- [ ] Delete `resumeBranch` (the hard reset) and the `aheadCommits` /
      `aheadBranch` resume machinery in snapshot + `repo_enrich` — detached
      HEAD no longer happens, so the cure goes with the disease.
- [ ] Replace remaining `window.confirm` calls with the app's dialog
      components, worded around outcomes ("Throw away 4 unsaved changes?"),
      not mechanisms ("hard reset").
- [ ] Apply the copy table everywhere (labels, tooltips, dialogs, empty
      states).

### Copy table

| Today | For humans |
|---|---|
| Working Tree · 4 changes | Now · 4 unsaved changes |
| 3 ahead / 2 behind | dots on the line; "3 to push" only on the Push button |
| Time Travel · detached HEAD | Looking at an old version |
| Visit commit | Open this version in a folder |
| Stash | Set aside changes |
| Hard reset / discard | Throw away changes |
| force-with-lease | (behind a "…" menu; never in primary copy) |
| Ours / Theirs | Your version / Main's version |
| Merge base, upstream, integration branch | never shown |
| Amend | Add to last commit |

**Ships as:** "for humans" release.

## Phase 5 — Sweep

- [ ] One source of truth for ahead/behind (the timeline); `PushButton` keeps
      only its push count.
- [ ] Prune `types.ts`: `VisitSession`, `MergeDirection`, `MergeAnalysis`,
      dead snapshot fields.
- [ ] Prune dead Rust commands + `invoke_handler` list; `cargo check` clean.
- [ ] Re-count `App.tsx` state — target ≤ 25 `useState` (from 40).
- [ ] Update README (features, keyboard table, project structure) and refresh
      screenshots with the storefront demo repo scripts.

---

## Deletion manifest (running tally)

| Item | ~Lines | Phase |
|---|---|---|
| `HistoryTable.tsx` | 297 | 2 |
| `MergePanel.tsx` | 346 | 3 |
| TopBar merge strip + props | 190 | 3 |
| `VisitCommitDialog.tsx` | 139 | 4 |
| Merge pre-flight / session state in `App.tsx` | ~150 | 3 |
| Visit/resume machinery in `App.tsx` | ~120 | 4 |
| Dead Rust (`merge_analysis`, `merge_branch`, resume enrich) | ~150 | 3–5 |

Net: roughly −1,100 lines of UI, ~12 fewer state variables, four modes → one
screen, and the two missing primitives (update-by-rebase, worktrees) arrive as
the mechanism of the simplification rather than more surface area.

## Later / parked

- Super-faint strands for *all* other branches on the timeline (decision 3).
- Visible worktree management (list/open/remove) if the internal use proves
  itself.
- "Update" auto-offer when the app regains focus and main has moved.
