# Ägir design system

The Lime Glass direction is being introduced one section at a time. The [Paper Tasks sketch](https://app.paper.design/file/01M35BFSHJZGNPY821ZEJG3MQ2/p-1-0/BR-0) defines the compact layout. The third image in `design/concepts/03-lime-glass.png` defines the color and atmosphere. The workspace (sidebar, Tasks, groups and threads, Routines) is fully on Lime Glass; Memory and Settings still use some legacy styles from `light.scss`. The layouts follow the sketch canvas agreed in September 2026.

## Foundations

The source of truth for new semantic values is `src/ui/design-system/tokens.scss`. Use tokens in component styles rather than repeating hex values. Existing blue styles in `light.scss` remain until their sections are migrated.

| Role | Token | Value | Use |
| --- | --- | --- | --- |
| Canvas | `--ds-color-canvas` | `#fcfdf9` | Quiet app ground |
| Surface | `--ds-color-surface` | `#ffffff` | Opaque controls |
| Glass | `--ds-color-glass` | `#ffffffd9` | Panels over ambient color |
| Ink | `--ds-color-ink` | `#1f2b1d` | Primary text and icons |
| Muted | `--ds-color-muted` | `#596753` | Secondary text and timestamps |
| Line | `--ds-color-line` | `#dfe7d8` | Borders and dividers |
| Lime | `--ds-color-lime` | `#a9e929` | Primary action and active state |
| Lime soft | `--ds-color-lime-soft` | `#edf8d2` | User messages and subtle selection |
| Lime ink | `--ds-color-lime-ink` | `#42622c` | Text on pale lime surfaces |
| Lemon | `--ds-color-lemon` | `#ffe95e` | Ambient light and sparing emphasis |
| Link | `--ds-color-link` | `#366d36` | Source links inside chat bubbles |

Use Inter for controls and conversation text; retain Manrope for display headings. The chat uses 13 px body text at 1.6 line-height. The small labels in the compact pane must still be readable at the app's 900 px minimum width.

Ambient color belongs behind the content. Only translucent surfaces receive backdrop blur. Never blur text, icons, or the message content itself. Use a 1 px boundary to keep each glass panel legible when the background glow changes. Motion must respect reduced-motion preferences.

## Shared primitives

`src/ui/design-system/primitives.tsx` adapts the Fragments components already in use. Import these Ägir exports in product views instead of importing the same components directly from `@usefragments/ui`. Their Fragments foundations retain semantics, keyboard behavior, and core sizing; `primitives.scss` applies our tokens and visual states. `ThemeProvider` remains a library integration, not a product component. The chat `Prompt` is adapted through `ChatComposer` below.

### `Button`

Use for actions, not navigation labels or passive status. Its anatomy is a label with an optional leading or trailing icon; icon-only buttons require an accessible name. Default solid/accent is the lime primary action. Use `outline` for secondary actions, `ghost` in dense rows and toolbars, and `link` for tertiary actions. Keep one dominant solid action in an action group. The wrapper retains Fragments' `size`, `icon`, `fullWidth`, disabled, and keyboard behavior. Lime, surface, ink, border, and disabled tokens define its states; hover and focus must remain visible.

### `Badge`

Use for short, non-interactive counts, categories, or status. The label is required; an optional dot reinforces status but never replaces text. `neutral` is ordinary metadata, `info`/`accent` are lime emphasis, `success` and `danger` are outcome states, and `warning` is lemon. `soft` is the default pill; use `outline` only when a filled badge would compete with nearby content. Preserve a readable label at small size and request status announcement only when a live change needs it.

### `Card`

Use to group related content with a clear boundary. `solid` is an opaque elevated surface, `outline` is a milky glass panel, and `soft` is a quiet lime-tinted grouping. The border and radius come from tokens; only glass receives backdrop blur. Use `padding="none"` when the contents own their insets or include an internal divider. Keep headings and interactive elements semantic inside the card; a card is not automatically clickable.

### `ToggleGroup`

Use for a small set of mutually exclusive views or filters. The current workspace switcher is the first use. The group contains labeled items, with the selected item on a soft lime surface; hover and keyboard focus remain distinct. Keep the Fragments single-selection and arrow-key behavior. Do not use it for independent on/off choices or as a substitute for ordinary links.

## Workspace layout

The app is a left sidebar plus one working area; there is no top navigation. Views live in `src/ui/views/` and share `src/ui/workspace.scss`. Two-column views (task list + detail, thread list + thread, run list + log) put the list on the left and keep the list's width fixed so the working column absorbs resizing.

### Sidebar

The workspace navigation. It has no in-app product lockup; the top inset leaves a clean drag region below the macOS window controls. Sections, in order: **Tasks** (Needs you with a lemon count badge, Today, Upcoming, Delegated, Completed), **Groups** (with a + to create one), **Agents** (each agent's private group; the second line shows "Working · <thread>" while it runs), **Routines** (next run, Paused, Running, or Failed). There is no sidebar footer; Settings opens from the Ägir application menu, the menu-bar tray, or `Cmd+,`. The active item uses the pale `--ds-color-nav-selected` fill without a border, semibold text, and `aria-current="page"`. Keyboard focus is a separate thin inset ring using `--ds-color-focus`, contained within the item so adjacent navigation rows never overlap. Counts and routine states are text, never colour alone. `J/K` moves focus among sidebar items; `Enter` opens one and `L` enters its content.

### Task list

A dense, keyboard-first list modelled on Godspeed. Rows are one line, 34 px tall: status glyph, title, optional source or attached-link icon, agent avatars plus a one-word state (working, review, blocked), and due date (overdue in amber). Open rows are grouped by label; in Needs you they are grouped by status and show their label inline. Completed tasks have their own list, newest completion first, with Space or the detail action to reopen.

- **Glyphs** (`TaskGlyph`): an empty circle for your open task, a spinning partial lime ring while the team works, a lemon "!" for review or blocked, a spark for a suggestion, and a filled check for done. Each has an accessible label.
- **Cursor and panes**: the selected row uses the lime-soft selection style and scrolls into view. `J/K` or Up/Down moves it. `H` or Left moves into the sidebar; the highlighted task always appears in the detail pane. Right/L no longer enters task details. N focuses notes; A starts handoff or focuses chat for a handed-off task. Escape returns focus to the highlighted row while keeping the detail pane visible, including from chat, title, and notes; a mention picker or document consumes the first Escape while open. The same pane motions work in group and routine lists. Selection is retained per task list.
- **Shortcuts** appear in the hold-§ overlay and must stay in sync with the handler: `Space` completes or reopens, `Enter` edits the selected title, `N` edits notes, `A` hands off or focuses chat, `Cmd+L` sets a label (`B` remains an alias), `Shift+B` clears it, `D` sets a due date, `Shift+D` clears it, `Cmd+N` creates a task, `Cmd+O` opens the task output folder or, when absent, its attachment, `Cmd+V` attaches a copied URL, app deep link, or local file path, `Cmd+Z` undoes the last local task action, `Y` accepts, and Backspace/Delete dismisses a suggestion or deletes a non-running task with undo. `G` then `T/U/W/N/C` jumps to a task list. Shortcuts are ignored while typing in a field; text editors retain native undo.
- **Quick add** is one line above open task lists without a persistent keyboard hint; it parses `#label` and date words. The completed list has no quick add field. Successful creation clears the field and focuses the selected task row once the updated list arrives; if the new task belongs to another list, focus returns to the current row or empty list pane. Failed creation retains the draft.

### Task popovers

Anchored under the row. The hand-off popover has a title, one instruction field and a footer stating that Atlas routes the work and that results are saved as files; `↵` submits, `⇧↵` adds a line, `Esc` cancels. The label and due popovers are a single field that commits on `↵` or blur; empty input clears the value, while an invalid date stays open with an inline error. Do not add agent pickers or autonomy settings here: hand-off is intentionally one instruction.

### Task detail

The always-visible right-hand pane (440 px) follows the highlighted task and keeps title, notes, status, source links, and conversation together. Label and due-date fields, completion controls, delete/close icons, and the Output button are omitted. Edit labels from the highlighted task with Cmd+L and dates with D; the task list displays both. Cmd+O opens the highlighted task’s output folder when available, otherwise its single attachment. If neither exists it produces a notice.

Enter on a highlighted row edits its title; Enter saves and returns focus to the list. N focuses notes. Escape cancels an in-progress title/notes edit and returns focus to the task list; from chat it returns to the list after dismissing any open mention picker. The sidebar remains visible. N focuses notes; A starts handoff or focuses the existing chat. Right/L on a task no longer moves focus. Unhanded tasks omit the “Your task” header. Space completes/reopens from the list. Backspace/Delete removes a non-running task (or dismisses a suggestion); Cmd+Z restores deleted task data and its conversation. Running tasks retain the Stop action. Hand off remains available for tasks without a conversation. Attached links retain their individual remove actions and source provenance. Each task has at most one attachment; pasting replaces it, and undo restores the previous attachment. A multiline paste keeps the last non-empty line. Existing tasks with multiple attachments retain their newest one. Paste an absolute path, a quoted path, a ~/ path, or a file:// URL onto a highlighted task with Cmd+V to attach a local file. Paths with spaces are encoded correctly and display the filename. Clicking opens the file in its default macOS application; missing files report an error. Local opening is restricted to saved attachments, while ordinary chat links retain the external-link policy.


### Thread list and thread

A group view lists its threads (title, status chip for task threads, last message snippet, participating agents, count and time) with Active / Tasks / Closed filters and a "Start a thread" field. Cmd+N focuses “Start a thread” in the current group or private chat, preserving any existing draft; Enter submits it. Outside chats, Cmd+N still opens task quick-add. When a document hides the thread list, close it with Escape first so unsaved edits can be saved. Private groups show the agent's avatar and "Private · just you and <agent>".

Messages render Markdown headings, emphasis, lists, code, quotes, and GFM tables using `ChatMarkdown`; raw HTML is not executed. External links use the app’s link-opening API. Code blocks and tables scroll within the message, including in the compact task detail pane. Messages are Slack-style, not bubbles: avatar, name, role chip, time, then text. Failures and streaming are shown in words and a typing indicator. System events are a single muted line with an arrow. Routine changes render as a card listing the before → after values, with Apply / Discard while pending and the outcome afterwards.

### Composer

A two-line textarea that grows with content, with a lime send button that is muted while empty. `↵` sends and `⇧↵` adds a line. Typing `@` opens the mention picker, with routines listed above agents; arrows move, `↵`/`Tab` insert, and `Esc` closes. In group/private chats, Escape leaves the message editor and focuses the selected thread in the middle list without clearing the draft; H/Left can then return to the sidebar. An open mention picker consumes the first Escape. Task chats retain Escape-to-task-list behavior, and an open document retains save-and-close priority. Stop appears while an agent in the thread is running.

### Document workspace

`ThreadView` opens local Markdown links and a Files picker in both group conversations and task details. Opening a document collapses the sidebar into an accessible icon rail, hides the thread/task list, and places the conversation beside `DocumentEditor`. While editing, a compact single-row header retains the group and task title; task fields return when the document closes. Files sits beside the document filename while editing and beside the conversation header otherwise, with no separate toolbar row. Closing restores the existing navigation, conversation, and composer without remounting them. The separator supports pointer dragging and arrow-key resizing from 25–55% conversation width. At widths up to 1000 px, Conversation / Document controls switch surfaces.

The document is always formatted and directly editable. There is no source toggle, draft/byline header, or suggestions card. The header contains the filename, save state, and close action. Surface/canvas, ink/muted, and line tokens define the editor; lime-soft highlights text selection and referenced passages. Editing uses native undo, Markdown input shortcuts, and Cmd+B / Cmd+I. Headings, lists, code, quotes, tables, images, and checklists serialize back to Markdown; formatting syntax can normalize on edit. HTML, frontmatter, and footnotes are currently read only to avoid dropping unsupported content.

Selecting text automatically attaches a removable, labeled passage to the composer without moving focus. The next sent message includes the file path and quoted passage. Clearing a selection in the editor or sending the message clears the reference. Unsaved document changes are flushed before sending so the team receives current file contents.

Edits autosave after a short pause, with explicit Saving / Saved / Not saved states. The main process restricts reads and writes to the agent's working folder, rejects symlinks and oversized files, checks a content revision before replacing the file, and writes through a temporary file. Local recovery drafts survive navigation and restarts. External file edits refresh a clean editor; when local changes exist, the editor preserves them and presents Retry save / Reload file. Reload requires an explicit discard action. This is file-based collaboration, not simultaneous live cursor editing.

Esc saves and closes the document, except while a mention picker consumes Escape. A failed save keeps the document open. F6 switches focus between the document and conversation; Cmd+S saves. H/Left from the conversation closes the document, and L/Right enters its pane outside text fields. Hold § to discover the document shortcuts. Icon rail items retain names and tooltips, and the resize separator exposes its current value.

The document pane and editable prose have no focus outline. Buttons, links, and the resize separator retain their visible keyboard focus indicators.

### Routine view

A run list (grouped by day, with All / Failed / Did something filters) beside a monospace run log. The header has Discuss, Run now and Pause/Resume, plus collapsible instructions. Log lines are raw text: time with seconds, kind (run, system, call, result, agent, error), then the text. Colour only reinforces the kind column, and errors are red in both columns. The log is for debugging, so it has no chips or summaries beyond the run header.

## States and accessibility

- Provide visible focus outlines on controls and source links. Workspace navigation uses a 1 px `--ds-color-focus` ring. Focused list/detail containers use an inset ring so all four edges remain inside clipped or scrolling layouts, including empty states; do not frame a pane merely because a child has focus. The document pane retains its outline-free editing treatment.
- Do not rely on color alone for working, failed, or connected states.
- Preserve readable contrast over glow: opaque or near-opaque surface behind content, with `--ds-color-ink` or `--ds-color-muted` text.
- Long titles truncate in lists but wrap in headers and messages; links wrap anywhere.
- Verify threads both in a group view and in the narrower task detail pane after changing shared thread styles.

## Migration rule

When a new section adopts Lime Glass, compose it from existing Fragments primitives where possible, add section-specific components only for repeated product behavior, and replace legacy hard-coded colors with semantic tokens. Add its usage rules here before broadening the palette or introducing another component variant.

## Skills library

Settings → Manage skills opens a two-column workspace: a 300 px library list (250 px at compact widths) and a scrolling editor. The library offers Shared, per-agent inherited/owned, Proposed changes, and Archived filters plus text search. Rows use lime-soft selection, wrap long names, and participate in the existing J/K and pane-focus navigation. Empty, loading, and error states are explicit text.

The editor uses Fragments buttons and badges, semantic glass/surface/line tokens, labeled native selectors and a monospace package-file editor. Agent availability and customization are collapsible. New files and package edits stay local until Save revision; a reason accompanies every edit. Conflicting revisions preserve the user's draft and offer Reload latest. History restores create a new revision, and archive exposes Restore immediately. Proposal comparison labels Before and Proposed for each changed file, stacking at compact widths.

Agent settings link to inherited and owned skills. The composer has no skill dropdown; /-commands for skill discovery and invocation are planned. Routine headers offer required-skill checkboxes with a clear explanation that disabled dependencies stop execution. These controls retain native keyboard behavior and visible focus; no new animation is introduced.

## Settings

Settings uses one content column, capped at 960 px, with actionable sections for Browser, Skills, Startup, Connections, and Agent personalities. Manage skills opens the full library; each agent retains its scoped skills link. Startup preserves the start-at-login toggle with an accessible pressed state. Runtime and output explanations are not separate cards. Use the existing Card and Button primitives, with visible keyboard focus and text for connection states.

The Browser card contains an accessible pressed enable/disable control, a text status with Badge, an explanation of the separate login profile and per-response approval, and Open browser / Stop browser actions. Off, ready, opening, waiting for approval, working, and error states are explicit. Status detail wraps even for long errors and is announced through a status region. Setup actions disable while pending; Stop remains available to cancel opening or active work. Controls wrap at narrow widths, using existing surface, ink, muted and line tokens without animation.

The approval dock displays the complete permission scope and requested action, with wrapped text and a bounded scroll area. Never truncate away the scope of a browser-control grant. Native keyboard focus and Approve / Deny buttons remain available while the details scroll.

## Contextual keyboard hints

Hold `§` to show `ShortcutHints` for the current page or focused editor/dialog; release it to dismiss. Losing window focus or hiding the app also dismisses it. The overlay preserves focus and does not capture Tab navigation. The unmodified section key is reserved for hints even in text fields; literal section symbols can be pasted. No persistent shortcut footer or inline key badges appear in normal content. Native menu accelerators and transient undo notices remain. The overlay uses surface, ink, muted, and line tokens, fits compact windows with internal scrolling, and has no motion.
