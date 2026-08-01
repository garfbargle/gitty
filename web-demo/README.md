# Gitty web demo

This is a standalone, browser-only product demo for `gitty.c0di.com`.
It deliberately simulates Git state in React and never imports Tauri, calls a
shell, accesses local repositories, or sends Git credentials anywhere.

Run these commands from the repository root:

```bash
npm run dev:demo
npm run build:demo
npm run deploy:demo
```

The desktop application remains in `src/` and `src-tauri/`. Keep
desktop-specific code out of this directory, and keep browser-demo code out of
the desktop entry point.

