# Releasing Snap updates

Snap checks the latest public release at `YumiNoona/Snap` and verifies every update with the updater signing key embedded in the app.

## One-time GitHub setup

1. Open the repository's **Settings → Secrets and variables → Actions** page.
2. Create a repository secret named `TAURI_SIGNING_PRIVATE_KEY`.
3. Set its value to the complete contents of:
   `C:\Users\ringale\.tauri\snap-updater.key`

Keep that file private and backed up. Never commit it. Losing it means existing installations cannot trust future updates.

## Publish an update

1. Increase the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Commit and push the changes.
3. Run the validation commands from `README.md`.
4. Create and push a matching tag, for example `app-v1.0.0`.

The `Publish Snap update` GitHub workflow builds the Windows installers, signs the updater artifacts, publishes the release, and uploads `latest.json`. Existing Snap installations will then show the in-app update prompt and can download and install the release without opening a browser.

For a local NSIS installer, run `npm run tauri build -- --bundles nsis`. If updater
artifacts are enabled, export `TAURI_SIGNING_PRIVATE_KEY` for the build process;
never copy the private key into the repository.
