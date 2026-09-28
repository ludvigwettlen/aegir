# Ägir

Ägir is a local-first macOS workspace with two main surfaces: a keyboard-first task list whose tasks you can hand to an agent team, and Slack-style group chats with agents organised into threads. Scheduled routines, Slack and Notion connectors and durable memory support both. This is a new runtime; Hermes was used as product inspiration only.

Agent model routing: the Lead role uses the Codex account default. Scout, Quill, and any other non-Lead agent use an available Luna model at low reasoning effort; routines use the tier of the agent that runs them, and choosing a group for a handed-off task uses the lightweight tier. The app checks `model/list` before these runs and reports an error if no supported Luna model is available, rather than silently using a larger model. Model choices are not yet individually editable.

## Run

Requires macOS, Node 20+, pnpm, and an authenticated `codex` binary (the ChatGPT desktop bundle is detected automatically). Run `pnpm install`, then `pnpm dev`. Build a local `.app` with `pnpm build`; it appears under `release/mac-arm64/Aegir.app` on Apple Silicon. The ASCII bundle filename avoids an Electron 37 startup crash with the `Ä` character; the product is still branded Ägir in the interface. `pnpm dist` produces a DMG. The local build is unsigned, so it is intended for development on this Mac, not distribution.

The app keeps its window in the menu bar when closed. Packaged builds register as a background login item on first launch; the toggle is in Settings. Routines run on their schedule while the process is running and the Mac is awake; slots missed while asleep collapse into one run after wake.

## Connections

- Slack: create an **internal** Slack app with MCP enabled. Add `http://127.0.0.1:8765/callback/slack` as its OAuth redirect URL, and enter its Client ID and Client Secret in Settings. The app requests user-token search and history scopes, then opens Slack's OAuth flow. Your workspace admin may need to approve the app. [Slack's setup and scope guide](https://docs.slack.dev/ai/slack-mcp-server/).
- Notion: click Connect in Settings and complete the browser authorization. Available tools are discovered on connection, since Notion capabilities vary by workspace. [Notion MCP guide](https://www.notion.com/help/notion-mcp).
- Mnemosyne: install `mnemosyne-memory` separately so the `mnemosyne` CLI is on `PATH`, or use the automatically detected Hermes installation at `~/.hermes/hermes-agent/venv/bin/mnemosyne`. The `mnemosyneBinary` setting overrides executable discovery. The app uses isolated Mnemosyne banks for shared and per-agent memories. An optional `hermesMemoryDataDir` setting (for example `~/.hermes/mnemosyne/data`, stored as an absolute path) adds Hermes’s default bank as a retrieval source, labelled `[hermes]` in results. Saving, correcting, and forgetting memories still target only Ägir banks; Hermes results are not copied into Ägir’s local memory list. Mnemosyne may perform its normal database maintenance during recall. Until the CLI is available, memories remain in the local SQLite mirror. Chat, task and routine runs all recall from the shared bank and the running agent's own bank, and expose a read-only memory search tool so agents can retrieve additional context during a run. [Mnemosyne CLI reference](https://github.com/mnemosyne-oss/mnemosyne/blob/main/docs/api-reference.md).

OAuth tokens and the Slack secret are encrypted with Electron `safeStorage` on macOS. App state is in Ägir's Electron user-data directory as `aegir.sqlite`. On first launch after the rename, an existing Agent Desk database is copied into the new location. No connector credentials are committed to this repository.

## Product notes

**Tasks.** Today, Upcoming and With the team are lists of the same tasks; Needs you collects suggestions, work ready for review and blocked work. Tasks are grouped by label. Quick add understands `#label` and date words (`today`, `fri`, `2026-10-02`). Keyboard: `J`/`K` move, `X` done, `H` hand off, `L` label, `D` due, `↵` open, `N` new task, `Y` accept a suggestion, `⌫` dismiss it, and `g` then `t`/`u`/`w`/`n` switches list.

**Handing off.** `H` takes one instruction. The task always goes to the agent team: a lightweight model picks the best group, and the group's lead starts in a new task thread (other agents join when mentioned). Handed-off work only writes files, into `~/Documents/Ägir/<task>` (Codex `workspace-write` sandbox with that folder as its working directory). It receives read-only Slack and Notion tools and cannot post or write to external systems. When the run ends the task moves to Needs you for review; replying in its thread continues the work.

**Groups and threads.** A group is a standing set of agents with an optional purpose; each agent also has a private group for direct chat. Conversation happens in threads, and each run sees only its own thread's transcript plus recalled memory, which keeps context bounded. Mentioning `@Agent` brings that agent in. Chat runs can use Slack and Notion writes, each behind an in-app approval.

**Routines.** Scheduled agent runs (hourly, daily or weekly, optionally weekdays only), listed in the sidebar. Each run is a Codex conversation with read-only connector tools, memory, and `tasks__suggest` for putting items under Needs you. Every step is written to a run log (raw text, kept for 30 days) that you can open from the routine. Tag a routine in chat (`@Hourly discovery`) to discuss it; agents can propose a change or a new routine, which you apply or discard. Approval requests during unattended runs are declined and logged. The seeded "Hourly discovery" routine replaces the old fixed-query reviewer.

Codex runs chat and routines in a read-only sandbox. Commands that need broader permissions pause for an in-app approval. The app does **not** implement a separate policy engine that can classify every possible credential read or app-automation command; do not grant a broad command approval without inspecting it.

Upgrading keeps existing data: rooms become groups, each room's history becomes a closed "Earlier conversation" thread, and goal output becomes a task thread. The old tables stay in the database. No Slack, Notion, or Mnemosyne account was connected during local development, so live OAuth, retrieval and full agent runs need an end-to-end check with your accounts.

The UI is documented in [the design system](docs/design-system.md).
Current follow-up work is tracked in [TODO.md](TODO.md).

## Verification

`pnpm check` runs TypeScript validation. `pnpm test` covers the store migration, hand-off and routine runs against a fake Codex, the read-only tool policy, routine schedules and change validation, quick-add parsing and task lists. `pnpm build` compiles and packages the macOS app.
