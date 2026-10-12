# Aegir

Aegir is a local-first macOS workspace with two main surfaces: a keyboard-first task list whose tasks you can hand to an agent team, and Slack-style group chats with agents organised into threads. Scheduled routines, Slack and Notion connectors and durable memory support both. This is a new runtime; Hermes was used as product inspiration only.

The default team is Aegir (lead and general assistant), Mimer (research and evidence), Saga (writing and communication), and Freja (product strategy and CPO advice). Freja advises on the products you build, challenging assumptions and weighing priorities, tradeoffs, and validation. Existing default agents are renamed in place on startup, preserving history, memory identities, and custom instructions.

Agent model routing: the Lead role uses the Codex account default. Mimer, Saga, Freja, and any other non-Lead agent use an available Luna model at low reasoning effort; routines use the tier of the agent that runs them, and choosing a group for a handed-off task uses the lightweight tier. The app checks `model/list` before these runs and reports an error if no supported Luna model is available, rather than silently using a larger model. Model choices are not yet individually editable.

## Run

Requires macOS, Node 20+, pnpm, and an authenticated `codex` binary (the ChatGPT desktop bundle is detected automatically). Run `pnpm install`, then `pnpm dev`. Build a local `.app` with `pnpm build`; it appears under `release/mac-arm64/Aegir.app` on Apple Silicon. `pnpm dist` produces a DMG. The local build is unsigned, so it is intended for development on this Mac, not distribution.

The app keeps its window in the menu bar when closed. Packaged builds register as a background login item on first launch; the toggle is in Settings. Routines run on their schedule while the process is running and the Mac is awake; slots missed while asleep collapse into one run after wake.

For startup failures, including a running process with no window after a saved-credential decryption error, see [Troubleshooting](docs/troubleshooting.md).

## Connections

### Browser

Settings → Browser → Enable browser makes browser tools available to new chat and task responses. Google Chrome must be installed. **Open browser to sign in** opens a visible, separate Aegir profile; sign in directly there. Your usual Chrome profile is never attached. The first browser action in each response asks for permission to read signed-in pages and interact with websites, including form submissions and other changes. Denying the request blocks browser access for that response. Unattended routines do not receive these tools.

One agent controls the profile at a time. **Stop browser** revokes the current grant and closes Chrome; stopping the task or chat response also closes it. Finishing a response closes its tabs but keeps logins under `<Electron userData>/browser/profile`. Captures use a bounded cache under `browser/captures`. Access is off by default and can be disabled at any time. An approval grants browser interaction for the requested work; it does not change shell, file, Slack, or Notion permissions.

The backend uses pinned Playwright MCP tools for navigation, accessibility snapshots, clicks, typing, selection, tabs, dialogs and screenshots. Tool images are delivered to the model as images. Arbitrary JavaScript execution, uploads, agent-selected output paths and automatic downloads are not exposed. This release implements browser use; native desktop control is a separate follow-up.

To check the real browser integration without accounts or external websites, run `AEGIR_BROWSER_SMOKE=1 pnpm test electron/browser-smoke.test.ts --pool=forks --maxWorkers=1`. It uses a disposable profile and localhost page to verify interaction, screenshots, persistent cookies and reopening. If `better-sqlite3` is built for Electron, run the suite with `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run --pool=forks --maxWorkers=1`.

### Connected services

- Slack: create an **internal** Slack app with MCP enabled. Add `http://127.0.0.1:8765/callback/slack` as its OAuth redirect URL, and enter its Client ID and Client Secret in Settings. The app requests user-token search and history scopes, then opens Slack's OAuth flow. Your workspace admin may need to approve the app. [Slack's setup and scope guide](https://docs.slack.dev/ai/slack-mcp-server/).
- Notion: click Connect in Settings and complete the browser authorization. Available tools are discovered on connection, since Notion capabilities vary by workspace. [Notion MCP guide](https://www.notion.com/help/notion-mcp).
- Mnemosyne: install `mnemosyne-memory[embeddings]` in an isolated environment. Aegir detects `~/.local/share/aegir/mnemosyne-venv/bin/mnemosyne`, a Hermes installation at `~/.hermes/hermes-agent/venv/bin/mnemosyne`, or `mnemosyne` on `PATH`; the `mnemosyneBinary` setting overrides discovery. Mnemosyne is the only active memory store, with separate banks for shared and per-agent memories. The Memory screen searches those banks directly. An optional `hermesMemoryDataDir` setting (for example `~/.hermes/mnemosyne/data`, stored as an absolute path) adds Hermes’s default bank as a read-only retrieval source, labelled `[hermes]` in results. Chat, task and routine runs recall from the shared bank and the running agent's own bank, and expose a read-only memory search tool. Old Aegir SQLite memories are migrated into Mnemosyne on startup or the next memory operation; an unsuccessful migration leaves the original row intact and shows the remaining count on the Memory screen. Memory operations fail clearly while Mnemosyne is unavailable. [Mnemosyne CLI reference](https://github.com/mnemosyne-oss/mnemosyne/blob/main/docs/cli-reference.md).

OAuth tokens and the Slack secret are encrypted with Electron `safeStorage` on macOS. App state is in Aegir's Electron user-data directory as `aegir.sqlite`. On first launch after the rename, an existing Agent Desk database is copied into the new location. No connector credentials are committed to this repository.

## Product notes

**Tasks.** Today, Upcoming and With the team are lists of the same tasks; Needs you collects suggestions, work ready for review and blocked work. Today, Upcoming and the Inbox are grouped by priority, P1 to P3, which Claude sets in the background with a one-line reason; press 1, 2 or 3 to set your own, which is logged so Claude's next run learns from it, and 0 to hand it back. Today holds only tasks due today or overdue. Upcoming holds later dates and, under No date, undated work an agent is doing or has handed back, each marked with whose move it is; your own undated tasks stay in the Inbox. Quick add understands `#label`, date words (`today`, `fri`, `2026-10-02`) and `!1`/`!2`/`!3`. Press `Cmd+Enter`, or the Claude button at the end of the field, to have Claude write the task instead: a short title, the rest of what you said as context, a date, and one of your existing labels when you name it. One quick Haiku call without tools, about 3 seconds; names are spelled from `~/brain/people`. If it fails, your note stays in the field and Enter adds it as typed. Hold `§` to see shortcuts for the current page or editor; release it to dismiss. `Cmd+K`, or the search bar at the top of the sidebar, finds any task and any action. A task is found when every word you type is somewhere in it: title, label, context, anything said in its conversation, or a document Claude wrote in its folder, finished tasks included. Enter opens it where it lives. For an action, type a few letters (initials and synonyms work), see its shortcut, and press Enter to run it.

**Handing off.** `A` takes one instruction. The task always goes to the agent team: a lightweight model picks the best group, and the group's lead starts in a new task thread. For substantive work, the lead is instructed to involve the most suitable teammate for a focused contribution or review; clearly simple tasks and requests to work alone can stay with one agent. The runtime executes one teammate follow-up in the same thread and output folder before moving the task to review. File deliverables go into `~/Documents/Aegir/<task>` (Codex `workspace-write` sandbox with that folder as its working directory). Slack and Notion tools remain read-only. When Browser is enabled, tasks may also request browser control for that response; website changes require that separate approval. When the run ends the task moves to Needs you for review; replying in its thread continues the work. Click the task’s channel label or press Shift+A on its row to open that exact conversation in the channel.

**Groups and threads.** A group is a standing set of agents with an optional purpose; each agent also has a private group for direct chat. Conversation happens in threads, and each run sees only its own thread's transcript plus recalled memory, which keeps context bounded. Mentioning `@Agent` brings that agent in. Chat runs can use Slack and Notion writes, each behind an in-app approval.

**Routines.** Scheduled agent runs (hourly, daily or weekly, optionally weekdays only), listed in the sidebar. Each run is a Codex conversation with read-only connector tools, memory, and `tasks__suggest` for putting items under Needs you. Every step is written to a run log (raw text, kept for 30 days) that you can open from the routine. Tag a routine in chat (`@Hourly discovery`) to discuss it; agents can propose a change or a new routine, which you apply or discard. Approval requests during unattended runs are declined and logged. The seeded "Hourly discovery" routine replaces the old fixed-query reviewer.

Codex runs chat and routines in a read-only sandbox. Commands that need broader permissions pause for an in-app approval. The app does **not** implement a separate policy engine that can classify every possible credential read or app-automation command; do not grant a broad command approval without inspecting it.

Upgrading keeps existing data: rooms become groups, each room's history becomes a closed "Earlier conversation" thread, and goal output becomes a task thread. The old tables stay in the database. No Slack, Notion, or Mnemosyne account was connected during local development, so live OAuth, retrieval and full agent runs need an end-to-end check with your accounts.

The in-app Markdown workspace supports formatted editing, autosave, and selected-passage references to the team. To review a whole document, select passages and press Comment (or `Shift+Cmd+M`) as you read, edit wording directly, then press **Send N comments** (or `Shift+Cmd+Enter`): Claude gets every comment in one message and the comments leave the file. The active heading shows its `#` level in the left margin. Type `/` on an empty paragraph to insert a table, link, list, checklist, quote, code block, or divider; Cmd+K opens link insertion for selected text.

The UI is documented in [the design system](docs/design-system.md).
Current follow-up work is tracked in [TODO.md](TODO.md). Shared agent behavior and the Hermes comparison are documented in [the instruction review](docs/agent-instructions-review.md).

## Verification

`pnpm check` runs TypeScript validation. `pnpm test` covers the store migration, hand-off and routine runs against a fake Codex, the read-only tool policy, routine schedules and change validation, quick-add parsing and task lists. `pnpm build` compiles and packages the macOS app.

Electron 44 no longer downloads its binary during install, and `better-sqlite3` 13 ships a Node-API prebuild that loads under both Node and Electron, so no native rebuild is needed. When Node cannot reach GitHub, fetch `electron-v<version>-darwin-arm64.zip` with curl, check it against the release's `SHASUMS256.txt`, unpack it with `ditto -x -k` into `node_modules/electron/dist`, and write `Electron.app/Contents/MacOS/Electron` to `node_modules/electron/path.txt`. Then package with `electron-builder --mac dir -c.electronDist=node_modules/electron/dist -c.npmRebuild=false`. After a dependency upgrade, run `tsc -b --force`: the incremental build does not notice changed library types.

Tests should protect observable outcomes, permission boundaries, data preservation, and distinct failure paths. Avoid locking prompt wording or seed counts. Assertions for asynchronous failures must run outside error-catching application callbacks so a swallowed assertion cannot produce a passing test.

## Skills

Open **Settings** with `Cmd+,` or the Aegir menu, then **Manage skills** to manage shared skills, agent-owned skills, proposed changes, and archives. Shared skills are inherited by default and can be disabled per agent. Create or import a `SKILL.md` file or complete skill folder; supporting references and binary assets are preserved. Bind required skills in a routine’s Skills section. Type `/` in a conversation composer to search skills available to its current recipients. Enter, Tab, or clicking selects a skill; removable chips show what will be loaded with the message. Explicit selections use stable IDs, and the runtime rechecks scope and requirements before loading.

Chats, tasks, and routines share on-demand discovery and loading. Each run reads a frozen package revision. Agents may create and refine their own learned skills; shared, imported, and user-authored changes are proposed for review. You can protect a skill from agent changes, compare proposals, restore revisions, customize shared skills for one agent, or promote an owned skill to a shared copy. Skill instructions never grant additional tool permissions.

Live packages are under `<Electron userData>/skills`; SQLite stores scope, bindings, full revision snapshots, change proposals, usage, and recovery journals. Direct disk changes are reconciled before runs and when opening the library. Agent scope controls discovery and tools, not OS-level confidentiality. Script execution helpers, remote skill marketplaces, and automated curation are not included in this release. See [the architecture](docs/skills-architecture.md) for details.

### Slack through Composio

In Settings → Connections → Slack via Composio, enter the expected Slack connection ID and the **consumer API key from Composio's AI Clients setup** (not a Platform project API key), then Connect. Alternatively leave the key blank and authorize the same Composio account in your browser. Disconnect clears Aegir's saved Composio credentials; it does not revoke or delete your upstream Slack connection. Disconnect before switching from a saved key to browser authorization.

The endpoint is fixed to `https://connect.composio.dev/mcp`; credentials use encrypted macOS storage and are never included in snapshots or model prompts. The hub resolves the active Slack connection. The expected account ID is included in tool guidance so agents check discovery results; it is not a server-side pin. Other connected apps are not executable through this integration.

Agents can discover Slack tools and use a locally validated read-only execution wrapper in chats, tasks, and routines. Other Slack actions use the existing chat approval flow; tasks and routines cannot execute them. Unknown read actions require chat approval until added to the reviewed allowlist. Remote bash/workbench and connection-management tools are excluded. Authenticate and test a Slack search before enabling unattended work; an MCP connection alone does not prove the Slack account is active.

References: [Composio Connect](https://docs.composio.dev/docs/composio-connect), [consumer-key header](https://docs.composio.dev/kb/guide/toolkits-linkedin), [meta tools](https://docs.composio.dev/toolkits/meta-tools).
