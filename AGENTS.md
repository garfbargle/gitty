# Repository Guidelines

## Project Structure & Module Organization

Gitty is a Tauri 2 desktop Git client. The React/TypeScript frontend lives in `src/`: state orchestration is in `App.tsx`, UI in `components/`, and pure helpers in `lib/`. Shared types are in `src/types.ts`. The Rust backend is under `src-tauri/src/`; `lib.rs` contains Git operations and the command registry. Assets live in `public/` and tooling in `scripts/`.

Treat `web-demo/` as an independent browser-only simulation. Do not share desktop shell or repository-access logic with it.

## Build, Test, and Development Commands

- `npm install` — install JavaScript dependencies.
- `npm run tauri dev` — run the desktop app locally.
- `npm run build` — type-check TypeScript and build the frontend.
- `cd src-tauri && cargo check` — compile-check Rust changes.
- `cd src-tauri && cargo test` — run Rust unit tests.
- `npm run dev:demo` / `npm run build:demo` — develop or validate the web demo.
- `npm run tauri build` — create an unsigned bundle for the current platform.

## Coding Style & Naming Conventions

Use two-space indentation in TypeScript/TSX and `rustfmt` in Rust. Keep TypeScript strict and free of unused symbols. Name React components and files in `PascalCase`, hooks with `use...`, functions and variables in `camelCase`, and Rust items in `snake_case`. Prefer pure helpers in `src/lib/` over adding logic to `App.tsx`.

Tauri payloads use camelCase serialization. When changing a Rust payload or command, update its mirror in `src/types.ts`, register the command in `generate_handler!`, and update the frontend invocation in the same change. Run `cargo fmt` before submitting Rust edits. No ESLint or Prettier configuration is currently provided.

## Testing Guidelines

Rust unit tests are the only automated tests; keep them near the module under `#[cfg(test)]`. Use behavior-based names and run one with `cargo test --lib module::tests::test_name`. For frontend work, `npm run build` is the required type-check gate.

Project `.codex/config.toml` enables Tauri MCP, the preferred path for interaction, UI inspection, IPC/log capture, and monitoring. In the local `dev/mcp-bridge` worktree, run `npm run tauri dev -- --features mcp-bridge`, confirm `driver_session` connects, then exercise affected keyboard, refresh, repository-switch, and backend-command flows. Report inspected flows and runtime errors.

## Commit & Pull Request Guidelines

Follow the history’s concise, imperative commit subjects, such as `Restore the upstream readout`. Keep each commit focused. Pull requests should explain user-visible behavior, list validation commands, link issues, and include screenshots for UI changes. Call out Rust/TypeScript contract changes and platform-specific testing.
