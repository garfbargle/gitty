# SPEC-004 — Commit Provenance

- **Status:** Proposed
- **Date:** 2026-08-03
- **Owner:** Unassigned
- **Backlog:** GITTY-004
- **Research:** [Tower opportunity harvest](../research/TOWER-HARVEST.md)
- **Related ADRs:** None

## Problem

Gitty's commit record contains full and short hashes, parents, one author, one
date, refs, subject, and a body preview. The shared inspector exposes only the
author, relative time, short hash, refs, tags, and fetched message. It cannot
answer who authored versus committed a change, when each event occurred, which
parents or tree it records, or whether Git verified a signature.

The gap is inspectable trust and traceability—not more identity noise in the
Timeline.

## User Outcome

For a selected commit, a user can reveal exact provenance, copy machine
identifiers, navigate parent relationships, and understand signature status
without crowding the default commit summary or mistaking unavailable evidence
for trust.

## Scope

- A progressively disclosed **Details** region in the existing shared commit
  inspector; Timeline and Branches rows remain message-first.
- Author and committer name/email shown separately when they differ, with exact
  author and committer timestamps and timezone offsets.
- Full commit hash, ordered parent hashes, and tree hash with explicit copy
  actions. Parent actions select or open the parent in existing history
  inspection without changing the working tree.
- Signature state represented as **Verified**, **Invalid**, **Unsigned**, or
  **Unknown**. When Git provides them, show signer identity, key/fingerprint,
  signature type, and verification explanation.
- Metadata is loaded for the selected commit and guarded against stale results
  after selection or repository changes.

## Non-goals

- Adding provenance metadata to every Timeline or Branches row
- Implementing cryptography or an independent trust store inside Gitty
- Managing signing keys or changing commit-signing configuration
- Treating a valid signature as proof that the author is trustworthy
- Browsing the full tree contents; that remains `GITTY-006`
- Network certificate, hosting-service, or pull-request verification

## Product and Safety Constraints

- Gitty reports what the system Git installation can establish and labels that
  evidence precisely. Unsupported verification is Unknown, never Unsigned or
  Verified by assumption.
- Invalid signatures use error treatment; unsigned commits remain neutral.
- Human meaning remains visible before machine identity. The Details region
  must not displace subject, body, tags, or changed-file inspection.
- Copy actions copy exact values and never trigger navigation or mutation.
- Parent navigation is read-only and preserves the shared selection model.

## Acceptance Criteria

- [ ] Default inspector hierarchy remains subject, body, human metadata, refs,
      tags, and changes; expanded Details adds provenance without duplication.
- [ ] Author and committer identities and exact dates are accurate and clearly
      labeled, including timezone offsets.
- [ ] Full hash, every ordered parent hash, and tree hash can be copied exactly.
- [ ] A root commit explicitly reports no parent rather than an error.
- [ ] Selecting a parent opens that commit without checkout or working-copy
      mutation.
- [ ] Signature state distinguishes Verified, Invalid, Unsigned, and Unknown.
- [ ] Verification details identify the system-Git result and do not overstate
      identity trust.
- [ ] Metadata failures leave the selected commit usable and present a clear
      retry or explanation.
- [ ] Rapid commit and repository switching cannot display provenance from a
      stale selection.
- [ ] Keyboard, pointer, copy, expand/collapse, and screen-reader labels expose
      the same information.

## Verification

Parser tests should cover root, ordinary, and merge commits; distinct author
and committer identities; timezone offsets; SHA formats supported by Git; and
all signature states, including unsupported verification. Frontend tests at
pure seams should cover state labels, disclosure, and stale-selection guards.

Tauri MCP acceptance must use disposable repositories containing a root commit,
a merge, amended authorship/committer data, unsigned commits, and—when a test
key is safely available—a valid signed commit. Invalid and unavailable states
may be established through parser fixtures plus a real unsupported-verifier
path. Exercise copying, parent navigation, selection churn, refresh, and repo
switching while monitoring runtime errors.

## Open Questions

- Which metadata belongs in the initial history payload versus a narrow
  selection-time command?
- Should expanded Details state persist per user, per repository, or only for
  the session?
- How should Git's different GPG, SSH, and future signature formats map into one
  stable frontend contract?
- If verification requires caching or background work, record its trust,
  freshness, and invalidation boundaries in an ADR.

## Decision History

- 2026-08-03 — Proposed from the Tower opportunity harvest and audit of
  `CommitEntry` and the shared inspector. Selection-time loading is a product
  preference, not yet an architectural decision.
