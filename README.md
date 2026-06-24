# Gitty

Gitty is a small Tauri desktop Git client focused on the SourceTree workflows that matter here:

- maintain a local catalog of Git repository paths
- inspect branch/upstream/ahead/behind status
- browse recent commit history
- inspect commit and working tree diffs
- push and force-push with `--force-with-lease`
- add or update a remote
- soft or hard reset to a selected commit

The app uses the system `git` executable through Rust commands. It does not poll repositories in the background; it refreshes only when a repository is selected, refreshed, or an action completes.

## Development

```bash
npm install
npm run tauri dev
```

## Checks

```bash
npm run build
cd src-tauri && cargo check
```

## Release Build

```bash
npm run tauri build
```

The macOS app bundle is written to:

```text
src-tauri/target/release/bundle/macos/Gitty.app
```
