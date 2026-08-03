---
name: gitty-quality
description: Standing engineering and verification discipline for implementing, fixing, refactoring, designing, or reviewing Gitty. Use for every repository change so root-cause reasoning, Git safety, architecture, tests, and real Tauri app evidence remain consistent across agents and subagents.
---

# Gitty Quality

This is Gitty's operational quality loop. It does not import an external
workflow, role system, or receipt mechanism.

## Required context

Before taking action, read completely:

1. `AGENTS.md`
2. `CONSTITUTION.md`
3. `docs/README.md` and any relevant research, roadmap, backlog, spec, or ADR
4. The relevant sections of `DESIGN.md` for any product or UI work
5. The surrounding implementation and tests for the seam being changed

## The loop

1. **Ground the problem.** Describe the observable failure or unmet behavior.
   Identify the root cause from code or runtime evidence and distinguish it
   from symptoms. Preserve research provenance and evidence limits when the
   problem originated in an audit, comparison, experiment, or user report.
2. **Name the acceptance behavior.** State what a user or caller can observe
   when the work is correct, including safety and failure behavior. For
   cross-cutting work, confirm an accepted spec exists or propose one before
   implementation; record a separate ADR only when a durable technical choice
   needs its own rationale.
3. **Choose the smallest complete slice.** Keep the diff cohesive. Preserve
   Gitty's Rust/TypeScript boundary, refresh-generation guards, and product
   language.
4. **Build evidence incrementally.** Test stable seams where coverage exists.
   Never delete, weaken, or hard-code around a failing assertion. Treat mocks
   as plumbing evidence only.
5. **Exercise the real surface.** For UI and app behavior, use the required
   project Tauri MCP server. Verify affected keyboard and pointer paths,
   selection/focus, scrolling, layout stability, and runtime errors against a
   safe repository.
6. **Review the complete diff.** Confirm the implementation matches the stated
   objective, contains no unrelated churn, preserves repository safety, and
   keeps documentation truthful.
7. **Report reproducible evidence.** Name commands and inspected flows, their
   outcomes, and anything not verified.

## Verification matrix

- TypeScript/React: `npm run build`.
- Rust/Tauri: `cargo fmt --check`, `cargo check`, and relevant `cargo test`
  commands from `src-tauri/`.
- Rust/TypeScript payload changes: inspect the command, handler registration,
  serialized Rust type, TypeScript mirror, and invocation together.
- UI changes: connect through Tauri MCP and inspect the running desktop app;
  screenshots alone do not prove interaction behavior.
- Git mutations: use a safe disposable or explicitly scoped repository and
  verify both success and meaningful failure paths.

## Delegation

When assigning a subagent, include the objective, exact file or subsystem
scope, acceptance behavior, required reading, and verification command or app
flow. Make review-only roles explicitly read-only. Give concurrent writers
separate Git worktrees. Re-check their evidence against the current integrated
branch before relying on it.

Do not claim completion from prose alone. A result must be supported by a diff,
test output, runtime inspection, or clearly cited findings.
