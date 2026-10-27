# Project TODO

Short, shared list of the next product and engineering steps. Keep items actionable and remove stale entries during normal maintenance.

Interaction principle: prefer immediate, reversible actions with `Cmd+Z` undo over confirmation dialogs. Reserve confirmations for actions that cannot be reliably undone.

## Next

- [x] Add a calendar-first 1:1 prep section with upcoming meetings, automatic read-only agenda preparation, sources, editable notes and calendar refresh.
- [ ] Add proper web search tools for agents.

## Security review follow-ups — 2026-10-01

Reviewed the working tree, including uncommitted changes. P1 items are high priority; P2 items are normal priority. The four P1 findings were addressed on 27 October 2026; the P2 allowlist work remains open.

- [x] **P1 — Show the actual scope of permission approvals.** In `electron/codex.ts`, display requested filesystem paths, access levels, network access, and grant duration alongside the agent's reason. Currently the reason can be the only visible detail while approval grants the full requested permissions for the turn. Add a regression test verifying that every granted capability is visible to the user.
- [x] **P1 — Cancel pending external writes when their run ends.** Bind connector approvals in `electron/main.ts` to the originating run's cancellation signal, expire them on stop/completion, and revalidate the active run immediately before calling the connector. A pending write currently executes after its run context disappears if its stale approval is accepted. Cover cancellation, completion, and late approval responses.
- [x] **P1 — Isolate Aegir runs from host Codex MCP/plugin tools.** `electron/codex.ts` disables host skills but does not isolate inherited MCP/plugin configuration. A host tool configured for automatic approval can bypass Aegir's connector policy, including in routines. Use an explicitly restricted configuration and verify the effective tool inventory; test with a synthetic host write tool. This risk depends on host configuration and was not tested with a live external write. See the [official MCP configuration documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
- [x] **P1 — Upgrade the packaged Electron runtime and triage dependency advisories.** `package.json` resolves to Electron 37.10.3. The review's dependency audit reported 41 advisories (13 high, 22 moderate, six low), including 37 Electron entries. Upgrade to a supported, patched release, rebuild native dependencies, and rerun the audit and app checks. Electron is the packaged runtime despite being listed in devDependencies. Review the [context-isolation bypass advisory](https://github.com/electron/electron/security/advisories/GHSA-h7rp-cf8h-j98x), which involves the Promise-returning bridge pattern used here; exploitability requires additional conditions, and the advisory count is not a count of demonstrated application exploits.
- [ ] **P2 — Replace Slack/Notion read-only name heuristics with explicit allowlists.** In `electron/connectors.ts`, a `get`/`read`-style name currently overrides even an explicit `readOnlyHint: false`. Follow Composio's reviewed allowlist approach; require chat approval for unknown actions and exclude them from tasks/routines. Add a regression case for a synthetic `notion-get-or-create-page` tool marked as a write.

Validation on 27 October: approval cards enumerate files, access, network and grant duration; connector approvals expire on stop/completion/replacement and revalidate at dispatch; fresh and resumed Codex threads disable inherited servers/apps/plugins/hooks and verify the complete effective tool inventory before a turn. An isolated live Codex probe confirmed a synthetic host server was disabled with zero tools. Electron is now 44.9.3 and SQLite 13.0.3; patched connector/build/test dependencies and two scoped transitive overrides bring the current registry audit to zero known advisories. TypeScript, 435 automated checks, four selected browser walkthroughs, the unsigned macOS build and an isolated built-app startup passed. The other 31 opt-in checks were skipped in the full unit run. Claude is signed out and gbrain is absent; live external delivery remains unverified.

Validation at review time: TypeScript passed; 132 tests passed under Electron's runtime, with two opt-in tests skipped. Three temporary probes reproduced hidden permission scope, writes after run-context removal, and the read-only classification override. The probes were removed from the project after the review. Live authenticated integrations were not exercised.

## Structural and security hardening

- [ ] Centralize run identity, allowed tools, cancellation, and pending approvals in a shared run context used by every tool dispatcher. Permission and lifecycle ownership is currently split across `main.ts`, `runtime.ts`, `codex.ts`, and the browser/connector modules.
- [ ] Validate IPC sender/frame identity and channel payloads at the boundary in `electron/main.ts`; replace the unchecked `any[]` handler contract with runtime schemas and typed handlers. Test rejection of untrusted senders and malformed payloads.
- [ ] Enable the Electron renderer sandbox, currently disabled in `electron/main.ts`, and verify preload compatibility and app flows. Sender validation and sandboxing are hardening gaps, not demonstrated renderer exploits. Follow [Electron's security guidance](https://www.electronjs.org/docs/latest/tutorial/security).
- [ ] Separate IPC registration, approval management, and startup from `electron/main.ts`; separate migrations and domain persistence responsibilities in `electron/db.ts` so permission boundaries and data preservation are easier to test.

## Recently completed

- [x] Add a shortcut from a task to its ongoing conversation in the channel, opening the linked thread directly.
- [x] Make team collaboration the default for handed-off tasks: the lead should involve suitable teammates unless the task is clearly simple enough to handle alone.
- [x] Add /-commands in the chat composer to discover and invoke skills.
- [x] Add an in-app Markdown viewer and editor for reviewing, editing, and collaborating on files with the agent team.
- [x] Show heading-level markers in the editor margin and add formatting insertion commands, including tables and links.

- [x] Add a Copy chat button for the full conversation transcript, including earlier messages and proposal status.

- [x] Replace persistent keyboard hints with a contextual hold-§ overlay.
- [x] Render Markdown in chat and remove the composer’s skill dropdown.

- [x] Prevent late runtime status events from reading the database after app shutdown.
- [x] Review the remaining agent base/system instructions against Hermes’s system prompt; skill discovery, authoring, review, and reflection guidance are now implemented.

- [x] Exit editing mode after creating a new task so keyboard navigation works immediately, without pressing Escape first.
- [x] Move “Needs you” into the Tasks section of the sidebar instead of keeping it as a separate top-level section.
- [x] Make Settings available from the macOS menu bar and through `Cmd+,`. Remove the bottom-left sidebar footer, including the manual Memory entry and Sources indicator; preserve access to skill management through Settings.
- [x] Remove the Settings page’s Runtime / “Codex”, Background / “Always ready”, and Output / “Files, not posts” cards.

- [x] Add shared and agent-owned skill libraries with on-demand loading across chats, tasks, and routines, authoring tools, proposed changes, revision history, and management UI.

- [x] Add a completed-task view ordered by completion time, with reopen actions.
- [x] Add session `Cmd+Z` undo for local task actions, including deletion with thread/message restoration; remove the second deletion click.
- [x] Add Vim pane and list navigation across the workspace, including left from a task into the sidebar.
- [x] Align task shortcuts with Godspeed, including `Enter` title editing, `Space` completion, `Cmd+N` creation, and `n` notes.
- [x] Attach and manage copied URLs or deep links on tasks with `Cmd+V`, separately from task source provenance.
- [x] Complete task CRUD for title, notes, label, due date, and task deletion.
- [x] Use Mnemosyne as the only active memory store; migrate legacy SQLite memories, remove the fallback and pending sync, and update the Memory screen, docs, and tests.
