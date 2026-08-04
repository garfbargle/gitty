# Gitty Roadmap

This roadmap sequences outcomes; it is not a release calendar. Items move only
when evidence and product intent justify the change. See `docs/README.md` for
document authority and lifecycle.

## Now

### History clarity and reference management

Make the horizontal Timeline and dense Branches view easier to scan without
weakening their shared selection model. Commit messages lead, hashes remain
secondary, tags are visible and manageable, and the timeline cursor remains
spatially stable. Current work is proposed upstream and still requires review
and integrated validation before it is considered landed.

## Next

### Branch Health

Help users answer which branches need attention, are ready to merge, conflict
with the integration branch, have unhealthy tracking, or are safe cleanup
candidates. Preserve Timeline as the default and add maintenance intelligence
to the dense Branches surface. See
[SPEC-001](specs/SPEC-001-branch-health.md) and [`GITTY-001`](BACKLOG.md).

### Saved Changes Shelf

Turn Gitty's existing stash push/pop primitives into an inspectable, searchable
workflow whose safe default restores without deleting the saved copy. See
[SPEC-002](specs/SPEC-002-saved-changes-shelf.md) and
[`GITTY-002`](BACKLOG.md).

## Later

- [History search and lenses](specs/SPEC-003-history-lenses.md) (`GITTY-003`)
- [Rich commit provenance and signature state](specs/SPEC-004-commit-provenance.md) (`GITTY-004`)
- [Structured commit authoring](specs/SPEC-005-commit-authoring.md) (`GITTY-005`)
- Commit-tree browsing (`GITTY-006`)
- Quick Actions command discovery (`GITTY-007`)
- Ignore and local-exclude editing (`GITTY-008`)
- Lightweight pull-request handoff (`GITTY-009`)

Later items remain candidates until promoted. Their ordering is intentionally
uncommitted.
