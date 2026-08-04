# SPEC-003 — History Lenses

- **Status:** Proposed
- **Date:** 2026-08-03
- **Owner:** Unassigned
- **Backlog:** GITTY-003
- **Research:** [Tower opportunity harvest](../research/TOWER-HARVEST.md)
- **Related ADRs:** None

## Problem

Gitty's Branches view can render dense multi-branch history, but finding a
particular change still requires scanning the loaded rows. The horizontal
Timeline is intentionally stable and compact, so adding filters or variable
density there would compromise its role as persistent working context.

The gap is query and perspective control in the dense history surface—not more
information inside each Timeline node.

## User Outcome

In Branches, a user can search the repository's history and switch between a
small set of clearly named perspectives without changing repository state,
losing the selected commit, or destabilizing the Timeline.

## Scope

- History controls belong to the Branches surface. Timeline geometry, cursor,
  lane budget, and default behavior remain unchanged.
- Repository-wide search across commit subject, body, author, full/short hash,
  branch and tag refs, and changed file paths where Git can provide them.
- A **Main line only** lens for first-parent history using human-facing copy.
- Order by topology or commit date, with the active order made visible.
- Optional day, week, month, or no date grouping as presentation, not history
  semantics.
- Comfortable and compact Branches row density using the same visual grammar.
- A clear reset returning to Gitty's default complete Branches history.
- Honest loading, partial, exhausted, error, stale, and no-result states.

## Non-goals

- Filtering or resizing the horizontal Timeline
- Searching file contents at historical revisions
- Saved searches, query languages, or regular-expression syntax
- Rewriting history or changing branch topology
- A different selection or inspector model for filtered results

## Product and Safety Constraints

- Every lens is read-only and must not fetch, checkout, or mutate the repo.
- Search must not imply repository-wide completeness when only a loaded page was
  examined. Either query the full selected scope or label partial results.
- Human meaning remains primary: subjects lead and hashes remain secondary.
- Color continues to identify branches or state; grouping and density do not
  introduce decorative colors.
- Filtering does not silently move selection. A selected commit hidden by the
  active lens remains in the inspector with an explicit hidden-by-filter state.

## Acceptance Criteria

- [ ] Controls appear only in Branches and do not move or resize Timeline.
- [ ] Search declares its scope and matches subject, body, author, hash, refs,
      tags, and changed paths according to documented rules.
- [ ] Search results are complete for the declared scope, or visibly partial
      while more history is loading.
- [ ] Main-line-only results follow first-parent ancestry and are labeled in
      product language rather than raw command syntax.
- [ ] Topological and date ordering are deterministic and visibly distinct.
- [ ] Date grouping changes separators only; it never changes membership or
      selection.
- [ ] Density changes preserve hierarchy, keyboard target size, and selected
      row visibility.
- [ ] The inspector and context actions remain available for matching commits.
- [ ] Clearing all lenses restores default Branches history and the prior
      selection when it still exists.
- [ ] Rapid query, lens, refresh, and repository changes cannot apply stale
      results or produce layout jumps.

## Verification

Pure tests should cover query matching, active-lens composition, grouping,
ordering, hidden-selection behavior, and reset. Rust parsing and pagination
tests must establish declared search completeness and first-parent semantics.

Tauri MCP acceptance must use a disposable repository with merge commits,
duplicate subjects, multiline bodies, multiple authors, tags, similarly named
branches, renamed files, non-ASCII text, and enough commits for multiple pages.
Exercise keyboard and pointer controls, fast query changes, density/grouping
changes, hidden selection, clear/reset, load-more boundaries, refresh, and
repository switching while monitoring IPC and runtime errors.

## Open Questions

- Should changed-path search use a dedicated Git query or enrich results after
  cheaper metadata matching?
- Which lens state, if any, persists per repository across launches?
- Does date ordering use author or committer time once `SPEC-004` is available?
- If full-scope search needs an index, cache, or new pagination model, record
  its freshness and invalidation contract in an ADR.

## Decision History

- 2026-08-03 — Proposed from the Tower opportunity harvest and Gitty history
  audit. Controls are constrained to Branches to preserve Timeline's standing
  spatial contract.
