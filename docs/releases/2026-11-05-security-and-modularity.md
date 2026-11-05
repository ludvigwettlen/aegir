# Security and modularity — 5 November 2026

This update strengthens the boundaries between rendered content, agent tools, and privileged desktop operations.

## Security changes

- Connector reads use reviewed tool allowlists. Explicit write or destructive metadata always wins. Unknown tools require approval in chat and are unavailable to unattended runs. Claude-native connections use the same classification rules.
- Connector dispatch rechecks the active run and discovered permissions. Calls from ended runs are rejected, including reads.
- Chat links and pasted web links accept HTTP and HTTPS only, without embedded credentials. Application protocol links are rejected. Explicitly attached local files retain their separate file handling.
- Remote images in chat and documents display a placeholder until **Load remote image** is clicked. Consent applies to that image source in the current view; changing the source or reopening the view requires consent again. Requests omit the referrer.
- Every desktop IPC endpoint checks the calling window, main frame, and exact trusted application URL before validating its arguments. Unknown endpoints cannot be registered without a schema. Malformed approvals, draft fields, unsupported task fields, and incorrect argument counts are rejected before dispatch.
- The main Electron renderer now runs with its sandbox enabled, alongside context isolation and disabled Node integration.

## Internal changes

- Desktop handlers are separated into task, conversation, integration, and workspace modules behind one IPC registration boundary.
- Application tool dispatch is independent of startup and window lifecycle code.
- Runtime feature services are supplied through a factory with structural service interfaces. Concrete construction and skill database wiring live in the service composition module.
- Tool discovery, attended/unattended exposure, native provider permissions, and connector dispatch share an authorization module.

## Compatibility

App protocol links such as `obsidian://` and `vscode://` no longer open through chat or task web links. Use web URLs or explicitly attached local files. New connector tools must be reviewed before they can run as unattended reads; they remain available through approval in chat.

## Verification

- TypeScript validation passed.
- Default tests: 467 passed; 36 opt-in checks skipped in that run.
- Targeted browser checks passed for chat and document image consent, source changes, and reopening.
- The built Electron app passed a disposable-data smoke test covering task creation, document saves, image bytes through the sandboxed preload, malformed approvals, and rejection of a second window's IPC calls.
- The macOS application package built successfully. The local package is unsigned because no Developer ID signing identity is configured.

Connector policy checks use mocked services; live Slack/Notion accounts and OAuth were not exercised.
