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

The only navigation. It has no in-app product lockup; the top inset leaves a clean drag region below the macOS window controls. Sections, in order: **Needs you** (count on a lemon badge), **Tasks** (Today, Upcoming, With the team, Completed), **Groups** (with a + to create one), **Agents** (each agent's private group; the second line shows "Working · <thread>" while it runs), **Routines** (next run, Paused, Running, or Failed), then Memory and Settings icons and connected sources in the footer. The active item uses lime-soft with a 1 px lime inset and `aria-current="page"`. Counts and routine states are text, never colour alone. `J/K` moves focus among sidebar items; `Enter` opens one and `L` enters its content.

### Task list

A dense, keyboard-first list modelled on Godspeed. Rows are one line, 34 px tall: status glyph, title, optional source or attached-link icon, agent avatars plus a one-word state (working, review, blocked), and due date (overdue in amber). Open rows are grouped by label; in Needs you they are grouped by status and show their label inline. Completed tasks have their own list, newest completion first, with Space or the detail action to reopen.

- **Glyphs** (`TaskGlyph`): an empty circle for your open task, a spinning partial lime ring while the team works, a lemon "!" for review or blocked, a spark for a suggestion, and a filled check for done. Each has an accessible label.
- **Cursor and panes**: the selected row uses the lime-soft selection style and scrolls into view. `J/K` or Up/Down moves it. `H` or Left moves into the sidebar; `L` or Right opens the detail pane. The same pane motions work in group and routine lists. Selection is retained per task list.
- **Shortcuts** are listed in the footer bar and must stay in sync with the handler: `Space` completes or reopens, `Enter` edits the selected title, `N` edits notes, `A` hands off, `B` sets a label, `Shift+B` clears it, `D` sets a due date, `Shift+D` clears it, `Cmd+N` creates a task, `Cmd+V` attaches a copied link, `Cmd+Z` undoes the last local task action, `Y` accepts, and Backspace dismisses a suggestion. `G` then `T/U/W/N/C` jumps to a task list. Shortcuts are ignored while typing in a field; text editors retain native undo.
- **Quick add** is one line above open task lists with `Cmd+N` shown; it parses `#label` and date words. The completed list has no quick add field.

### Task popovers

Anchored under the row. The hand-off popover has a title, one instruction field and a footer stating that Atlas routes the work and that results are saved as files; `↵` submits, `⇧↵` adds a line, `Esc` cancels. The label and due popovers are a single field that commits on `↵` or blur; empty input clears the value, while an invalid date stays open with an inline error. Do not add agent pickers or autonomy settings here: hand-off is intentionally one instruction.

### Task detail

The right-hand pane (440 px). Its header is the single editing surface for task title, notes, label and due date, whether or not the task has been handed off. `Enter` on a selected row focuses and selects the title; `Enter` saves and `Escape` cancels title editing. `N` focuses notes. Label and due-date controls include explicit clear actions. Attached links appear beside the task's source link, with a remove button for each; attached links do not replace source provenance. Favor immediate, reversible task actions with `Cmd+Z` undo over confirmation dialogs. Deletion is unavailable while the task is running; one click removes the task and its task thread and messages while leaving external output files alone. Undo restores the removed conversation with its original IDs. The current session retains up to 100 task actions for undo. A handed-off task shows its thread plus Output (opens the folder) and Stop buttons. A task not yet handed off shows Hand off / Mark done actions. Review state adds Mark done beside a hint that replying asks for changes.

### Thread list and thread

A group view lists its threads (title, status chip for task threads, last message snippet, participating agents, count and time) with Active / Tasks / Closed filters and a "Start a thread" field. Private groups show the agent's avatar and "Private · just you and <agent>".

Messages are Slack-style, not bubbles: avatar, name, role chip, time, then text. Failures and streaming are shown in words and a typing indicator. System events are a single muted line with an arrow. Routine changes render as a card listing the before → after values, with Apply / Discard while pending and the outcome afterwards.

### Composer

A two-line textarea that grows with content, with a hint bar and a lime send button that is muted while empty. `↵` sends and `⇧↵` adds a line. Typing `@` opens the mention picker, with routines listed above agents; arrows move, `↵`/`Tab` insert, and `Esc` closes. Stop appears while an agent in the thread is running.

### Routine view

A run list (grouped by day, with All / Failed / Did something filters) beside a monospace run log. The header has Discuss, Run now and Pause/Resume, plus collapsible instructions. Log lines are raw text: time with seconds, kind (run, system, call, result, agent, error), then the text. Colour only reinforces the kind column, and errors are red in both columns. The log is for debugging, so it has no chips or summaries beyond the run header.

## States and accessibility

- Provide visible focus outlines on controls and source links.
- Do not rely on color alone for working, failed, or connected states.
- Preserve readable contrast over glow: opaque or near-opaque surface behind content, with `--ds-color-ink` or `--ds-color-muted` text.
- Long titles truncate in lists but wrap in headers and messages; links wrap anywhere.
- Verify threads both in a group view and in the narrower task detail pane after changing shared thread styles.

## Migration rule

When a new section adopts Lime Glass, compose it from existing Fragments primitives where possible, add section-specific components only for repeated product behavior, and replace legacy hard-coded colors with semantic tokens. Add its usage rules here before broadening the palette or introducing another component variant.

## Skills library

The Skills footer button opens a two-column workspace: a 300 px library list (250 px at compact widths) and a scrolling editor. The library offers Shared, per-agent inherited/owned, Proposed changes, and Archived filters plus text search. Rows use lime-soft selection, wrap long names, and participate in the existing J/K and pane-focus navigation. Empty, loading, and error states are explicit text.

The editor uses Fragments buttons and badges, semantic glass/surface/line tokens, labeled native selectors and a monospace package-file editor. Agent availability and customization are collapsible. New files and package edits stay local until Save revision; a reason accompanies every edit. Conflicting revisions preserve the user's draft and offer Reload latest. History restores create a new revision, and archive exposes Restore immediately. Proposal comparison labels Before and Proposed for each changed file, stacking at compact widths.

Agent settings link to inherited and owned skills. The composer’s + Skill selector inserts a stable explicit reference. Routine headers offer required-skill checkboxes with a clear explanation that disabled dependencies stop execution. These controls retain native keyboard behavior and visible focus; no new animation is introduced.
