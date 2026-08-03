# SPEC-005 — Commit Authoring

- **Status:** Proposed
- **Date:** 2026-08-03
- **Owner:** Unassigned
- **Backlog:** GITTY-005
- **Research:** [Tower opportunity harvest](../research/TOWER-HARVEST.md)
- **Related ADRs:** None

## Problem

Gitty accepts a multiline commit message through one undifferentiated textarea
and passes it as a single `git commit -m` argument. This technically supports a
body, but the interface does not teach or preserve subject/body structure. It
also does not expose the effective repository identity, repository templates,
or an explicit sign-off choice.

The gap is clear, trustworthy authorship—not a larger commit form.

## User Outcome

A user can write a scannable subject and optional body, understand which
identity will be recorded, apply an existing repository template without losing
their draft, optionally add a sign-off, and use the current keyboard-first
commit flow unchanged.

## Scope

- Visually distinct **Subject** and optional **Details** inputs that compose one
  standard Git commit message: subject, blank line, then body.
- Subject is required and remains the message shown first in Timeline and
  Branches; body supports multiple paragraphs without forced hard wrapping.
- Existing AI suggestions split at the first line/paragraph boundary and remain
  editable before commit.
- Amend loads the current subject and body into the same structure and clearly
  states that the previous commit will be replaced.
- Read the effective committer name/email from repository-aware Git config and
  show it as quiet supporting context.
- Offer repository-local identity editing with explicit scope. Never modify
  global Git identity from an ambiguous control.
- Offer existing `commit.template` content when the draft is empty. Applying a
  template is explicit and never overwrites typed or generated text.
- An optional **Add sign-off** control appends the standard trailer exactly once
  and previews the resulting identity.
- Draft state is scoped to its repository so fast repository switching cannot
  carry a message or identity into another repo.

## Non-goals

- Enforcing Conventional Commits or another message grammar
- Requiring AI generation or treating generated text as final
- Gitmoji conversion, automatic hard wrapping, spell-check policy, or linting
- Signing-key configuration or cryptographic signing; see `SPEC-004` for
  verification and a future dedicated signing proposal if needed
- Global Git configuration management
- Multiple co-author or custom-trailer editors in the first slice

## Product and Safety Constraints

- The form remains compact and keyboard-first. Additional controls are
  progressive context, not a Tower-style settings panel beside every commit.
- `Mod Enter` preserves its current commit behavior and never submits an empty
  subject. Enter from Subject moves into Details; Enter inside Details creates
  a newline.
- Template, AI, amend, and sign-off transformations are visible and reversible
  before the Git command runs.
- Identity source and scope are explicit. Unknown identity blocks commit with a
  clear configuration path rather than exposing raw Git failure text.
- Repository switching never submits or displays another repository's draft.

## Acceptance Criteria

- [ ] Subject is required, body is optional, and serialization produces exactly
      one blank separator when a body exists and none when it does not.
- [ ] Multiline bodies retain paragraph breaks and do not alter Timeline's
      subject/body preview rules.
- [ ] AI suggestions, amend messages, and templates populate subject/body
      deterministically without discarding an existing draft.
- [ ] The effective identity shown matches the identity Git will use for the
      selected repository.
- [ ] Repository-local identity editing does not change global configuration
      and updates the preview only after Git confirms the write.
- [ ] Sign-off is added exactly once using the effective identity and remains
      visible/editable in the message before commit.
- [ ] Amend preserves the existing confirmation and makes replacement semantics
      explicit.
- [ ] `Mod Enter`, staging eligibility, push-on-commit, and AI-summary shortcuts
      continue to work with both inputs.
- [ ] Draft and identity reads reject stale results during repository switches.
- [ ] Error, missing-template, missing-identity, and configuration-write failure
      states identify the next safe action.

## Verification

Pure tests should cover message parse/serialize round trips, blank lines,
trailers, duplicate sign-off prevention, AI/template splitting, and per-repo
draft selection. Rust tests must cover effective identity precedence,
repository-local writes, template reads, commit argv, and amend behavior.

Tauri MCP acceptance must use disposable repositories with global identity,
repository override, missing identity, no template, multiline template, staged
and unstaged changes, AI suggestion, amend, and push-on-commit configurations.
Exercise keyboard-only authoring, pointer editing, repo switching with drafts,
template refusal to overwrite, sign-off toggling, successful commit, failed
commit, and inspector/timeline rendering of the resulting messages.

## Open Questions

- Should repository-scoped drafts survive an app restart or only repository
  switches within one session?
- Should Details remain expanded once used, and at what scope?
- Does identity editing belong inline or link to repository settings?
- If persistent drafts introduce storage and migration guarantees, record that
  contract in an ADR.

## Decision History

- 2026-08-03 — Proposed from the Tower opportunity harvest and audit of
  `CommitPanel`/`commit_repo`. The spec preserves Gitty's current keyboard loop
  while making structure, identity, and transformations explicit.
