# Project TODO

Short, shared list of the next product and engineering steps. Keep items actionable and remove stale entries during normal maintenance.

Interaction principle: prefer immediate, reversible actions with `Cmd+Z` undo over confirmation dialogs. Reserve confirmations for actions that cannot be reliably undone.

## Next

- [ ] Add a completed-task view so finished work can be reviewed or reopened.
- [ ] Add `Cmd+Z` undo for task actions, starting with deletion and restoration of its task thread and messages. Remove the current second deletion click when undo is ready.
- [ ] Prevent late runtime status events from reading the database after app shutdown.
- [ ] Exercise Slack, Notion, and full agent runs end to end with real accounts.
- [ ] Add full keyboard navigation across the app with Vim motions (`h`/`j`/`k`/`l`), including moving left from a selected task into the sidebar and moving back into the content area.
- [ ] Align task shortcuts with Godspeed: `Enter` edits the selected task's title, `d` sets a due date, `Shift+D` removes it, `Space` toggles done, `Cmd+N` creates a task, and `n` adds or edits a note. In title edit mode, `Enter` saves and `Escape` cancels. Apply the same set/clear pattern to other task metadata where it fits, and update shortcut hints.
- [ ] Let `Cmd+V` attach a copied URL or deep link to the selected task, with a way to see and manage the saved link.
- [ ] Review the agent base/system instructions against Hermes agent's system prompt. Add a deliberate workflow for agents to review completed work and create or refine reusable skills after tasks, including how those skills are stored and reviewed.

## Recently completed

- [x] Complete task CRUD for title, notes, label, due date, and task deletion.
- [x] Use Mnemosyne as the only active memory store; migrate legacy SQLite memories, remove the fallback and pending sync, and update the Memory screen, docs, and tests.
