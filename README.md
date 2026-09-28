# Ägir

Ägir is a local-first macOS workspace with two main surfaces: a keyboard-first task list whose tasks you can hand to an agent team, and Slack-style group chats with agents organised into threads. Scheduled routines, Slack and Notion connectors and durable memory support both. This is a new runtime; Hermes was used as product inspiration only.

The default team is Ägir (lead and general assistant), Mimer (research and evidence), Saga (writing and communication), and Freja (product strategy and CPO advice). Freja advises on the products you build, challenging assumptions and weighing priorities, tradeoffs, and validation. Existing default agents are renamed in place on startup, preserving history, memory identities, and custom instructions.

Agent model routing: the Lead role uses the Codex account default. Mimer, Saga, Freja, and any other non-Lead agent use an available Luna model at low reasoning effort; routines use the tier of the agent that runs them, and choosing a group for a handed-off task uses the lightweight tier. The app checks `model/list` before these runs and reports an error if no supported Luna model is available, rather than silently using a larger model. Model choices are not yet individually editable.

## Run

Requires macOS, Node 20+, pnpm, and an authenticated `codex` binary (the ChatGPT desktop bundle is detected automatically). Run `pnpm install`, then `pnpm dev`. Build a local `.app` with `pnpm build`; it appears under `release/mac-arm64/Aegir.app` on Apple Silicon. The ASCII bundle filename avoids an Electron 37 startup crash with the `Ä` character; the product is still branded Ägir in the interface. `pnpm dist` produces a DMG. The local build is unsigned, so it is intended for development on this Mac, not distribution.

The app keeps its window in the menu bar when closed. Packaged builds register as a background login item on first launch; the toggle is in Settings. Routines run on their schedule while the process is running and the Mac is awake; slots missed while asleep collapse into one run after wake.

## Connections

### Browser

Settings → Browser → Enable browser makes browser tools available to new chat and task responses. Google Chrome must be installed. **Open browser to sign in** opens a visible, separate Ägir profile; sign in directly there. Your usual Chrome profile is never attached. The first browser action in each response asks for permission to read signed-in pages and interact with websites, including form submissions and other changes. Denying the request blocks browser access for that response. Unattended routines do not receive these tools.

One agent controls the profile at a time. **Stop browser** revokes the current grant and closes Chrome; stopping the task or chat response also closes it. Finishing a response closes its tabs but keeps logins under `<Electron userData>/browser/profile`. Captures use a bounded cache under `browser/captures`. Access is off by default and can be disabled at any time. An approval grants browser interaction for the requested work; it does not change shell, file, Slack, or Notion permissions.

The backend uses pinned Playwright MCP tools for navigation, accessibility snapshots, clicks, typing, selection, tabs, dialogs and screenshots. Tool images are delivered to the model as images. Arbitrary JavaScript execution, uploads, agent-selected output paths and automatic downloads are not exposed. This release implements browser use; native desktop control is a separate follow-up.

To check the real browser integration without accounts or external websites, run `AEGIR_BROWSER_SMOKE=1 pnpm test electron/browser-smoke.test.ts --pool=forks --maxWorkers=1`. It uses a disposable profile and localhost page to verify interaction, screenshots, persistent cookies and reopening. If `better-sqlite3` is built for Electron, run the suite with `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run --pool=forks --maxWorkers=1`.

### Connected services

- Slack: create an **internal** Slack app with MCP enabled. Add `http://127.0.0.1:8765/callback/slack` as its OAuth redirect URL, and enter its Client ID and Client Secret in Settings. The app requests user-token search and history scopes, then opens Slack's OAuth flow. Your workspace admin may need to approve the app. [Slack's setup and scope guide](https://docs.slack.dev/ai/slack-mcp-server/).
- Notion: click Connect in Settings and complete the browser authorization. Available tools are discovered on connection, since Notion capabilities vary by workspace. [Notion MCP guide](https://www.notion.com/help/notion-mcp).
- Mnemosyne: install `mnemosyne-memory[embeddings]` in an isolated environment. Ägir detects `~/.local/share/aegir/mnemosyne-venv/bin/mnemosyne`, a Hermes installation at `~/.hermes/hermes-agent/venv/bin/mnemosyne`, or `mnemosyne` on `PATH`; the `mnemosyneBinary` setting overrides discovery. Mnemosyne is the only active memory store, with separate banks for shared and per-agent memories. The Memory screen searches those banks directly. An optional `hermesMemoryDataDir` setting (for example `~/.hermes/mnemosyne/data`, stored as an absolute path) adds Hermes’s default bank as a read-only retrieval source, labelled `[hermes]` in results. Chat, task and routine runs recall from the shared bank and the running agent's own bank, and expose a read-only memory search tool. Old Ägir SQLite memories are migrated into Mnemosyne on startup or the next memory operation; an unsuccessful migration leaves the original row intact and shows the remaining count on the Memory screen. Memory operations fail clearly while Mnemosyne is unavailable. [Mnemosyne CLI reference](https://github.com/mnemosyne-oss/mnemosyne/blob/main/docs/cli-reference.md).

OAuth tokens and the Slack secret are encrypted with Electron `safeStorage` on macOS. App state is in Ägir's Electron user-data directory as `aegir.sqlite`. On first launch after the rename, an existing Agent Desk database is copied into the new location. No connector credentials are committed to this repository.

## Product notes

**Tasks.** Today, Upcoming and With the team are lists of the same tasks; Needs you collects suggestions, work ready for review and blocked work. Tasks are grouped by label. Quick add understands `#label` and date words (`today`, `fri`, `2026-10-02`). Hold `§` to see shortcuts for the current page or editor; release it to dismiss.

**Handing off.** `H` takes one instruction. The task always goes to the agent team: a lightweight model picks the best group, and the group's lead starts in a new task thread (other agents join when mentioned). File deliverables go into `~/Documents/Ägir/<task>` (Codex `workspace-write` sandbox with that folder as its working directory). Slack and Notion tools remain read-only. When Browser is enabled, tasks may also request browser control for that response; website changes require that separate approval. When the run ends the task moves to Needs you for review; replying in its thread continues the work.

**Groups and threads.** A group is a standing set of agents with an optional purpose; each agent also has a private group for direct chat. Conversation happens in threads, and each run sees only its own thread's transcript plus recalled memory, which keeps context bounded. Mentioning `@Agent` brings that agent in. Chat runs can use Slack and Notion writes, each behind an in-app approval.

**Routines.** Scheduled agent runs (hourly, daily or weekly, optionally weekdays only), listed in the sidebar. Each run is a Codex conversation with read-only connector tools, memory, and `tasks__suggest` for putting items under Needs you. Every step is written to a run log (raw text, kept for 30 days) that you can open from the routine. Tag a routine in chat (`@Hourly discovery`) to discuss it; agents can propose a change or a new routine, which you apply or discard. Approval requests during unattended runs are declined and logged. The seeded "Hourly discovery" routine replaces the old fixed-query reviewer.

Codex runs chat and routines in a read-only sandbox. Commands that need broader permissions pause for an in-app approval. The app does **not** implement a separate policy engine that can classify every possible credential read or app-automation command; do not grant a broad command approval without inspecting it.

Upgrading keeps existing data: rooms become groups, each room's history becomes a closed "Earlier conversation" thread, and goal output becomes a task thread. The old tables stay in the database. No Slack, Notion, or Mnemosyne account was connected during local development, so live OAuth, retrieval and full agent runs need an end-to-end check with your accounts.

The UI is documented in [the design system](docs/design-system.md).
Current follow-up work is tracked in [TODO.md](TODO.md). Shared agent behavior and the Hermes comparison are documented in [the instruction review](docs/agent-instructions-review.md).

## Verification

`pnpm check` runs TypeScript validation. `pnpm test` covers the store migration, hand-off and routine runs against a fake Codex, the read-only tool policy, routine schedules and change validation, quick-add parsing and task lists. `pnpm build` compiles and packages the macOS app.

Tests should protect observable outcomes, permission boundaries, data preservation, and distinct failure paths. Avoid locking prompt wording or seed counts. Assertions for asynchronous failures must run outside error-catching application callbacks so a swallowed assertion cannot produce a passing test.

## Skills

Open **Settings** with `Cmd+,` or the Ägir menu, then **Manage skills** to manage shared skills, agent-owned skills, proposed changes, and archives. Shared skills are inherited by default and can be disabled per agent. Create or import a `SKILL.md` file or complete skill folder; supporting references and binary assets are preserved. Bind required skills in a routine’s Skills section. Composer /-commands for skills are planned.

Chats, tasks, and routines share on-demand discovery and loading. Each run reads a frozen package revision. Agents may create and refine their own learned skills; shared, imported, and user-authored changes are proposed for review. You can protect a skill from agent changes, compare proposals, restore revisions, customize shared skills for one agent, or promote an owned skill to a shared copy. Skill instructions never grant additional tool permissions.

Live packages are under `<Electron userData>/skills`; SQLite stores scope, bindings, full revision snapshots, change proposals, usage, and recovery journals. Direct disk changes are reconciled before runs and when opening the library. Agent scope controls discovery and tools, not OS-level confidentiality. Script execution helpers, remote skill marketplaces, and automated curation are not included in this release. See [the architecture](docs/skills-architecture.md) for details.
