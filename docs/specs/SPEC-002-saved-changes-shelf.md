# SPEC-002 — Saved Changes Shelf

- **Status:** Proposed
- **Date:** 2026-08-03
- **Owner:** Unassigned
- **Backlog:** GITTY-002
- **Research:** [Tower opportunity harvest](../research/TOWER-HARVEST.md)
- **Related ADRs:** None

## Problem

Gitty can save the current working copy with `stash_push` and restore the newest
entry with `stash_pop`, but it has no interface for listing, naming, inspecting,
choosing, or safely removing saved work. Restoring “the latest” without showing
its contents is too opaque for a tool whose first obligation is protecting the
user's repository.

The gap is safe, inspectable temporary-work management—not another Git screen.

## User Outcome

From the working-copy flow, a user can save unfinished changes, understand each
saved set, restore a chosen set without silently deleting its backup, and remove
it only through an explicit confirmation.

## Scope

- An on-demand **Saved Changes** shelf accessible from the working-copy
  surface; implementation may use Git stash internally, but the primary UI does
  not require that term.
- Save staged, unstaged, and untracked files with an optional human-readable
  name. The default name explains when and from which branch the work was saved.
- List entries newest first with name, source branch or detached state, exact
  and relative time, base commit subject, and changed-file count when known.
- Search names, branch context, file paths, and commit subjects.
- Selecting an entry shows its files and diff before any mutation.
- **Restore** applies the selected entry while retaining the saved copy. Removal
  is a separate action after successful inspection or restore.
- Route restore conflicts into Gitty's existing conflict experience while
  preserving the saved entry.
- Refresh the working copy and shelf after every successful mutation without
  applying stale results after a repository switch.

## Non-goals

- Synchronizing saved changes across machines or remotes
- Automatically expiring, squashing, or deleting entries
- Creating a branch directly from an entry in the first slice
- Partial-file restore, reorder, rename, or drag-and-drop management
- Exposing internal autostash plumbing as ordinary user-created entries

## Product and Safety Constraints

- Saving and restoring must never switch branches or move HEAD.
- Restore keeps the source entry until the user separately removes it.
- Remove names the entry and states that the saved copy cannot be recovered by
  Gitty before asking for confirmation.
- Dirty-working-copy overlap, conflicts, unknown metadata, and command failures
  are explicit; none may be presented as a successful restore.
- The inspector uses the same file and diff language as working-copy and commit
  inspection rather than inventing a parallel viewer.

## Acceptance Criteria

- [ ] Saving an empty working copy is unavailable and explains why.
- [ ] A successful save includes staged, unstaged, and untracked files and
      leaves the working copy clean.
- [ ] Every entry has a stable object identity independent of shelf ordering,
      even when two entries share the same message or base commit.
- [ ] Search and keyboard navigation preserve selection predictably.
- [ ] Selecting an entry is read-only and shows the complete changed-file set
      and available diff before restore or removal.
- [ ] Restore targets the selected entry, retains it after success, and updates
      the visible working copy.
- [ ] Restore conflicts enter the shared resolver and retain the source entry.
- [ ] Removal requires explicit confirmation and never targets a different
      entry because the shelf refreshed or reordered.
- [ ] Empty, loading, error, stale, and unknown states are distinct.
- [ ] Switching repositories cannot display or mutate the previous repository's
      saved changes.

## Verification

Automated seams should cover entry parsing, identity, search, selection after
reorder, and command targeting. Rust tests must verify that save includes
untracked files, restore does not drop the source entry, and removal uses the
selected stable reference.

Tauri MCP acceptance must use a disposable real repository with staged,
unstaged, untracked, renamed, binary, and conflicting files. Exercise multiple
same-message entries, clean restore, conflicting restore, removal cancellation,
successful removal, refresh, keyboard/pointer parity, and rapid repository
switching while shelf reads are in flight.

## Open Questions

- Should the shelf live in the existing inspector, a popover, or a temporary
  working-copy mode? The choice must preserve one-screen hierarchy.
- Which Git-produced identifier remains safe when entries are inserted or
  removed during a session?
- Should a successful restore offer a contextual “Remove saved copy” action or
  leave removal solely in the shelf?
- If shelf loading requires a new cached or paginated read model, record that
  concurrency and invalidation contract in an ADR.

## Decision History

- 2026-08-03 — Proposed from the Tower opportunity harvest and audit of Gitty's
  existing `stash_push`/`stash_pop` commands. Restore-without-drop is proposed
  as the safe default; no storage architecture has been selected.
