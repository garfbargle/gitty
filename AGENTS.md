# Repository Guidelines

## Quality Constitution & Agent Runs

`CONSTITUTION.md` is the non-negotiable engineering contract. Before changing
or reviewing Gitty, every agent and subagent reads it, this guide,
`docs/README.md`, relevant specs/ADRs, and relevant `DESIGN.md` sections, then
applies `.agents/skills/gitty-quality/SKILL.md`.
Ground the root cause before editing; do not offer a fragile shortcut as a peer
to a correct solution. Delegated prompts state objective, scope, acceptance,
and verification. Concurrent writers use isolated worktrees; reviewers remain
read-only. Completion claims cite reproducible evidence and unknowns.

## Project Structure & Module Organization

Gitty is a Tauri 2 desktop Git client. React/TypeScript lives in `src/`:
`App.tsx` orchestrates state, `components/` contains UI, `lib/` holds pure
helpers, and `types.ts` mirrors backend data. Rust lives in `src-tauri/src/`,
with Git commands and Tauri registration in `lib.rs`. Assets are in `public/`
and tooling in `scripts/`. `web-demo/` is an independent browser simulation;
do not share repository or desktop-shell logic with it.

## Build, Test, and Development Commands

- `npm install` — install dependencies.
- `npm run tauri dev` — run the desktop app.
- `npm run build` — type-check and build the frontend.
- `cd src-tauri && cargo check` — compile-check Rust.
- `cd src-tauri && cargo test` — run Rust tests.
- `npm run dev:demo` / `npm run build:demo` — develop or validate the demo.
- `npm run tauri build` — create an unsigned platform bundle.

## Coding Style & Naming Conventions

Use two-space TypeScript/TSX indentation and `rustfmt` for Rust. Keep TypeScript
strict and free of unused symbols. Use `PascalCase` for React components,
`use...` for hooks, `camelCase` for TypeScript values, and `snake_case` for
Rust. Prefer pure helpers over growing `App.tsx`. Tauri payloads serialize as
camelCase; update the Rust type, `src/types.ts`, handler registration, and
frontend invocation together. No ESLint or Prettier configuration exists.

## Testing Guidelines

Rust tests live near their modules under `#[cfg(test)]`; use behavior-based
names. Run one with `cargo test --lib module::tests::test_name`. Frontend work
must pass `npm run build`.

Project `.codex/config.toml` enables and requires Tauri MCP, the preferred path
for app interaction, UI inspection, IPC/log capture, and monitoring. From the
local `dev/mcp-bridge` worktree, run
`npm run tauri dev -- --features mcp-bridge`, confirm `driver_session`, then
exercise affected keyboard, pointer, refresh, repository-switch, and backend
flows. Report runtime errors and anything unverified; build-only green is not
sufficient for user-visible behavior.

## Commit & Pull Request Guidelines

Use concise imperative subjects such as `Restore the upstream readout` and keep
commits focused. PRs explain visible behavior, list verification, link issues,
and include UI screenshots. Call out Rust/TypeScript contract changes and
platform-specific testing.
