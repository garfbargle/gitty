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

## Phase 1 — Backend primitives (Rust only, no UI change)

- [ ] Refactor `merge_execute`'s conflict/outcome plumbing into helpers
      reusable by the new commands (conflict file listing, output joining).
- [ ] `update_branch(path, onto)` — `git rebase --autostash <onto>` on the
      current branch. Returns `UpdateOutcome { status: "updated" | "conflicts" |
      "up_to_date", conflictFiles, message, output }`.
- [ ] `update_continue(path)` / `update_abort(path)` / `update_status(path)` —
      thin wrappers over `git rebase --continue / --abort` + `.git/rebase-merge`
      detection. `update_status` also reported inside `repo_snapshot` so a
      half-finished update survives app restart.
- [ ] `ensure_trunk_worktree(path)` — lazily create (and reuse) a hidden
      worktree for the trunk under the app data dir
      (`app_data/worktrees/<repo-hash>/<branch>`). Handles: trunk already
      checked out in the main folder (skip — operate in place), stale/locked
      worktrees (`git worktree prune`), trunk renamed.
- [ ] `merge_into_trunk(path, source)` — run the merge **inside the trunk
      worktree**. The user's checkout, uncommitted changes, and branch are
      untouched. Drops the "working tree must be clean" requirement for
      shipping. Returns the same outcome shape as `merge_execute`. Conflict
      resolution commands (`resolve_conflict`, `conflict_sides`,
      `complete_merge`, `abort_merge`) gain an optional worktree path so the
      resolver works there too.
- [ ] `open_commit_worktree(path, hash)` — check a commit out into a temp
      worktree and reveal it in Finder/Explorer. Replaces detached-HEAD "Time
      Travel". `cleanup_commit_worktrees(path)` removes them (on app start and
      via repo settings).
- [ ] Upgrade `checkout_branch` → dirty switch either carries changes
      (`git switch` succeeds with them) or returns a structured
      `needs_attention` result the UI can turn into a plain-words dialog —
      never a raw git error string.
- [ ] Extend `repo_snapshot`: add `siblingTip` — the branch (name, tip commit,
      divergence from main) whose tip is newest and newer than main's tip,
      excluding current + trunk. Per-branch data already exists in
      `branch_list`; this is selection, not new git calls.
- [ ] `cargo check` passes; manual smoke: update with/without conflicts, merge
      into trunk from dirty branch, open old commit, dirty switch.

**Ships as:** invisible release. Nothing user-facing changes yet.

## Phase 2 — One timeline, no view modes

- [ ] Delete the Changes/History tab switch (`viewMode` in `App.tsx`, the
      segmented control in `TopBar.tsx`). The timeline becomes a permanent band
      at the top; the pane below shows the selection — your changes by default,
      a commit's diff when clicked.
- [ ] Promote the existing ghost-lane rendering (`HistoryTimeline.tsx`,
      `renderLane`) to the primary visual: main as the upper lane, current
      branch forked below, dashed dots = new on main, solid dots = yours,
      working-tree node = "you are here". (See locked decision 2 for the third
      lane.)
- [ ] Draw the sibling lane (from `siblingTip`) as a slim labeled tip; click =
      preview its head commit, double-click = switch to it.
- [ ] Replace the context-chip *sentences* ("3 commits behind", "in sync") with
      the visual: ghost dots already say "behind". Keep at most a small count
      badge on the lane label.
- [ ] Delete `HistoryTable.tsx` (~297 lines), `historySplit` /
      `historyOrientation` state, `graphCommits` pagination
      (`loadingMoreCommits`, `commitsHasMore`) if nothing else consumes it.
- [ ] `npm run build` passes; keyboard nav (←/→ on timeline, ↑/↓ in files)
      still works.

**Ships as:** "one screen" release.

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
