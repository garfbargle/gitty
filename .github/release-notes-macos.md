**Windows**
- `Gitty_*_x64-setup.exe` — NSIS installer (recommended)
- `Gitty_*_x64_en-US.msi` — MSI installer

**macOS** (Apple Silicon, macOS 11+)
- `Gitty_*_aarch64.dmg`

The macOS build is **not signed or notarized**. macOS quarantines apps
downloaded from the internet, so Gatekeeper will refuse to open it — typically
with a "damaged and can't be opened" message. To run it, drag Gitty to
Applications and clear the quarantine flag:

```
xattr -dr com.apple.quarantine /Applications/Gitty.app
```

Alternatively, build from source. A locally compiled app is never quarantined
and needs no workaround — see the README.

Git must be installed and available on your PATH.
