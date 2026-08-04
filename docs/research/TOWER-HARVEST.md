# Tower Opportunity Harvest

- **Status:** Captured
- **Date:** 2026-08-03
- **Researchers:** Maintainer-guided Codex inspection
- **Question:** Which daily Git workflows does Tower support that Gitty does
  not yet cover, and which would strengthen Gitty without diluting its product
  direction?
- **Method:** Direct, read-only inspection of Tower for macOS with Computer Use;
  findings cross-checked against Gitty's source and current product corpus.
- **Purpose:** Identify useful gaps and opportunities, not reproduce Tower.
- **Disposition:** [`GITTY-001` through `GITTY-009`](../BACKLOG.md);
  [SPEC-001](../specs/SPEC-001-branch-health.md) through
  [SPEC-005](../specs/SPEC-005-commit-authoring.md) proposed for the priority-1
  and priority-2 opportunities.

## Method and Sources

Tower was inspected locally through its visible interface and accessibility
tree. The pass covered Working Copy, History, Stashes, Pull Requests, Branches
Review, repository settings, workflow selection, ignore/exclude inspection,
and Quick Actions. No marketing feature list was treated as evidence.

Gitty coverage was checked directly in `src/`, `src-tauri/`, `README.md`,
`PRODUCT.md`, and `DESIGN.md` so an existing capability would not be reported as
a gap. Repository-specific names and content observed during inspection are not
part of this report.

## Executive Finding

Tower's durable value is not its large toolbar or service integration. Its most
useful advantage is operational intelligence around branch maintenance,
stashes, history filtering, and commit provenance. Gitty already has the
stronger product foundation: a message-first timeline, a dense graph on demand,
repository-wide tag management, explicit divergence context, worktrees, linked
folders, conflict handling, and a quiet keyboard-first surface.

The opportunity is to add focused maintenance tools without inheriting Tower's
navigation weight or implementation vocabulary.

## Observed Tower Capabilities

### Working Copy

- Separate subject and body fields, amend and sign-off controls, commit
  templates, committer profiles, hard-wrap options, and generated messages.
- Stage-all, per-file staging, and file sorting by status or filename.

### History

- A vertical multi-branch graph with author avatars, human-readable subjects,
  secondary hashes, date grouping, and inline branch, tag, and worktree refs.
- Inspector metadata for author and committer identities and dates, full and
  parent hashes, tree hash, full message, changed files, and addition/deletion
  counts.
- Changeset/tree modes plus first-parent, sort, grouping, density, search, and
  signature-verification controls.

### Stashes

- A dedicated searchable list with timestamps and base context.
- Full metadata and changed-file inspection with Apply, Delete, and external
  diff actions.

### Branch Review

- Comparison against a selected base branch.
- Mergeable, merged, or conflicting state; ahead/behind counts; tracking health;
  last activity; search; sorting; inspection; and recoverable deletion.

### Pull Requests, Settings, and Discovery

- Pull-request conversation, commits, changeset, checkout, close, merge, and
  browser-link actions, coupled to configured service accounts.
- Per-repository identity, signing, templates, issue-link rules, ignore/exclude
  inspection, Git LFS, and Git Flow settings.
- A Quick Actions palette for navigation, branches, and contextual commands.

## Gitty Coverage Confirmed

Gitty already covers the horizontal message-first timeline, denser Branches
graph, commit inspection and diffs, branch divergence, repository-wide tag
browsing and management, unpushed tag state, worktrees, linked folders, merge
and update flows, conflict resolution, remotes, backups, and basic backend stash
push/pop commands.

Tagging is therefore not a remaining Tower gap. Gitty's shared tag browser,
timeline markers, inspector actions, and unpushed state form a more coherent
model than Tower's primarily inline reference display.

## Prioritized Opportunities

| Priority | Opportunity | Gitty-shaped direction |
| --- | --- | --- |
| 1 | Branch Health | Turn existing topology and divergence data into a focused maintenance view. See [SPEC-001](../specs/SPEC-001-branch-health.md). |
| 1 | Stash Shelf | Add searchable inspect/apply/drop workflows around the existing backend primitives. See [SPEC-002](../specs/SPEC-002-saved-changes-shelf.md). |
| 2 | History Lenses | Add search, first-parent, ordering, grouping, and density controls without changing Timeline's stable geometry. See [SPEC-003](../specs/SPEC-003-history-lenses.md). |
| 2 | Commit Provenance | Expand the inspector with author/committer distinction, parents, exact dates, tree identity, and signature state. See [SPEC-004](../specs/SPEC-004-commit-provenance.md). |
| 2 | Commit Authoring | Clarify subject/body structure and consider templates, sign-off, and repository identity. See [SPEC-005](../specs/SPEC-005-commit-authoring.md). |
| 3 | Commit Tree | Browse the repository tree at a selected commit alongside its changeset. |
| 3 | Quick Actions | Provide keyboard-first discovery of navigation and context-valid commands. |
| 3 | Ignore/Exclude Editor | Inspect and edit repository ignores and local excludes safely. |
| 3 | Pull-request Handoff | Prefer lightweight links, checkout, and browser/CLI handoff over service-account coupling. |

## Patterns Not to Import

- A permanently crowded icon toolbar
- A deep branch tree occupying primary navigation
- Service accounts as a prerequisite for local Git workflows
- Git Flow or LFS controls in the primary experience
- Icon-only actions or many persistent modes without clear hierarchy
- Feature parity as a product objective

## Recommended Sequence

1. Specify and validate Branch Health because Gitty already computes much of
   its source data and it directly improves daily repository maintenance.
2. Review the Saved Changes Shelf spec against real conflict and deletion
   behavior before implementation.
3. Review History Lenses, provenance, and authoring independently; each can land
   without requiring the others, and none may destabilize Timeline.
4. Reassess the remaining candidates through actual Gitty use before promoting
   them from backlog.

## Evidence Limits

Inspection was read-only: no Tower Git mutation was executed. Pull-request
content could not be evaluated because the inspected repository had no Tower
service account connected. The harvest establishes feature shape and workflow
opportunities, not correctness or performance parity.
