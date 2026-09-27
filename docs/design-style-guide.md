# Ägir design style guide

This guide describes the existing desktop UI. The new Lime Glass system is documented in [design-system.md](design-system.md). Chat is the first migrated section; its semantic tokens are in `src/ui/design-system/tokens.scss`. The remaining blue values in `src/ui/light.scss` are legacy until their sections are migrated.

## Direction

- Light mode is the default. Keep surfaces quiet and information dense, with one clear primary action per area.
- Make agent activity legible: who acted, what is running, what needs approval, and where evidence came from.
- Preserve the user's place. A task's thread opens beside the list rather than replacing it; groups keep their thread list visible.
- Use color for meaning and attention, not decoration. A source or status should still be understandable without color.

## Foundations

| Role | Token | Current value |
| --- | --- | --- |
| Canvas | `--color-canvas` | `#f7f8fa` |
| Surface | `--color-surface` | `#ffffff` |
| Subtle surface | `--color-subtle` | `#f9fafb` |
| Primary text | `--color-ink` | `#252d39` |
| Secondary text | `--color-secondary` | `#5f6b79` |
| Muted text | `--color-muted` | `#8993a0` |
| Divider | `--color-line` | `#e4e9ee` |
| Accent | `--color-accent` | `#536b91` |
| Success | `--color-success` | `#4c9787` |
| Danger | `--color-danger` | `#b96464` |

Use the `--space-*` scale (4, 8, 12, 16, 20, 24, 32 px) for new layout work. Controls use `--radius-control` (8 px); panels use `--radius-panel` (12 px). Prefer a 1 px divider to a shadow between working areas. The display face is Manrope; body and controls use DM Sans with system-font fallbacks.

## Layout

- A 244 px sidebar is the only navigation. List-plus-detail views keep the list column fixed (task detail 440 px; thread and run lists 340 px, narrower below 1180 px).
- Main pane: flexible, scrolls independently. Keep content left-aligned; avoid full-width prose.
- Threads have a header, a scrolling message list and a composer fixed to the bottom, in both the group view and the task detail pane.
- At narrow widths, hide the artifact pane before compressing the conversation. Do not hide approvals or source links.

## Components and states

Use Fragments for reusable controls: `Button`, `Badge`, `Card`, `Prompt`, and `ToggleGroup` are in use. Keep domain-specific composition (task rows, agent turns, routine list, source links) in app code. Prefer `Button` solid for the primary action, outline for secondary, ghost for repeated row actions, and link for navigation to evidence. Badges show connection and scan status; pair color with visible words. Cards group supporting information rather than every row. Workspace views use `src/ui/workspace.scss`; legacy tokens for Memory and Settings stay in `src/ui/light.scss`.

Every actionable element needs a readable label and focus state. Empty states should say what will appear and how to start. Loading, disconnected, failure, approval, and done must each be explicit in the UI. Motion should be subtle and respect reduced-motion preferences.

## Change process

When a refined sketch changes a layout, update the relevant token or component rule first, then the affected screen. Avoid adding another near-identical color or spacing value. Check Tasks, Chat, Routines, Memory, and Settings at the desktop minimum width and a wide window before merging to `main`.
