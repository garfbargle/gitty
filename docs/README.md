# Documentation Registry

This directory separates evidence, intent, sequencing, behavior, and durable
technical decisions. A document's type determines its authority, not its
importance or retention value.

## Authority Map

1. `CONSTITUTION.md` defines non-negotiable engineering commitments.
2. `PRODUCT.md` and `DESIGN.md` define settled product and interface direction.
3. Accepted specs define user-observable behavior; accepted ADRs define durable
   technical constraints. If they conflict, amend one explicitly—never resolve
   the conflict silently in code.
4. `docs/ROADMAP.md` sequences outcomes. `docs/BACKLOG.md` inventories candidate
   work. Neither overrides an accepted spec or ADR.
5. `docs/research/` records evidence, methods, limits, and opportunities.
   Research is first-class corpus with equal preservation value; it is
   non-binding only because observations and decisions serve different roles.

The existing `SIMPLIFICATION_PLAN.md` and `SUBTREE_PROPOSAL.md` are legacy
hybrids containing rationale, decisions, plans, and completion notes. They
remain authoritative for the behavior promoted into `PRODUCT.md`; new work uses
the structure below.

## Document Types

### Research

Use `research/<TOPIC>.md` for observations, comparisons, experiments, and
unknowns. Status is `Active`, `Captured`, or `Superseded`. Record method,
provenance, evidence limits, findings, interpretation, and disposition. Start
from `research/TEMPLATE.md`.

Research may feed the backlog, but does not authorize implementation. That
boundary protects the research rather than diminishing it: later decisions
must link back to the evidence instead of rewriting it. Superseded research is
retained with a pointer to the newer work.

### Roadmap

`ROADMAP.md` organizes outcome-level work into **Now**, **Next**, and **Later**.
It expresses direction, not dates or release promises. Only explicitly
prioritized work moves into Now.

### Backlog

`BACKLOG.md` gives durable IDs to candidate work. Use statuses `Candidate`,
`Specified`, `Planned`, `In progress`, `Done`, or `Dropped`. A backlog entry is
not a commitment; it preserves provenance and the next decision needed.

### Specifications

Use `specs/SPEC-NNN-kebab-case.md` for behavior spanning multiple files or
requiring agreement before implementation. Status is `Proposed`, `Accepted`,
`Implemented`, `Superseded`, or `Rejected`. Start from `specs/TEMPLATE.md`.

### Architecture Decision Records

Use `adr/ADR-NNN-kebab-case.md` when a technical choice will constrain future
work. Status is `Proposed`, `Accepted`, `Superseded`, or `Rejected`. ADRs record
context, decision, alternatives, and consequences—not implementation progress.
Start from `adr/TEMPLATE.md`.

## Lifecycle

The usual path is:

`research → backlog → roadmap → spec → ADR when needed → implementation → evidence`

Not every change needs every artifact. A localized defect can move directly to
implementation when behavior and architecture are already settled. Update
links and statuses in the same change that advances an artifact; never rewrite
past rationale to make a later decision look inevitable.

## Current Register

### Research

- [Tower opportunity harvest](research/TOWER-HARVEST.md) — Captured

### Direction and Inventory

- [Roadmap](ROADMAP.md)
- [Backlog](BACKLOG.md)

### Specifications

- [SPEC-001 — Branch Health](specs/SPEC-001-branch-health.md) — Proposed
- [SPEC-002 — Saved Changes Shelf](specs/SPEC-002-saved-changes-shelf.md) — Proposed
- [SPEC-003 — History Lenses](specs/SPEC-003-history-lenses.md) — Proposed
- [SPEC-004 — Commit Provenance](specs/SPEC-004-commit-provenance.md) — Proposed
- [SPEC-005 — Commit Authoring](specs/SPEC-005-commit-authoring.md) — Proposed

### ADRs

No numbered ADRs yet. Create one only when implementation exposes a durable
technical choice; do not create ceremonial ADRs for decisions already obvious
from the product contract.
