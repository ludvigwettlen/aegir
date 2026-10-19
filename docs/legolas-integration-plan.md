# Aegir / Legolas integration decisions

Prepared 16 October 2026; decisions updated 19 October. Implementation status is recorded per feature below.

## Sources and scope

- [PR #1: Legolas fork](https://github.com/ludvigwettlen/aegir/pull/1), inspected at `9398d641b2388e3136caf0a0dac930300b470fc9`.
- Aegir `main` at `6cc49de13251ada8049bc165cfcf8a3e239a557d`.
- [Comparison and Ludvig's comments](https://app.notion.com/p/3fa92fd0e1018168b065d1c7a2fc3787).

The PR has 67 commits and changes 158 files. GitHub reports merge conflicts. It is a source of individual changes to port onto Aegir; the PR description also explicitly says it is not intended as a straight merge. This inspection covered startup, onboarding, provider selection, memory, and parts of draft sending. It is not a full correctness or security review, and the fork's tests have not been run here.

## Confirmed direction

- Use the Aegir repository as the base, as Ludvig specified in Notion.
- Offer both setups during first launch, as specified in this chat and Notion.
- Decide the other overlapping and additional features individually.
- Use a shared Slack/email draft card (Ludvig: “One shared card sounds good,” 16 October).
- Keep Legolas's draft/edit/Send flow with the five-second cancellation window and manual-send option. Ludvig accepted the described flow and requested editable subject and related email fields in his Aegir setup. Detailed field behavior below is the implementation interpretation; footer and reply controls remain open.
- Keep manual priority assignment and its keyboard shortcuts in the app. Background priority triage stays in an external Claude routine.
- Offer both split-panel and fullscreen task details. Preserve Aegir's existing document layout, including its optional resizable Chat pane and typewriter mode; combine both document-navigation approaches.
- Adopt batch passage comments, general attachments and optional browser review. Aegir's built-in review is the default; Malcolm's browser review requires enabling a setting.

## Proposed first-run experience

Begin with “Choose your setup” and two presets:

| | Codex + built-in memory | Claude Code + Obsidian brain |
|---|---|---|
| AI | Codex | The user's Claude Code installation |
| Memory | Mnemosyne | gbrain connected to the selected brain folder |
| Connections | Aegir's existing connection setup, including Composio | The user's Claude Code connections |
| Setup steps | Existing Codex sign-in/install and memory installation | Check Claude access, select brain folder, check gbrain and connections |
| Task intake | Keep Aegir’s in-app discovery and gate | Discovery/triage stays outside the app; optional import only |

The Obsidian option requires Malcolm's gbrain workflow; choosing an arbitrary Obsidian vault does not establish that workflow. Verify that gbrain searches the selected brain as well as writing new memories there. The current adapter passes the folder to file writes but does not pass it to its search commands.

Use one preset question in onboarding. Store engine, memory provider, connector configuration, and intake configuration independently so future customization does not require duplicating the app. Cross-combinations should only be exposed once tested.

Proposed behavior:

- Preserve existing Aegir users' setup. Installing Claude must not switch their engine.
- Persist the explicit choice before provider initialization. Only check or install dependencies for that choice.
- If a selected dependency is unavailable, show what needs fixing; do not silently use the other engine or memory store.
- Make brain import and export explicit options with selected folders. The existence of `~/brain` must not enable them.
- Keep background work paused until setup is complete. “Set up later” keeps manual task management available.
- Keep account settings and memories intact. Switching providers is not memory migration; do not promise automatic transfer.
- Support returning to setup from Settings. Stop active runs before applying provider changes; a restart is acceptable for the initial implementation.

## Code findings that affect the integration

1. Aegir's guided onboarding is newer than the fork. `electron/onboarding.ts`, `shared/onboarding.ts`, and `OnboardingView.tsx` need extending; there is no corresponding onboarding service at the PR head.
2. The fork's `electron/engine.ts` selects Claude automatically when no engine is saved and a binary exists. `main.ts` falls back to Codex when a requested Claude binary is missing.
3. The fork selects gbrain whenever its binary and the brain folder exist unless memory is explicitly set to Mnemosyne. An existing brain folder also enables import/export with default queue paths. These defaults are more automatic than the PR's description of opt-in switches suggests.
4. The Claude startup path pauses existing routines and focuses a single agent. Those are separate product decisions, not necessary consequences of selecting an engine; do not port those migrations automatically.
5. gbrain is not behaviorally identical to Mnemosyne. It searches brain pages and appends memories to an inbox Markdown file; correction/deletion happens outside the app. The memory UI needs provider-specific capabilities and explanations.
6. Draft sending and priority ranking are currently tied to Claude in the fork. A shared feature needs an implementation for each supported setup or a clear capability-based unavailable state.

## Proposed implementation slices

1. **Provider foundation and onboarding.** Port the engine interface, Claude adapter and required supporting code; add a memory-provider interface and gbrain adapter; extend setup and startup configuration. Preserve current Aegir behavior and defaults. Do not import unrelated task or layout changes with the original commits.
2. **Connector and intake support.** Preserve Aegir’s discovery and relevance/duplicate gate. In the Claude setup, discovery and triage stay outside the app; optional import/export connects that external workflow. Do not add a second in-app model gate to it. Keep source identity handling on import. Preserve Gmail/calendar integrations.
3. **Feature slices.** Implement agreed choices below separately, keeping changes reviewable and testing each affected workflow.

Acceptance checks for the foundation: both fresh-install paths; existing Aegir installation with both CLIs present; missing selected dependencies; resumed/skipped setup; no brain-folder side effects without configuration; background jobs remaining paused; correct memory read/write destination; provider-specific memory capabilities. Run applicable unit checks and the onboarding UI smoke test, then verify each provider with an available test account before claiming end-to-end readiness.

## Feature decision queue

Recommendations remain proposals except where the status column and confirmed direction record agreement.

“From” identifies the implementations being considered, not the origin of every proposed improvement. Rows marked “Both” describe what each contributes; new integration behavior remains part of the recommendation.

| Order | Feature | From | Recommendation to discuss | Status |
|---|---|---|---|---|
| 1 | Slack and email drafts | Both — Legolas: shared card, send delay and manual-send state; Aegir: sender/thread context and Composio/Gmail delivery | Shared card, Legolas send flow, editable email subject and recipients in the Aegir setup; delivery through configured connections | Core flow agreed; footer and reply controls pending |
| 2 | Intake and duplicate prevention | Both — Aegir: in-app discovery and relevance/duplicate gate; Legolas: external suggestion imports | Keep Aegir’s in-app discovery and relevance/duplicate gate. In the Claude setup discovery/triage stays outside the app; optional import connects that workflow. | Agreed; preserve Aegir |
| 3 | Priority bands | Legolas | Keep manual priority assignment and keyboard shortcuts in both setups. Background triage stays in an external Claude routine; do not port the in-app triage service. | Implemented locally; no in-app triage |
| 4 | Today, Upcoming, custom lists and labels | Both — Aegir: custom lists; Legolas: date-based Today/Upcoming and label routing | Provide general flexible labelling, filtering and sorting; retain custom lists. Exact label model and saved-view controls need design. | Direction agreed; design pending |
| 5 | Task and document layout | Both — Aegir: document workspace with optional resizable Chat pane, typewriter mode and searchable picker; Legolas: fullscreen tasks and document navigation alongside conversation | Keep split-panel and fullscreen task details. Use Aegir's existing document layout and writing modes. Combine both document-navigation approaches. | Implemented locally; existing Aegir writing modes preserved |
| 6 | Visual styling | Both — Legolas: Glass; Aegir: font and size settings | Merge Legolas Glass with Aegir’s independent app/editor font and text-size controls. | Implemented locally, including native macOS vibrancy and reduced-transparency fallback |
| 7 | Command palette and search | Legolas | Port command palette and full-task search, preserving Aegir’s custom lists and existing shortcuts. | Implemented locally; see validation below |
| 8 | Capture and task convenience | Legolas | Keep AI quick add, snooze, Today button, and staying on the task. Adapt AI quick add to the selected engine. | Agreed; implementation queued |
| 9 | Document collaboration | Both — Aegir: built-in review and passage comments; Legolas: batch sending, general attachments and external browser review | Adopt all three additions. Keep Aegir's built-in review as default; make Malcolm's browser review an opt-in setting. | Implemented locally; external tool execution requires a configured human-review installation |
| 10 | Personal integrations | Legolas | Keep Apple Reminders, external routine display, human-review and brain filing as optional integrations in both setups. Availability depends on installed tools/platform, not the selected engine. | Agreed; implementation queued |
| 11 | Existing Aegir features | Aegir | Keep recurrence, 1:1 preparation, document images, suggestion management and document picker; preserve existing behavior during integration. | Agreed; preserve Aegir |

### First decision: draft experience

Agreed core behavior: a shared editable card for Slack/email with Legolas's five-second send delay and “I sent it myself” state. “Undo” cancels before sending; it cannot retract a delivered message. Retaining Aegir's workspace/sender/thread context remains the integration recommendation.

For the Aegir connection setup, make the subject and email addressing editable alongside the body. Interpret “subject etc” as Subject, To, Cc and Bcc. Recipient changes invalidate the previous destination confirmation and require revalidation before Send; sending uses the latest reviewed subject, recipients and body. Freeze those fields while sending is queued or in progress; Undo returns the card to editing. Extending these fields to the Superhuman adapter is a follow-up implementation recommendation, not a decision to silently overwrite an external draft.

Delivery should remain specific to the configured connection: Composio/direct service APIs for the existing setup, and the Claude connector adapter for that setup. A shared card does not require sending Codex users' messages through Claude.

The fork's locked-run mechanism has useful controls for planned tool order, approved inputs and uncertain outcomes, but needs a focused review and tests before adoption. Preserve explicit user Send, prevent duplicate calls, recheck changed recipients/accounts, and avoid automatic retries after an uncertain outcome. Test cancellation, double clicks, crashes/restarts and connector failures on both delivery paths.

Decide reply-vs-new-message behavior and the footer default separately; neither is settled by choosing the card design and send flow.

## Priority implementation review (item 3)

The fork implements priority as `TaskTriage` in `electron/task-triage.ts`, started by `electron/main.ts`, not as a skill. It invokes an isolated Claude run with a Markdown rubric (the configured `priorityRubric`, or a built-in fallback), task context and recent user overrides. Claude can read the brain; it cannot send messages or modify files in this run. Structured results are validated and persisted as P1/P2/P3 with a reason.

New/changed tasks trigger debounced ranking; the first requested run of a day revisits agent-assigned bands. Keys 1/2/3 set a manual priority and 0 returns it to the agent. Overrides are logged and included in subsequent prompts. The app exports priority events; the weekly evaluation that folds corrections into the rubric is an external workflow described in Notion, not a weekly evaluator implemented by this service. A `learnedThrough` front-matter timestamp avoids repeating corrections already folded into the rubric.

The fork also limits agent allocation to three live P1 slots (manual P1s consume slots) and expires older manual P1 choices when the service enters a new week. Manual P2/P3 do not expire that way. These are behaviors of the fork's triage service, which will not be ported.

Decision, 19 October: keep manual priority assignment and the 1/2/3 shortcuts in the app, available in both setups. Background ranking belongs in an external Claude routine. Do not add the fork's in-app scheduler, model calls, P1 cap or weekly expiry. Implemented adaptation: 0 clears a manual priority instead of handing control to an in-app agent. Any connection between external rankings and app priorities needs an explicit import contract that preserves manual choices.

## Layout comparison (item 5)

| Workflow | Aegir today | Legolas fork | Decision |
|---|---|---|---|
| Task details | Resizable list/detail split with simpler header | Resizable panel plus fullscreen task view | Keep both split-panel and fullscreen task details |
| Writing/reviewing a document | Document workspace with Back to list and an optional resizable Chat pane | Document beside conversation, with focus/typewriter modes | Use Aegir's existing flow; it already supports document-only and side-by-side views |
| Writing modes | Typewriter mode keeps the current line centered | Retains Aegir's focus/typewriter support | Preserve Aegir's writing modes |
| Finding task documents | Three newest documents, searchable View all and document switcher | Documents available alongside the task conversation | Keep both navigation approaches |

Confirmed in `src/ui/views/ThreadView.tsx`: the Chat toggle shows/hides a resizable conversation pane and persists the preference. `src/ui/views/DocumentEditor.tsx` already exposes Typewriter mode in the document toolbar. The earlier comparison understated Aegir's existing capabilities; no replacement document layout is needed.

## Document collaboration review (item 9)

| Addition from Legolas | User flow | Difference from current Aegir | Decision / implementation follow-up |
|---|---|---|---|
| Batch passage comments | Write several comments, inspect them in the Comments tab, then Send N comments or ⇧⌘Enter sends one agent message with each passage/comment | Extends existing Aegir passage comments; the fork removes submitted comments from the file | Adopt batch send. Submitted annotations remain in the document and the conversation records each batch; unchanged submitted comments are excluded from the next batch |
| Attachments | Drop a file in a conversation; keep a task-local copy; optionally file it to the brain | General files alongside current document images and task links | Adopt general attachments; verify supported files and presentation during implementation. Brain filing remains optional |
| Review in browser | Enable the integration in Settings, then explicitly open a task draft in Malcolm's human-review surface for editing/commenting | External alternative to the built-in document editor | Adopt as opt-in in both setups when the required tools are installed. Keep Aegir's built-in review as the default |

Decision, 19 October: adopt all three. Enabling browser review makes that action available; it does not replace the default built-in flow. The app saves before dispatching a browser review request and watches disk changes through the existing editor conflict flow. Live human-review execution and future Claude-provider compatibility still need validation with configured installations. Brain mirroring and commits must not become implicit consequences of enabling browser review.

## Implemented: command palette and search (19 October)

Cmd+K and the sidebar Search button now open the palette. It includes selected-task commands, built-in/custom-list navigation, groups, routine actions, task/list/group creation, settings, skills, memory and meeting preparation. Task search matches title, label, notes, conversation text (including Aegir Slack/email drafts) and Markdown documents. Completed tasks are included; dismissed tasks are excluded. Results select the task in its appropriate list. This slice does not change the layout, task intake, priority system, labels/sorting model or provider setup.

Validation: TypeScript check; 320 unit/integration tests using Electron’s Node runtime to match the installed SQLite native binary; command-palette browser test (wide/compact, deep-search failure, stale responses, focus restoration and editor shortcut); existing task-command browser test. Production renderer/main/preload bundles and a local unsigned macOS package succeeded. Packaging used the installed Electron distribution and `/tmp/aegir-palette-build` because the normal packaging command attempted a network download.

The existing custom-list browser test fails its compact notes-width assertion at `electron/task-lists.test.ts:77`. The same failure was reproduced on a temporary copy of unchanged `main`, with shared dependencies and fonts available; it predates this palette change. No unrelated layout fix was included.

Further item 9 implementation details: attachments are copied, not merely linked, with the fork limiting each file to 50 MB, each message to ten files, and each attachment folder to 200 MB. File parsing depends on the agent and its available tools/skills; equal support on both engines must be verified. Browser review sends an instruction to the agent to start human-review, apply feedback batches, mirror the document into `~/brain/drafts`, and commit changes. That personal path and automatic mirroring/committing must become explicit optional configuration in the merged app. It is an external review workflow, not merely a browser rendering of the in-app editor. Batch comments are removed and the document saved before the message is sent; failures attempt to restore the comments, but concurrent document edits can prevent restoration. A retained submission history would make recovery clearer.


## Implemented: priorities, layouts and collaboration (19 October)

Work is on `codex/legolas-integration`, branched from `main` with the existing palette/search changes preserved.

- Manual P1/P2/P3 assignment is stored in SQLite and supports task Undo, deletion/restore and restarts. Keys 1/2/3 assign; 0 clears. The task header and command palette expose the same controls. No triage service, priority expiry or P1 allocation limit runs in the app.
- F or the task header action opens fullscreen task details; Escape or the exit action restores the list. Aegir's document-only/resizable-Chat layout and typewriter mode remain. Document previews and the searchable picker are retained, with document navigation also available beside the open conversation.
- The document companion has a Comments tab with batch submission and ⇧⌘Enter. Saving must succeed before sending. Failed saves/sends preserve comments. Successful batches remain in conversation history and their annotations stay in the document; local submission receipts prevent unchanged comments being sent twice. Editing a comment queues it again.
- Attach files with the paperclip or drop them into a conversation. Copies stay in the task workspace or a separate folder for that chat. Limits: 50 MB/file, ten files/message, 200 MB/conversation folder. Failed sends retain attachments and message text. Messages retain attachment metadata and agents receive local paths on the initial run and follow-ups. Show in Finder reveals a copy; it does not execute arbitrary files. File interpretation depends on the agent's tools. Brain filing remains a separate, unimplemented optional integration under item 10.
- Settings → Document review enables the optional Review in browser action for task documents. Built-in review remains the default. Browser review saves first, validates the document path and dispatches a request through the active runtime to use an installed human-review tool. It does not implicitly mirror to a brain or make commits. The editor's existing disk-change detection handles external edits.

Validation: TypeScript and production renderer/main/preload build plus a local unsigned macOS package at `/tmp/aegir-integration-build/mac-arm64/Aegir.app`; 324 unit/integration tests; browser checks covering priorities, fullscreen, attachment selection/drop and retry, comment save/send failures, retained history, browser-review opt-in, document navigation, compact layout, and existing document workspace/companion/writing modes. Browser review dispatch is tested with a fixture; a live human-review session has not been exercised. Provider onboarding and the other queued feature slices remain separate work.


## Build-location correction and Glass styling (19 October)

The first integration build was written to `/tmp/aegir-integration-build/mac-arm64/Aegir.app`; the standard `release/mac-arm64/Aegir.app` still contained the 15 October build. Glass styling was also still queued at that point. Both issues were identified after Ludvig reported seeing the old appearance.

Glass now includes the fork's neutral palette, rounded panes, translucent floating surfaces and native macOS under-window material while preserving Aegir typography settings. The corrected build is packaged to the normal `release/mac-arm64/Aegir.app` location. Other integration slices still marked queued above are not included in this visual correction.

Verification for the Glass correction: TypeScript; native-window and app-startup unit tests; browser checks for Glass/reduced transparency, typography persistence and independent sizing, the integration flow, and document navigation. Production renderer/main/preload bundles and the unsigned release-folder macOS package built successfully.
