# SPEC-001 — Branch Health

- **Status:** Proposed
- **Date:** 2026-08-03
- **Owner:** Unassigned
- **Backlog:** GITTY-001
- **Research:** [Tower opportunity harvest](../research/TOWER-HARVEST.md)
- **Related ADRs:** None

## Problem

Gitty visualizes branch topology and current-branch divergence, but it does not
synthesize repository-wide maintenance state. A user must inspect branches one
at a time or infer whether each branch is merged, ready to merge, conflicting,
stale, untracked, or active in another folder.

The gap is decision support, not missing graph decoration.

## User Outcome

From the existing dense Branches surface, a user can quickly identify which
local branches need attention and safely inspect the evidence behind each
status without changing the working tree.

## Scope

- A Branch Health mode or lens within the existing Branches surface; no new
  permanent top-level screen.
- Compare local branches with the repository's integration branch, defaulting
  to the same trunk Gitty already identifies.
- Show verified merge state, divergence from the comparison branch, upstream
  tracking health, last activity, and whether another worktree holds a branch.
- Search by branch name and sort by name, activity, or attention state.
- Selecting a row exposes its branch-only commits and changeset through the
  existing inspection language and selection model.
- Offer local cleanup only when Gitty can accurately explain the consequence
  and protect current or worktree-held branches.

## Non-goals

- Changing the horizontal Timeline or its lane budget
- Automatic branch deletion or background cleanup
- Remote-branch deletion
- Pull-request hosting, service accounts, Git Flow, or stacked-PR workflows
- Adding raw Git terminology to the primary interface

## Product and Safety Constraints

- Timeline remains the default; Branches remains the dense on-demand view.
- Status must distinguish verified, stale, and unknown. Gitty must never call a
  branch safe, merged, or conflict-free from incomplete information.
- Mergeability checks must not modify the working tree or switch branches.
- Cleanup is an explicit action with branch name, consequence, and relevant
  worktree or unpublished-work warnings stated before confirmation.
- The view must remain legible with at least twenty linked worktrees.

## Acceptance Criteria

- [ ] The comparison branch is visible and defaults to Gitty's integration
      branch; changing it updates all relative states without checkout.
- [ ] Every local branch shows last activity and one honest attention state:
      merged, ready to merge, conflicts, needs update, or unknown.
- [ ] Comparison-branch divergence and upstream divergence are labeled as
      separate facts rather than combined into one ambiguous count.
- [ ] Missing upstream, deleted upstream, unpublished branch, current branch,
      and branch-in-another-folder states are represented explicitly.
- [ ] Search and sorting preserve selection when the selected branch remains
      visible and move it predictably when it does not.
- [ ] Keyboard and pointer selection open the same inspector without switching
      back to Timeline or causing layout jumps.
- [ ] No read or mergeability check changes HEAD, the index, or working files.
- [ ] Cleanup cannot target the current branch or a branch held by another
      worktree, and no deletion occurs without confirmation.
- [ ] Loading, error, stale, and unknown states never masquerade as success.

## Verification

Automated seams should cover classification and sorting as pure logic, plus
Rust parsing and safety guards at the command boundary. Tauri MCP acceptance
must use a disposable real repository containing:

- merged and unmerged branches
- a cleanly mergeable branch and a conflicting branch
- ahead, behind, and diverged upstreams
- a missing upstream and an unpublished branch
- a branch checked out in another worktree
- at least twenty worktree entries for density validation

Exercise keyboard and pointer navigation, comparison changes, search, sorting,
inspector continuity, refresh, repository switching, and protected cleanup.
Monitor IPC and runtime errors throughout.

## Open Questions

- Should health data extend `repo_snapshot` or load through a narrower command?
  If the choice introduces caching, background work, or a new concurrency
  contract, record it in an ADR.
- What exact ancestry rule defines “merged” when squash merges are common?
- Should remote-only branches appear in this lens or remain in graph/search?
- Which states earn visual signal color without violating `DESIGN.md`?

## Decision History

- 2026-08-03 — Proposed from the Tower opportunity harvest and Gitty source
  audit. No implementation architecture has been selected.
