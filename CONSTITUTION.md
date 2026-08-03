# Gitty Engineering Constitution

This document defines the quality commitments behind Gitty. It is native to
this repository: external projects may inform it, but their processes and
machinery do not become Gitty dependencies. When convenience conflicts with
these commitments, these commitments win.

## Prime Directives

1. **Protect the user's repository.** Never move, rewrite, discard, publish, or
   delete work without an explicit and accurately worded action. Force pushes
   use `--force-with-lease`. Commands must not wait on hidden interactive
   prompts. Translate failures into a safe next step without concealing the
   underlying cause.
2. **Fix causes, not symptoms.** Before changing code, state the observable
   problem, the grounded root cause, and why the proposed change addresses it.
   A workaround is acceptable only when it is identified as temporary, its
   limitation is understood, and the root fix is tracked.
3. **Prove behavior on the real seam.** Unit tests and builds prove important
   parts, but a user-facing capability is not complete until the affected flow
   is exercised in the running Tauri app against a safe real repository. A mock
   green proves plumbing, not the complete experience.
4. **Preserve interface integrity.** Rust command payloads, their TypeScript
   mirrors, and frontend invocations change together. Every asynchronous read
   that can outlive a repository switch must reject stale results. Never weaken
   these boundaries to make a change compile.
5. **Design quality is behavior.** `DESIGN.md` governs hierarchy, interaction,
   motion, density, themes, and accessibility. Keyboard paths, focus, selection,
   scrolling, cursor stability, and the absence of layout jumps are acceptance
   criteria—not polish deferred to later.
6. **Prefer the smallest complete change.** Keep scope focused and avoid
   unrelated churn. Put pure frontend logic in `src/lib/` and keep platform or
   Git integration at the Tauri boundary. Split code when a stable concern
   emerges; do not manufacture abstractions or split cohesive code merely to
   satisfy a line count.
7. **Quality is not an option to trade away.** Do not offer “fast but fragile”
   as a peer to a correct solution. Ask about product intent or equally sound
   alternatives; resolve engineering quality using repository evidence and
   established practice.
8. **Claims require reproducible evidence.** Report the exact checks and app
   flows performed, their result, and any unverified surface. A check run on the
   wrong branch, commit, repository, or stale app session establishes nothing.

## Change Contract

Before editing:

- Read `AGENTS.md`, this constitution, `docs/README.md`, relevant specs/ADRs,
  and relevant sections of `DESIGN.md`.
- Inspect repository status and surrounding code; preserve unrelated work.
- Define the problem, root cause, acceptance behavior, affected seams, and the
  smallest complete scope.

While editing:

- Work in behavior-sized vertical slices. Add or update tests at stable public
  seams when automated coverage exists; never weaken a test to obtain green.
- Preserve established naming, architecture, Git safety rules, and stale-result
  guards. Keep Rust and TypeScript contracts synchronized.
- If evidence contradicts the plan, stop and re-derive the solution instead of
  compensating around the contradiction.

Before declaring completion:

- Review the complete diff and the full context of every changed file.
- Run checks proportionate to the change: frontend build, Rust formatting,
  compile checks, and tests as applicable.
- For UI or behavior changes, use the project Tauri MCP connection to inspect
  the real app, exercise affected keyboard and pointer paths, monitor runtime
  errors, and verify light/dark or responsive states when relevant.
- Distinguish failures introduced by the change from failures already present
  on the base revision; report both honestly.

## Agent and Subagent Contract

Every agent run is bound by this constitution. A delegated task must name its
objective, allowed scope, acceptance behavior, relevant corpus, and required
verification. Review agents remain read-only unless explicitly authorized to
remediate. Concurrent agents that write or run stateful verification use
separate Git worktrees so one run cannot invalidate another run's evidence.

Subagents return concrete artifacts or findings with file references and
verification results—not an unsupported “done.” The parent agent remains
responsible for reconciling the result with the current branch and for running
the final integrated checks.

## Definition of Done

A change is done only when the requested behavior is complete, repository
boundaries remain intact, relevant automated checks pass, the real app flow has
been inspected when applicable, documentation matches behavior, and the final
report identifies both evidence and remaining uncertainty. Green checks alone
do not excuse an incorrect diff, misleading documentation, or a degraded user
experience.
