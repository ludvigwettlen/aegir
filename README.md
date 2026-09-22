# Agent Desk

Local-first macOS workspace for visible multi-agent conversations, Slack and Notion discovery, durable memory, and assigned goals. This is a new runtime; Hermes was used as product inspiration only.

## Run

Requires macOS, Node 20+, pnpm, and an authenticated `codex` binary (the ChatGPT desktop bundle is detected automatically). Run `pnpm install`, then `pnpm dev`. Build a local `.app` with `pnpm build`; it appears under `release/mac-arm64/Agent Desk.app` on Apple Silicon. `pnpm dist` produces a DMG. The local build is unsigned, so it is intended for development on this Mac, not distribution.

The app keeps its window in the menu bar when closed. Packaged builds register as a background login item on first launch; the toggle is in Settings. Reviews run hourly while the process is running and the Mac is awake, and once after wake or connector reconnection.

## Connections

- Slack: create an **internal** Slack app with MCP enabled. Add `http://127.0.0.1:8765/callback/slack` as its OAuth redirect URL, and enter its Client ID and Client Secret in Settings. The app requests user-token search and history scopes, then opens Slack's OAuth flow. Your workspace admin may need to approve the app. [Slack's setup and scope guide](https://docs.slack.dev/ai/slack-mcp-server/).
- Notion: click Connect in Settings and complete the browser authorization. Available tools are discovered on connection, since Notion capabilities vary by workspace. [Notion MCP guide](https://www.notion.com/help/notion-mcp).
- Mnemosyne: install `mnemosyne-memory` separately so the `mnemosyne` CLI is on `PATH`. The app uses isolated Mnemosyne banks for shared and per-agent memories. Until the CLI is available, memories remain in the local SQLite mirror and are retried on later reviews. [Mnemosyne CLI reference](https://github.com/mnemosyne-oss/mnemosyne/blob/main/docs/api-reference.md).

OAuth tokens and the Slack secret are encrypted with Electron `safeStorage` on macOS. App state is in `Agent Desk`'s Electron user-data directory as `agent-desk.sqlite`. No connector credentials are committed to this repository.

## Product notes

Each room has a lead agent; mentioning another agent brings it into the conversation. The five built-in prompt workflows cover research, Slack review, transcript review, follow-up extraction, and goal execution. Search runs use the same MCP connection as interactive agent turns. Findings are source-linked and deduplicated into Proposed tasks. You can edit, accept, dismiss, or assign them, or type `/goal <task>` in a room.

Codex runs in a read-only sandbox by default. File changes and commands that need broader permissions pause for an in-app approval; external MCP writes also pause. This is deliberately conservative: ordinary local edits may need approval too. The app does **not** yet implement a separate hard policy engine that can classify every possible credential read or app-automation command. Do not grant a broad command approval if you have not inspected it.

Scheduled review is exploratory search, not a complete event feed. Notion title/content search depth depends on the tools and plan exposed by your connection. No Slack, Notion, or Mnemosyne account was connected during local development, so those live OAuth and retrieval flows need an end-to-end check with your accounts.

## Verification

`pnpm check` runs TypeScript validation, `pnpm test` covers search arguments and deduplication, and `pnpm build` compiles and packages the macOS app. The packaged app has been launched locally and verified to render persisted room history.
