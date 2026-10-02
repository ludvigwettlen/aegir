# Troubleshooting

## App runs without a window: saved credentials cannot be decrypted

Observed on September 30, 2026 in a packaged macOS build. Aegir's main process and GPU/network helpers were running, but no renderer process or window appeared. Relaunching the executable from a terminal exposed:

```text
Error: Error while decrypting the ciphertext provided to safeStorage.decryptString.
```

The stack led from `KeychainState.get()` through the OAuth provider's `tokens()` method into `ConnectorManager.start()`. Startup tried to read encrypted connector credentials before creating the window. The decryption error escaped the asynchronous startup callback as an unhandled promise rejection, leaving Electron alive without completing window creation.

The failure to decrypt was confirmed; the underlying reason the saved ciphertext could no longer be decrypted was not established. The issue occurred around a rename/rebuild, but that alone does not prove the rename caused it.

### Fix and recovery

- Create the window, application menu, and tray before starting connectors and routines.
- Catch credential-read failures separately for each connector during startup, report an error for that connection, and continue starting the others.
- Keep the Settings snapshot readable even when Slack or Composio credentials cannot be decrypted.
- Preserve the stored ciphertext. Do not automatically delete credentials or reset the database.

If Settings reports that saved credentials could not be unlocked, unlock the macOS Keychain and retry the connection. If the problem persists, disconnect and reconnect the affected connection through Settings. Reauthorization may be required; the startup fix does not repair or recover an unreadable credential.

Regression coverage is in `electron/connectors.test.ts`: simulated decryption failures must not throw out of connector startup or configuration checks, unaffected connectors retain their state, and saved credential entries remain intact. The rebuilt packaged app was also opened and its populated window verified.

### Diagnosing a recurrence

First try reopening Aegir from its Dock icon or menu-bar menu: closing the window normally hides it. If that does not work, quit the existing instance and run the packaged executable from the repository root to capture startup errors:

```sh
release/mac-arm64/Aegir.app/Contents/MacOS/Aegir
```

Inspect the error and stack before resetting anything. A missing window can have other causes; this entry specifically covers the `safeStorage.decryptString` failure above. Keep credentials and authorization headers out of diagnostic logs.

## Notion connection reports a credential decryption error

Notion’s saved OAuth tokens or client registration may be unreadable by the current Keychain encryption context. Retrying Connect preserves those credentials and reports recovery instructions. The Notion row now includes Disconnect: use it, then Connect to start a fresh authorization. Disconnect clears only Notion’s stored OAuth state; it does not change the Notion workspace or other connections. OAuth callback decryption failures are also caught and reported instead of escaping the request handler. The underlying reason a saved credential became unreadable is not determined by this error alone.

Regression coverage in `electron/connectors.test.ts` checks that a failed connection preserves ciphertext, an explicit disconnect clears all Notion OAuth state while retaining Slack credentials, and a subsequent mocked connection can proceed.
