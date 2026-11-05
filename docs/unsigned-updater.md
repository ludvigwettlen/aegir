# Aegir unsigned updater

## User flow

Current users rebuild and install **0.1.1** once (`pnpm install`, `pnpm build`). Keep the application in a writable Applications folder; updates cannot be applied from a DMG or App Translocation location. Existing chats, tasks and settings remain under Electron userData.

In Settings → App updates, expand GitHub access and save your own token. Then use **Check for updates → Download update → Restart to update**. Checks include prereleases, but only releases with a valid signed manifest for this Mac are considered. The previous helper-only test release is ignored. Nothing installs automatically, and active work blocks restart.

The current private repository is **ludvigwettlen/aegir**. Browser sign-in does not grant the app access. Owners can create a fine-grained token limited to this repository with **Contents: read**. GitHub's fine-grained tokens have limitations for repository collaborators: those users may need a classic token with `repo` scope, which also grants access to their other private repositories. This broader scope must be understood when choosing it. Aegir only sends read requests. Tokens are encrypted with Electron safeStorage (macOS Keychain) and stored locally; plaintext never enters snapshots, release files, or logs. Save/remove are explicit controls. Expired access is recoverable by saving a replacement token. Browser-based OAuth would require registering an OAuth app and is not implemented.

See [GitHub token limitations](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) and [release asset permissions](https://docs.github.com/en/rest/releases/assets).

## Trust and downloads

`config/updates.json` contains only the repository and Ed25519 public key. The private key lives at `~/.config/aegir-release/private.pem` with owner-only permissions, outside the repository. Back it up securely. Do not regenerate it for each release; existing installations trust the embedded public key. Changing trust keys currently requires a manually installed app update.

The updater lists the latest 30 releases, ignores drafts, and selects the highest newer compatible signed version. Missing manifests are ignored; invalid signatures, mismatched tags/assets, changed sizes, and malformed manifests produce errors. Only the installed architecture is accepted. API requests are restricted to this repository. Asset redirects must be HTTPS on GitHub's asset hosts; Authorization is stripped at the CDN boundary.

Manifest signatures cover exact decoded payload bytes, including version, commit, architecture, minimum macOS version, ZIP asset name, size, SHA-256 and notes. ZIP downloads have size/time bounds, cancellation, checksum verification and a free-space check. Extraction rejects traversal, duplicate paths, unsupported file types and escaping links; links are created after regular files so extraction cannot follow archive-provided symlinks. The app identity, version and executable architecture are checked again before installation.

This is independent of Apple Developer ID signing/notarization. No code clears quarantine, disables Gatekeeper, changes system security policy or requests administrator access. Initial installations and downloaded unsigned replacements may trigger macOS prompts or be blocked on managed Macs. Cross-machine Gatekeeper testing remains required.

## Replacement, startup and recovery

The standalone Swift helper is copied outside both application bundles. A per-installation file lock prevents concurrent helpers. The helper stages the new bundle next to the installed app and signals readiness. Main-process IPC rejects new work during handoff; background work is checked again after preparation. Normal shutdown stops services and creates a consistent SQLite backup through SQLite's backup API before closing the database. Only a completed shutdown authorizes replacement.

The helper keeps the previous bundle, replaces it with same-directory renames, and launches the candidate through macOS Launch Services. The candidate uses the same workspace and a one-time receipt token. It opens the database and window, verifies the preload/snapshot bridge, and acknowledges startup. Background services remain paused until the helper writes a successful result. The helper then removes the old app and database backup. Download staging is removed after confirmed startup.

If startup is not acknowledged within two minutes, the helper stops the candidate, verifies it has exited, and restores the previous app and pre-update database before reopening. It never restores data after admitting normal user work. If termination fails, backups are retained rather than replacing live files. Other local stores (memory providers, browser profiles, documents) are not rolled back; startup must not perform destructive changes to those stores.

Transaction journals and logs live in `<userData>/updates/transaction-*`; no tokens are written there. If an unconfirmed transaction leaves app staging/backup paths, the next ordinary launch offers recovery before opening the database. A confirmed healthy update cannot be automatically rolled back. Logs/receipts remain for diagnosis; the app does not promise power-loss durability against disk corruption.

A crash after moving the original bundle but before installing the candidate can leave the normal app path missing. In that case use the retained helper in the transaction folder with `request.json --recover <exited-app-pid>`, or restore the `.aegir-update-old` app path manually before opening Aegir and choosing recovery. Do not delete database backups or remove quarantine to work around an error.

## Publishing a signed test release

Publishing remains explicit and uses releases **in this repository**. Pushing code alone never publishes. Use a clean, verified, committed revision; the manifest records HEAD. Never sign a dirty build as though it represented that commit.

1. Build the updater-enabled baseline, version 0.1.1, and have existing users install it normally once.
2. For the test, package the same verified code with a higher version:

   ```sh
   pnpm exec electron-builder --mac dir --arm64 --publish never \
     --config.directories.output=release/update-test \
     --config.extraMetadata.version=0.1.2
   ditto -c -k --sequesterRsrc --keepParent \
     release/update-test/mac-arm64/Aegir.app release/Aegir-0.1.2-arm64.zip
   ```

3. Write plain-text release notes to a local file. Sign the manifest:

   ```sh
   node scripts/update-release.mjs manifest release/Aegir-0.1.2-arm64.zip \
     0.1.2 arm64 release/update-notes.txt release/aegir-update-arm64.json
   ```

4. Explicitly publish a prerelease tagged **v0.1.2**, targeted at the exact source commit, containing `Aegir-0.1.2-arm64.zip` and `aegir-update-arm64.json`. Do not mark it latest stable. Review notes before publishing. Intel requires a separately built x64 app, x64 native helpers and `aegir-update-x64.json`; the initial packaged test is Apple Silicon only.
5. Testers on 0.1.1 check/download/restart from Settings. Confirm installed 0.1.2, preserved data, restart gating, and actual macOS prompts. No helper Terminal commands should be necessary on the successful path.

The one-time key-generation command is `node scripts/update-release.mjs keygen`. It refuses to replace an existing private key or public configuration. It is not part of normal publishing.

## Verification commands

```sh
pnpm check
pnpm test electron/updates.test.ts electron/ipc-security.test.ts
pnpm build
AEGIR_UPDATE_ARCHIVE=1 pnpm test electron/updates.test.ts
node scripts/test-updater-e2e.mjs
```

The opt-in full test requires the baseline under `release/mac-arm64`, a 0.1.2 candidate under `release/updater-e2e/candidate/mac-arm64`, and the local release key. It runs the real packaged UI and native replacement using a disposable workspace and a local GitHub API fixture. Token encryption is stubbed in that disposable process; no real credentials are used. It verifies preservation of a task and successful version/startup confirmation. It does not establish live collaborator-token access or cross-machine Gatekeeper behavior. `--user-data-dir=<absolute-directory>` isolates app data and suppresses login-item registration for such test profiles.

The original standalone proof remains available through `pnpm test:updater-proof` for low-level replacement/recovery checks.

## Verification performed for this implementation

- TypeScript and the production macOS build passed.
- Default suite: 475 passed, with opt-in checks skipped.
- The real packaged archive extracted and cleaned up successfully, including Electron framework symlinks and app.asar.
- A real UI-driven packaged update from 0.1.1 to 0.1.2 passed using a local GitHub fixture and disposable workspace; a task survived and the candidate confirmed startup. The final run included the startup barrier and native process checks.
- Four native recovery checks passed, including the real two-minute failed-startup timeout, app/database restoration, healthy-startup refusal and concurrent installer locking.
- The maintainer's existing GitHub login successfully listed this private repository's releases and downloaded an existing release asset through the same authenticated request/redirect code; its checksum matched. No token was printed or persisted by that test. Collaborator tokens remain to be verified by their owners.
- Settings was visually inspected in the packaged app at full and compact widths.

The verified baseline is built locally. The 0.1.2 candidate and release notes are staged under ignored `release/full-updater-test/`. The signed manifest and publication must follow the source commit, so the manifest identifies the exact committed source. No new release has been published yet.
