# Agent Desk design system

The Lime Glass direction is being introduced one section at a time. The [Paper Tasks sketch](https://app.paper.design/file/01M35BFSHJZGNPY821ZEJG3MQ2/p-1-0/BR-0) defines the compact layout. The third image in `design/concepts/03-lime-glass.png` defines the color and atmosphere. Chat and Tasks are migrated; shared Fragments primitives carry the same styling across the app.

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

`src/ui/design-system/primitives.tsx` adapts the Fragments components already in use. Import these Agent Desk exports in product views instead of importing the same components directly from `@usefragments/ui`. Their Fragments foundations retain semantics, keyboard behavior, and core sizing; `primitives.scss` applies our tokens and visual states. `ThemeProvider` remains a library integration, not a product component. The chat `Prompt` is adapted through `ChatComposer` below.

### `Button`

Use for actions, not navigation labels or passive status. Its anatomy is a label with an optional leading or trailing icon; icon-only buttons require an accessible name. Default solid/accent is the lime primary action. Use `outline` for secondary actions, `ghost` in dense rows and toolbars, and `link` for tertiary actions. Keep one dominant solid action in an action group. The wrapper retains Fragments' `size`, `icon`, `fullWidth`, disabled, and keyboard behavior. Lime, surface, ink, border, and disabled tokens define its states; hover and focus must remain visible.

### `Badge`

Use for short, non-interactive counts, categories, or status. The label is required; an optional dot reinforces status but never replaces text. `neutral` is ordinary metadata, `info`/`accent` are lime emphasis, `success` and `danger` are outcome states, and `warning` is lemon. `soft` is the default pill; use `outline` only when a filled badge would compete with nearby content. Preserve a readable label at small size and request status announcement only when a live change needs it.

### `Card`

Use to group related content with a clear boundary. `solid` is an opaque elevated surface, `outline` is a milky glass panel, and `soft` is a quiet lime-tinted grouping. The border and radius come from tokens; only glass receives backdrop blur. Use `padding="none"` when the contents own their insets or include an internal divider. Keep headings and interactive elements semantic inside the card; a card is not automatically clickable.

### `ToggleGroup`

Use for a small set of mutually exclusive views or filters. The current workspace switcher is the first use. The group contains labeled items, with the selected item on a soft lime surface; hover and keyboard focus remain distinct. Keep the Fragments single-selection and arrow-key behavior. Do not use it for independent on/off choices or as a substitute for ordinary links.

## Tasks components

The repeatable pieces are in `src/ui/design-system/tasks.tsx`, styled by `tasks.scss`. `TasksView` and `TaskRow` in `App.tsx` own task data and API actions; their layout and state styling follow the same rules.

### `TaskListNav`

Use for switching between Inbox, Upcoming, and Completed within Tasks. Each item has an icon, label, and optional count. The active list uses a soft lime background, dark green text, and `aria-current`; hover is a distinct lemon-soft state. Preserve the three-list meaning and avoid using color alone to identify the selected item.

### `TaskQuickAdd`

Use above task lists for fast creation. It is a single-line form with a leading plus glyph, labeled text input, and trailing submit control. Enter and the button perform the same action; empty input disables submission. Keep the milky surface and visible lime focus boundary. Do not turn the plus glyph into a second action.

### `TaskStatus`

Use at the start of each task row as a compact state cue. Proposed and blocked use lemon-soft, ready uses lime-soft, running uses active lime with a spinner, and done uses success green. The accessible label states the status in words. For running and blocked tasks, also show a visible text badge near the title; never make status depend solely on the indicator's color.

### Task row

Use one glass card per task with title, optional notes, creation date, optional source and goal detail, and actions matched to its state. `Edit` is secondary; `Accept`, `Start goal`, and `Save changes` are primary. Source is a link-style action that retains the external URL behavior. While editing, show only the editor's Save and Cancel actions—not the row's normal actions. Let actions wrap below content when the Tasks pane is narrow; do not truncate titles or notes to preserve the source context.

### `TaskEmptyState`

Use when the selected task list has no entries. The icon, title, and guidance change with the list; the layout stays centered and restrained. Keep the quick-add form available above it so the state still offers a clear next action.

## Chat components

The reusable React components live in `src/ui/design-system/chat.tsx`; their styles live in `src/ui/design-system/chat.scss`.

### `ChatConversation`

Use Fragments `ConversationList` as the scrolling layer in both the compact context chat and dedicated Chat view. Its smart auto-scroll follows new or streaming content only while the reader is near the bottom; scrolling up to read earlier messages must not be interrupted. Remount the list when the room changes so each room opens at its latest message. The component accepts our custom empty states and bubbles as children; its internal content spacing is overridden with Lime Glass chat spacing. Do not add a second manual scroll effect to `ChatView`.

### `ChatBubble`

- `variant="user"` aligns right on a soft lime surface. It has no avatar because placement identifies the speaker.
- `variant="agent"` aligns left with an avatar, author, and optional role. The bubble uses a milky glass surface.
- Keep message text in the bubble and timestamps below it. Streaming and failure are visible words as well as colors.
- Pass rendered content as children so source links retain their normal interactive behavior.
- Maximum bubble width is 76% of the conversation, rising to 84% at narrow widths. Do not stretch short turns across the pane.

### `ChatEvent`

Use for system handoffs, such as an agent joining or work being delegated. Keep it outside the bubble rhythm and include plain-language text.

### `ChatComposer`

Use the Fragments `Prompt` primitive for input, keyboard submission, loading, and the send control. The wrapper supplies the Lime Glass surface, hint text, stop action, and compact/full pane behavior. The send button has a lime focus/hover state; disabled is visibly muted. Keep the composer anchored below the scrolling conversation.

### Room header and empty state

The room picker and agent settings remain in `ChatView` because they depend on room data. Their styling uses the same tokens as the bubbles and composer. The compact empty state uses a single lime orb; the dedicated Chat screen retains a descriptive empty state and suggested prompts.

## States and accessibility

- Provide visible focus outlines on controls and source links.
- Do not rely on color alone for working, failed, or connected states.
- Preserve readable contrast over glow: opaque or near-opaque surface behind content, with `--ds-color-ink` or `--ds-color-muted` text.
- Message alignment must survive long text, links, and the 355 px context pane.
- Verify both the compact context chat and dedicated Chat view after changing a shared component.

## Migration rule

When a new section adopts Lime Glass, compose it from existing Fragments primitives where possible, add section-specific components only for repeated product behavior, and replace legacy hard-coded colors with semantic tokens. Add its usage rules here before broadening the palette or introducing another component variant.
