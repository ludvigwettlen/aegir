# Project TODO

Short, shared list of the next product and engineering steps. Keep items actionable and remove stale entries during normal maintenance.

Interaction principle: prefer immediate, reversible actions with `Cmd+Z` undo over confirmation dialogs. Reserve confirmations for actions that cannot be reliably undone.

## Next

- [ ] Prevent late runtime status events from reading the database after app shutdown.
- [ ] Exercise Slack, Notion, and full agent runs end to end with real accounts.
- [ ] Review the agent base/system instructions against Hermes agent's system prompt. Add a deliberate workflow for agents to review completed work and create or refine reusable skills after tasks, including how those skills are stored and reviewed.

## Recently completed

- [x] Add a completed-task view ordered by completion time, with reopen actions.
- [x] Add session `Cmd+Z` undo for local task actions, including deletion with thread/message restoration; remove the second deletion click.
- [x] Add Vim pane and list navigation across the workspace, including left from a task into the sidebar.
- [x] Align task shortcuts with Godspeed, including `Enter` title editing, `Space` completion, `Cmd+N` creation, and `n` notes.
- [x] Attach and manage copied URLs or deep links on tasks with `Cmd+V`, separately from task source provenance.
- [x] Complete task CRUD for title, notes, label, due date, and task deletion.
- [x] Use Mnemosyne as the only active memory store; migrate legacy SQLite memories, remove the fallback and pending sync, and update the Memory screen, docs, and tests.
