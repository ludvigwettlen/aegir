# Aegir / Legolas integration decisions

Prepared 16 October 2026; decisions updated 19 October; provider foundation implemented 20 October. Implementation status is recorded per feature below.

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

1. **Provider foundation and onboarding — implemented locally, live Legolas validation pending.** Engine and memory routers, Claude/gbrain adapters, explicit setup selection and Settings switching are in place. Existing Aegir users retain their setup. See the 20 October validation and limitations below.
2. **Connector and intake support.** Preserve Aegir’s discovery and relevance/duplicate gate. In the Claude setup, discovery and triage stay outside the app; optional import/export connects that external workflow. Do not add a second in-app model gate to it. Keep source identity handling on import. Preserve Gmail/calendar integrations.
3. **Feature slices.** Implement agreed choices below separately, keeping changes reviewable and testing each affected workflow.

Acceptance checks for the foundation: both fresh-install paths; existing Aegir installation with both CLIs present; missing selected dependencies; resumed/skipped setup; no brain-folder side effects without configuration; background jobs remaining paused; correct memory read/write destination; provider-specific memory capabilities. Run applicable unit checks and the onboarding UI smoke test, then verify each provider with an available test account before claiming end-to-end readiness.

## Feature decision queue

Recommendations remain proposals except where the status column and confirmed direction record agreement.

“From” identifies the implementations being considered, not the origin of every proposed improvement. Rows marked “Both” describe what each contributes; new integration behavior remains part of the recommendation.

| Order | Feature | From | Recommendation to discuss | Status |
|---|---|---|---|---|
| 1 | Slack and email drafts | Both — Legolas: shared card, send delay and manual-send state; Aegir: sender/thread context and Composio/Gmail delivery | Shared card, Legolas send flow, editable email subject and recipients in the Aegir setup; delivery through configured connections | Implemented locally 21 October; live Claude validation and final footer/reply decisions pending |
| 2 | Intake and duplicate prevention | Both — Aegir: in-app discovery and relevance/duplicate gate; Legolas: external suggestion imports | Keep Aegir’s in-app discovery and relevance/duplicate gate. In the Claude setup discovery/triage stays outside the app; optional import connects that workflow. | Implemented locally 21 October; Aegir discovery preserved |
| 3 | Priority bands | Legolas | Keep manual priority assignment and keyboard shortcuts in both setups. Background triage stays in an external Claude routine; do not port the in-app triage service. | Implemented locally; no in-app triage |
| 4 | Today, Upcoming, custom lists and labels | Both — Aegir: custom lists; Legolas: date-based Today/Upcoming and label routing | Provide general flexible labelling, filtering and sorting; retain custom lists. Exact label model and saved-view controls need design. | Multiple labels, All/Any label matching, scoped sidebar filtered views and sorting implemented locally 26 October |
| 5 | Task and document layout | Both — Aegir: document workspace with optional resizable Chat pane, typewriter mode and searchable picker; Legolas: fullscreen tasks and document navigation alongside conversation | Keep split-panel and fullscreen task details. Use Aegir's existing document layout and writing modes. Combine both document-navigation approaches. | Implemented locally; existing Aegir writing modes preserved |
| 6 | Visual styling | Both — Legolas: Glass; Aegir: font and size settings | Merge Legolas Glass with Aegir’s independent app/editor font and text-size controls. | Implemented locally, including native macOS vibrancy and reduced-transparency fallback |
| 7 | Command palette and search | Legolas | Port command palette and full-task search, preserving Aegir’s custom lists and existing shortcuts. | Implemented locally; see validation below |
| 8 | Capture and task convenience | Legolas | Keep AI quick add, snooze, Today button, and staying on the task. Adapt AI quick add to the selected engine. | Snooze/stay-on-task implemented 22 October; selected-engine AI capture and Today deadline action implemented locally 26 October |
| 9 | Document collaboration | Both — Aegir: built-in review and passage comments; Legolas: batch sending, general attachments and external browser review | Adopt all three additions. Keep Aegir's built-in review as default; make Malcolm's browser review an opt-in setting. | Implemented locally; external tool execution requires a configured human-review installation |
| 10 | Personal integrations | Legolas | Keep Apple Reminders, external routine display, human-review and brain filing as optional integrations in both setups. Availability depends on installed tools/platform, not the selected engine. | Brain filing, opt-in Apple Reminders capture and read-only external routine display implemented locally |
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
- Attach files with the paperclip or drop them into a conversation. Copies stay in the task workspace or a separate folder for that chat. Limits: 50 MB/file, ten files/message, 200 MB/conversation folder. Failed sends retain attachments and message text. Messages retain attachment metadata and agents receive local paths on the initial run and follow-ups. Show in Finder reveals a copy; it does not execute arbitrary files. File interpretation depends on the agent's tools. Brain filing was subsequently implemented as an optional per-file action on 21 October (see below).
- Settings → Document review enables the optional Review in browser action for task documents. Built-in review remains the default. Browser review saves first, validates the document path and dispatches a request through the active runtime to use an installed human-review tool. It does not implicitly mirror to a brain or make commits. The editor's existing disk-change detection handles external edits.

Validation: TypeScript and production renderer/main/preload build plus a local unsigned macOS package at `/tmp/aegir-integration-build/mac-arm64/Aegir.app`; 324 unit/integration tests; browser checks covering priorities, fullscreen, attachment selection/drop and retry, comment save/send failures, retained history, browser-review opt-in, document navigation, compact layout, and existing document workspace/companion/writing modes. Browser review dispatch is tested with a fixture; a live human-review session has not been exercised. Provider onboarding and the other queued feature slices remain separate work.


## Build-location correction and Glass styling (19 October)

The first integration build was written to `/tmp/aegir-integration-build/mac-arm64/Aegir.app`; the standard `release/mac-arm64/Aegir.app` still contained the 15 October build. Glass styling was also still queued at that point. Both issues were identified after Ludvig reported seeing the old appearance.

Glass now includes the fork's neutral palette, rounded panes, translucent floating surfaces and native macOS under-window material while preserving Aegir typography settings. The corrected build is packaged to the normal `release/mac-arm64/Aegir.app` location. Other integration slices still marked queued above are not included in this visual correction.

Verification for the Glass correction: TypeScript; native-window and app-startup unit tests; browser checks for Glass/reduced transparency, typography persistence and independent sizing, the integration flow, and document navigation. Production renderer/main/preload bundles and the unsigned release-folder macOS package built successfully.

## Implemented: provider foundation and setup switching (20 October)

- Fresh workspaces choose Aegir (Codex/Mnemosyne/Aegir connections/built-in discovery) or Legolas (Claude/gbrain/Claude connections/external discovery) before checking providers. The paired selections are stored as separate fields in one setup record, with a migration marker. Cross-combinations are not exposed. Existing installations migrate to an explicit Aegir selection; installing Claude does not change it. A deferred fresh choice stays unselected on relaunch.
- Settings → Getting started → Review setup → Choose your setup supports switching. The app rejects changes during active agents, approvals, memory operations and tracked background work. Selection is persisted before the adapters change; scheduled work pauses until both chosen dependencies pass and setup is finished. Account credentials, tasks, conversations, enabled routine settings and old memory stores remain intact.
- Claude uses the installed executable/account with the pinned Agent SDK, streaming, app tools, cancellation and approvals. User connections are loaded without loading task-local settings. Quick classification/routing has no tools or connections. Normal runs enforce file-write boundaries, deny conventional send tools, require approval for chat changes/shell commands and deny unapproved operations in unattended work. Existing app tool handlers remain authoritative for internal operations. Claude connection delivery for draft cards is not part of this slice.
- gbrain validates its registered brain/source folder before every search/write. Search commands specify brain and source; new memories append to the selected folder's `inbox/aegir-memories.md`. Missing or mismatched configuration reports an error instead of falling back. There is no automatic import, export, memory migration or indexing. Users edit/delete pages in Obsidian and use their existing workflow to index/file the inbox. Agent scope tags are labels within the shared brain, not private banks.
- Built-in discovery is inactive under Legolas, without changing saved routine enablement. Other routines and the separate Aegir Gmail/Calendar integrations remain configured. Memory and Settings show the selected provider's capabilities and model labels.

Validation: 347 unit/integration tests passed using Electron's Node runtime; TypeScript and the production macOS package passed. The onboarding browser walkthrough covers both setup paths, compact layout, mapping errors/recovery, rejected active-work switching, switching back, and provider-specific memory controls. A read-only smoke check successfully imported the Claude SDK from the packaged app. The package is at `release/mac-arm64/Aegir.app`.

Live limitations: gbrain is not installed/configured on this Mac, and the sandboxed Claude account-status check timed out. No live Claude model or gbrain end-to-end run is claimed. Setup reports those missing prerequisites and preserves the selected provider. Shared delayed-send cards and Claude draft delivery were subsequently implemented locally on 21 October (see below). Optional brain intake/export and filing were subsequently implemented locally on 21 October (see below). Apple Reminders, external routine display, AI capture/Today and broader labels/saved views remain later slices; snooze and staying on task were subsequently implemented on 22 October (see below).

## Shared draft cards and Claude delivery (21 October)

Implemented locally: shared card shell and action footer; a persisted five-second main-process countdown with Undo; “I sent it myself” as a distinct terminal state that makes no delivery call. Edits are saved before either action. Fields freeze while queued/sending. Queue cancellation survives navigation; shutdown cancels queued work and restart recovery returns queued drafts to editing. Sending already in progress remains uncertain after interruption. Provider switching is blocked during queued sends and delivery work.

Aegir Gmail/Slack keep their existing verified delivery services behind the countdown. Claude setup exposes local `messages__draft`/`messages__update_draft` tools and routes card operations through a separate Claude delivery service. It supports the fork’s native Claude Slack and Superhuman Mail tool names, not arbitrary connectors. Destination/thread reads precede Slack delivery. Superhuman requires an existing external draft, explicit account and draft kind: the card verifies recipients/subject, captures the external fields, refuses external changes, updates with the reviewed fields, verifies again, then sends. Plain text is HTML-escaped for Superhuman. No automatic fallback to Composio exists. Normal Claude runs still cannot call send tools.

The dedicated delivery run loads user connections with no task/project settings or general file/shell tools. Application code supplies the tool names, order and inputs through hooks; extra/repeated calls are refused. Connector responses, not the model’s final text, determine delivery. Once a send call has been released, missing confirmation becomes uncertain and never retries automatically. Live native connector execution remains unvalidated on this Mac; unsupported response shapes fail closed. The existing Slack footer choice/default and channel-specific reply behavior are retained pending further product decisions.

Validation for this slice: TypeScript; the full unit/integration suite (365 tests at the first full run, plus three subsequently added delivery/response-error regression checks); email and Slack browser walkthroughs in wide/compact layouts, including queued editing locks, Undo, saved edits and manual completion; visual inspection of both compact cards. Dedicated Claude SDK fixtures verify planned inputs, tool order, duplicate prevention and uncertain connection failures. Real Claude Slack/Superhuman delivery has not been exercised.

Production renderer/main/preload bundles and the updated local unsigned macOS app at `release/mac-arm64/Aegir.app` built successfully. Packaging required network access to fetch its build dependencies; no messages were sent during validation.

## External intake, task export and optional brain filing (21 October)

Implemented locally: Settings exposes independent opt-in switches and explicit existing-folder selection for task intake, task export and filing. Legolas enables the task bridge; Aegir retains built-in discovery and pauses the bridge without resetting its saved switches. Per-file filing is available in both setups. Nothing infers folders from `~/brain` or enables an integration by selecting a memory provider.

External JSON/Markdown suggestions use the contract in README. Valid files import atomically as proposed tasks under Needs you, without model calls. Stable source keys retain their identity and are checked against existing tasks and durable import receipts; completion, dismissal, deletion and restarts do not recreate imported requests. Re-importing leaves existing fields and manual priorities intact. Priority updates, source closes and task edits require a separate future contract and are rejected here. Inputs are bounded, stable for two seconds, validated before mutation, and archived into processed/rejected subfolders with surfaced errors. Folder swaps and symbolic-link inputs/targets are rejected.

Export produces atomic JSON/Markdown task snapshots, including status, notes, source links and local output-workspace paths for result inspection. Both directions run through the existing minute tick only after setup completion; Settings also provides Check now. Settings reports counts, deferred files, errors and last check.

File to brain copies a saved document or already-sent attachment on an explicit click. It verifies the workspace/attachment source, requires filing opt-in, uses exclusive uniquely named copies and preserves the originals. It copies only the selected file, not document image/link dependencies, and does not trigger indexing, mirroring, model work or commits. Live gbrain validation remains separate.

Validation: TypeScript; full unit/integration suite (377 checks, plus the subsequent missing-folder configuration regression); 10 focused bridge checks using real SQLite and temporary intake/export/filing folders; browser walkthroughs for explicit folder opt-in, Settings errors/recovery, setup-dependent controls, compact layout, successful document copies and failed-save protection in personal/delegated workspaces. Both Settings and compact document actions were visually inspected. The existing document-creation walkthrough passed. The broader priorities/fullscreen/attachments/comment/review integration walkthrough also passed when run on its own; an earlier concurrent browser run had timed out during fixture startup. No real user's routine folders or brain were enabled or modified.

The production renderer/main/preload bundles and updated local unsigned macOS app at `release/mac-arm64/Aegir.app` built successfully with this slice.

## Snooze and stay on task (22 October)

Implemented locally in both setups: independent `snoozedUntil` calendar date, persisted in SQLite with undo/delete-restore support; future-date validation; Tomorrow, Next week, custom date and Unsnooze controls; S shortcut and palette action. Snoozing ready/review/blocked tasks preserves deadline, priority and repeat schedule. Hidden tasks remain accessible in Upcoming with their snooze date, rejoining normal lists on that local date. View counts refresh across midnight and app focus without changing task records.

Non-completed tasks remain open after edits move them out of the current view, with their detail/document/chat component retained and an explanatory Back to list action. Changing views/selection or explicitly leaving releases the retained task; completing, dismissing or deleting follows ordinary list selection behavior.

The fork’s Today quick-date action sets `dueAt` to today; it has no separate planning flag. Its snooze picker also sets `dueAt`. Our independent snooze follows the previously described deadline-preserving behavior. A Today planning flag/button and AI quick add have not been implemented in this slice, pending the Today decision and explicit AI capture work.

Validation: TypeScript; 379 unit/integration tests passed, with a further passing search-navigation regression for snoozed custom-list/review tasks. Snooze persistence, undo/delete-restore, deadline/priority preservation, date validation and return-date visibility use real SQLite tests. Browser checks passed for snooze/unsnooze, retained details after scheduling and custom-list moves, editing retained tasks, explicit release, compact layout, Mark reviewed, and existing task keyboard/skill workflows. The keyboard fixture was updated to expand the existing collapsed Notes disclosure and ignore generated release files during browser tests. Dialog and compact retained-detail screenshots were visually checked. Search opens snoozed tasks in Upcoming, including those assigned to custom lists.

Production renderer/main/preload bundles and the updated local unsigned macOS app at `release/mac-arm64/Aegir.app` built successfully with snooze, retained task details and snoozed-task search routing.

## Remaining feature implementation (26 October)

Implemented locally in this pass: selected-engine AI capture with review-before-create and preserved original note; Today deadline setting with persistence/undo and snooze clearing; combined label/status/priority filtering and sorting with per-list named saved presets; opt-in Apple Reminders capture with a bundled EventKit helper; read-only external Claude schedule/run display in Settings. Existing single freely editable labels and custom lists are retained. Multi-label tasks and a dedicated sidebar for saved views are not added. Confirmed by Ludvig on 26 October: Today sets the deadline to today; preserve the existing Slack footer default and reply behavior.

Reminders capture is engine-independent, off by default and paused until setup is complete. It retains alert/reopened-reminder behavior from the fork, keeps a durable ledger without its old 5,000-entry eviction, rejects ambiguous list names, avoids adding imported links to Undo, and stops mutation during shutdown. External schedule loading is explicit, read-only and tolerant of missing/unsupported files; cached run identity includes its full directory.

Live prerequisite check on 26 October: Claude Code 2.1.92 is installed, but `claude auth status` reports signed out. gbrain is not on PATH. No live model, brain search/write, Slack or email send has been performed or claimed. Those end-to-end checks remain blocked on configured tools/accounts.

Validation for this pass: full unit/integration run passed 406 checks (30 opt-in checks skipped); a subsequent focused run passed 20 checks, including the added PhoneCapture opt-in/pause/shutdown check and native helper invalid-input check. TypeScript passed. Browser walkthroughs passed for existing snooze/retained details and the new AI preview/create, label filtering, named view/reset, the initial planning implementation, optional Reminders settings/check and external routine display. Compact task controls and integration Settings screenshots were visually inspected. Production renderer/main/preload and the unsigned macOS app built successfully; bundled helper and Reminders usage description were verified in `release/mac-arm64/Aegir.app`. A read-only helper status reports OS permission not yet requested. No real Reminders list was imported or completed during validation.

### Confirmed Today and Slack behavior

Ludvig's follow-up confirmed that Today should set `dueAt` to the current local date. The initial independent planning field has been removed from the implementation. The task toolbar’s Today action and palette’s Set deadline to today clear snooze and update the deadline, using the existing recurrence-anchor and Undo behavior. Slack footer defaults and reply behavior remain as currently implemented, as explicitly requested. Validation: TypeScript, 30 focused task/date/search/recurrence checks and the updated browser walkthrough passed.


## Multiple labels and sidebar filtered views (26 October)

Implemented after Ludvig requested the expanded label/view model: multiple labels per task, comma/checkbox editor, multiple quick-add hashtags, secondary-label search, label-aware recurrence/Undo/intake/export and AI capture. The legacy label field remains the first label for compatible tools; existing tasks migrate to the labels array. Legacy single-label updates replace the first label while retaining additional labels; clearing the legacy label clears all.

Filtered views persist in the app database and appear in the sidebar and command palette. They save their name, base scope, All/Any label matching, status/priority filters and sort. Users can create, rename/update, copy and delete views without moving tasks. All-open scope spans custom lists and includes suggestions/snoozed tasks; Completed is explicit. Old browser-local presets migrate with deterministic IDs and retain originals on failure. Unsaved filter changes are discarded when a saved view is selected again. Earlier single-label/preset-only limitations in this document are superseded by this implementation.

Validation: full unit/integration suite passed 414 checks (31 opt-in browser checks skipped). After extending explicit multi-label capture to Reminders, 97 focused runtime/Reminders/capture checks passed. Browser checks passed for multi-label edits and failure recovery, All/Any matching across lists, sidebar view creation/update/rename/copy/delete, reload persistence, old-preset migration without re-import after deletion, compact/reduced-motion layout, priority preferences and saved-view re-selection. Existing snooze/task-retention checks passed. Search navigation revealed a focus bug where a combined selector chose the first row ahead of the selected row; navigation now explicitly prefers the selected row, and the completed-task search walkthrough passes. TypeScript and the production macOS build passed; screenshots of wide label editing and compact filtered views were inspected. No live accounts or external messages were used.

## Safety fixes and runtime upgrade (27 October)

The remaining four P1 fixes from the fork are now adapted locally:

- Codex approval cards show the command/folder, file changes or permission paths and access, network scope, and grant duration. Permission requests also retain the complete requested profile on the card.
- Every tracked runtime run has a cancellation signal. Stop, completion, errors, replacement and shutdown expire pending connector-write approvals. Dispatch rejects missing or replaced runs and checks cancellation immediately before calling the connector.
- New and resumed Codex threads disable configured host MCP servers, apps, plugins and hooks. The app checks the thread's effective inventory before starting a turn and refuses active servers, unreadable inventories or truncated pagination. A live isolated probe with the installed Codex binary confirmed a synthetic inherited server was disabled and had no tools.
- Electron is upgraded to 44.9.3 with SQLite 13.0.3. Removed login-item fields are replaced with the supported login-launch flag, preserving hidden login startup. Connector SDK, validation and build/test packages are patched; scoped overrides update the two remaining transitive build dependencies. The registry audit reports zero known advisories. Tests now use Electron's runtime to avoid native SQLite ABI mismatches after packaging. The app requires macOS 13 or later.

Validation: TypeScript; 435 automated checks passed, with 31 opt-in checks skipped in that run; four browser walkthroughs passed separately (onboarding, Legolas integration, production document editor and UI feedback); production renderer/main/preload and the unsigned macOS package built successfully. An isolated launch of the built main/renderer on Electron 44.9.3 opened onboarding with a temporary database and no page errors. The bundled Reminders helper and macOS minimum version were checked.

Live prerequisites: a fresh account-status check confirms Claude is signed out; gbrain is not installed. Live Claude model/brain read-write, connector sends and configured external browser review remain unverified. No external messages were sent during this validation. Existing Slack footer/reply behavior remains as requested. Earlier mentions of unresolved footer/reply decisions are superseded by the confirmed behavior above.
