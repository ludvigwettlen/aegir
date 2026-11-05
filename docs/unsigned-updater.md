# Unsigned updater: installation proof

Release destination: **this repository**, `ludvigwettlen/aegir`. Do not create a separate release repository. Publishing remains an explicit operation; pushing code must not publish an update. Repository visibility has not yet been verified. Private release assets require a user authentication or distribution design; never embed a maintainer token in the app.

## Status

The first checkpoint is a standalone Swift replacement helper and disposable integration tests. It is deliberately **not bundled into Aegir or exposed in Settings yet**. It accepts a locally staged app; it does not authenticate downloads and must never be wired directly to network content. It does not launch apps, restore databases, alter quarantine, request administrator access, or change Gatekeeper settings.

Run the proof tests on macOS:

```sh
./scripts/test-updater-proof.sh
```

Python is only used by the developer tests. The compiled helper uses the macOS system tools and needs no Python, Node, or compiler on a user's Mac.

## Local verification

On the development Mac: all eight disposable helper integration tests passed, TypeScript checks passed, and replacement/recovery succeeded with a temporary copy of the existing 675 MB packaged Aegir bundle. The installed app was not touched and the temporary app was not launched. This used the same existing build as both source and target; it does not establish cross-version startup, database compatibility, downloaded-app quarantine behavior, or behavior on another Mac.

## Helper protocol

Run the helper from outside the app being replaced, with absolute resolved paths:

```sh
build/aegir-updater-proof install /resolved/path/Aegir.app /resolved/staging/Aegir.app EXITED_APP_PID
```

The PID must be the old app process. The helper waits up to 30 seconds for it to exit, stages a copy using `ditto`, then uses same-directory renames. It checks bundle identity and executable presence, but does **not** establish release authenticity. The eventual controller must verify the signed manifest, hash, archive paths, architecture, and bundle version first.

Sibling transaction paths are `<target>.aegir-update-new`, `<target>.aegir-update-old`, and `<target>.aegir-update.json`. Existing transactions block a second installation. The journal records intent before replacement; the backup remains until explicit confirmation. This handles process interruption, but is not a guarantee against disk corruption or power-loss durability. Run only one helper per target; transaction locking is still required before production integration.

Close all copies of Aegir before manually using either command:

```sh
build/aegir-updater-proof recover /resolved/path/Aegir.app.aegir-update.json
build/aegir-updater-proof confirm /resolved/path/Aegir.app.aegir-update.json
```

`recover` restores the original bundle and removes staged files. `confirm` retains the new bundle and deletes the backup. Never confirm before verifying startup. These are operator-only proof commands, not renderer IPC endpoints. They do not detect running applications or repair database changes. Do not use recovery against real data after a new version has run migrations without an appropriate database recovery plan.

## Required packaged-app checkpoint

On a second Mac, using downloaded builds with their original quarantine metadata:

1. Install the older build in `/Applications` or `~/Applications`. Record any security prompts.
2. Download and extract the newer build to a staging folder; do not remove quarantine.
3. Quit Aegir and run the helper from outside both app bundles with the old PID.
4. Open the replaced app normally from Finder. Record Gatekeeper prompts and whether launch succeeds; inspect Reminders, Keychain access, connections, chats and tasks.
5. Quit all copies and recover; verify the old app opens. Use disposable workspace data if builds differ in schema.
6. Repeat a successful installation and explicitly confirm it.
7. Test an unwritable location and a mounted DMG: production integration must refuse those locations with actionable guidance.

The local automated fixtures exercise replacement and recovery, not Gatekeeper. Do not describe unsigned updates as seamless until this checkpoint passes. If it fails, use a download-and-manually-replace flow while investigating rather than bypassing security settings.

## Remaining implementation after the checkpoint

1. Release packaging from a clean verified revision, unique increasing versions, architecture-specific ZIPs, notes and commit information. Publish assets to releases in this repository, only after explicit authorization.
2. Ed25519-signed manifest with a bundled public key, external private key, archive SHA-256/size, architecture, minimum OS, and release URL. Define canonical signed bytes, key rotation, and downgrade policy. Generate credentials explicitly; do not silently ship a temporary key.
3. Bounded HTTPS check/download service with redirect policy, cancellation, signature/hash verification, safe archive extraction, free-space checks and bundle validation. No maintainer credentials in clients.
4. Harden helper with single-transaction locking, controlled launcher, receipt validation, bounded startup handshake and interruption recovery. Retain original bundle until healthy startup; no rollback while the replacement process is alive.
5. Integrate main-process active-work gating and a barrier against new work. Reuse existing shutdown cleanup. After shutdown, take a consistent SQLite backup including committed WAL contents before the new app opens the database. Persist migration compatibility and recovery state outside the database. Never silently restore a database after resumed user work.
6. Add trusted, schema-validated IPC and typed preload methods. Settings: current version, check, notes, download progress/cancel, and explicit restart. Follow the repository's design system when implementing the UI.
7. Packaged end-to-end tests for successful upgrades, failed startup, data preservation, permission failures, corrupted releases and interrupted replacement. Initially no automatic checks, installs or forced restarts.
