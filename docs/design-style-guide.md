# Agent Desk design style guide

This is the working guide for the desktop UI, not a finished brand system. Refined sketches should update it as the product takes shape. The current source of truth for values is the token block at the top of `src/ui/light.scss`.

## Direction

- Light mode is the default. Keep surfaces quiet and information dense, with one clear primary action per area.
- Make agent activity legible: who acted, what is running, what needs approval, and where evidence came from.
- Preserve the user's place. Tasks and Routines keep a context chat visible; Chat gives rooms and sources more room.
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

- Header: 67 px, persistent Tasks / Chat / Routines navigation and utility actions.
- Left rail: `--rail-width` (184 px; 155 px below 1250 px), for local navigation and source context.
- Main pane: flexible, scrolls independently. Keep content left-aligned; avoid full-width prose.
- Context chat: capped by `--context-width` (520 px), while the dedicated Chat view has a wider conversation and a source/artifact pane when space allows.
- At narrow widths, hide the artifact pane before compressing the conversation. Do not hide approvals or source links.

## Components and states

Use Fragments for reusable controls: `Button`, `Badge`, `Card`, and `Prompt` are in use. Keep domain-specific composition (task rows, agent turns, routine list, source links) in app code. Prefer `Button` solid for the primary action, outline for secondary, ghost for repeated row actions, and link for navigation to evidence. Badges show connection and scan status; pair color with visible words. Cards group supporting information rather than every row.

Every actionable element needs a readable label and focus state. Empty states should say what will appear and how to start. Loading, disconnected, failure, approval, and done must each be explicit in the UI. Motion should be subtle and respect reduced-motion preferences.

## Change process

When a refined sketch changes a layout, update the relevant token or component rule first, then the affected screen. Avoid adding another near-identical color or spacing value. Check Tasks, Chat, Routines, Memory, and Settings at the desktop minimum width and a wide window before merging to `main`.
