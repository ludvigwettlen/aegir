# Project TODO

Short, shared list of the next product and engineering steps. Keep items actionable and remove stale entries during normal maintenance.

Interaction principle: prefer immediate, reversible actions with `Cmd+Z` undo over confirmation dialogs. Reserve confirmations for actions that cannot be reliably undone.

## Next

- [ ] Add a shortcut from a task to its ongoing conversation in the channel, opening the linked thread directly.
- [ ] Explore an in-app calendar view where clicking a meeting opens meeting prep prepared by the agent teams for review.
- [ ] Make team collaboration the default for handed-off tasks: the lead should involve suitable teammates unless the task is clearly simple enough to handle alone.
- [ ] Add /-commands in the chat composer to discover and invoke skills.
- [ ] Add an in-app Markdown viewer and editor for reviewing, editing, and collaborating on files with the agent team.
- [ ] Exercise Slack, Notion, and full agent runs end to end with real accounts.

## Recently completed

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
