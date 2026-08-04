# Gitty Backlog

The backlog preserves candidate work and its research provenance. It is not a
promise to implement every item. Every new candidate links the evidence that
justifies keeping it. IDs are stable; update status and links rather than
renumbering. See `docs/README.md` for status definitions.

| ID | Status | Horizon | Opportunity | Source | Next decision |
| --- | --- | --- | --- | --- | --- |
| GITTY-001 | Specified | Next | Branch Health | [Tower harvest](research/TOWER-HARVEST.md) | Review and accept [SPEC-001](specs/SPEC-001-branch-health.md). |
| GITTY-002 | Specified | Next | Saved Changes Shelf | [Tower harvest](research/TOWER-HARVEST.md) | Review and accept [SPEC-002](specs/SPEC-002-saved-changes-shelf.md). |
| GITTY-003 | Specified | Later | History search and lenses | [Tower harvest](research/TOWER-HARVEST.md) | Review and accept [SPEC-003](specs/SPEC-003-history-lenses.md). |
| GITTY-004 | Specified | Later | Commit provenance and signature state | [Tower harvest](research/TOWER-HARVEST.md) | Review and accept [SPEC-004](specs/SPEC-004-commit-provenance.md). |
| GITTY-005 | Specified | Later | Structured commit authoring | [Tower harvest](research/TOWER-HARVEST.md) | Review and accept [SPEC-005](specs/SPEC-005-commit-authoring.md). |
| GITTY-006 | Candidate | Later | Browse repository tree at a commit | [Tower harvest](research/TOWER-HARVEST.md) | Confirm the user task not served by changeset inspection. |
| GITTY-007 | Candidate | Later | Quick Actions palette | [Tower harvest](research/TOWER-HARVEST.md) | Inventory commands whose discoverability is currently poor. |
| GITTY-008 | Candidate | Later | Ignore and local-exclude editor | [Tower harvest](research/TOWER-HARVEST.md) | Define repository versus machine-local safety boundaries. |
| GITTY-009 | Candidate | Later | Lightweight pull-request handoff | [Tower harvest](research/TOWER-HARVEST.md) | Prefer browser/CLI integration; validate demand before service APIs. |

## Explicitly Not Backlogged

The Tower harvest does not justify a large permanent toolbar, deep branch
navigation tree, service-account dependency, primary Git Flow/LFS UI, or broad
feature-parity effort. New evidence may reopen a specific user problem, but
parity itself is not a reason.
