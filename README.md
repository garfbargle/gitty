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

Unsigned local build:

```bash
npm run tauri build
```

The macOS app bundle is written to:

```text
src-tauri/target/release/bundle/macos/Gitty.app
src-tauri/target/release/bundle/dmg/Gitty_0.1.0_aarch64.dmg
```

## Signed + Notarized macOS Release

For distribution outside the App Store, use a **Developer ID Application** certificate (not the App Store "Apple Distribution" cert).

1. Create the certificate at [Apple Developer → Certificates](https://developer.apple.com/account/resources/certificates/list): **Developer ID Application**.
2. Download the `.cer` file and double-click it to install in Keychain.
3. Confirm the identity name:

```bash
security find-identity -v -p codesigning
```

4. Create an app-specific password at [appleid.apple.com](https://appleid.apple.com/account/manage) (Sign-In and Security → App-Specific Passwords).
5. Copy the env template and fill in your values:

```bash
cp .env.macos-signing.example .env.macos-signing.local
```

6. Build, sign, notarize, and staple in one step:

```bash
npm run build:macos
```

Tauri signs the app during bundling, submits it to Apple for notarization, then staples the ticket to the `.app` and `.dmg`.

Verify the result:

```bash
spctl -a -vv --type execute src-tauri/target/release/bundle/macos/Gitty.app
xcrun stapler validate src-tauri/target/release/bundle/macos/Gitty.app
```
