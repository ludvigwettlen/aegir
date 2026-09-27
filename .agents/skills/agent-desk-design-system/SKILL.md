---
name: agent-desk-design-system
description: Build or refine Agent Desk UI sections using the Lime Glass design direction, reusable components, semantic tokens, and maintained component guidance. Use for design-system or visual-component work in this repo, not unrelated product or backend changes.
---

# Agent Desk design-system work

Evolve the interface section by section. Treat `docs/design-system.md` as the current Lime Glass specification and `src/ui/design-system/tokens.scss` as the source of truth for new design values. Read the relevant existing component and styles before changing a section. `docs/design-style-guide.md` describes legacy styling where migration is incomplete. If the user supplies a new sketch or image, use it for the aspects they identify; do not silently replace the established direction.

## Workflow

1. Identify the requested section, its existing states and interactions, and the closest reusable pieces. Keep unrelated sections unchanged unless the user asks for a broader migration.
2. Define the visual roles needed by the section. Reuse semantic `--ds-*` tokens; add a token when a new color, radius, or effect has a recurring meaning. Do not scatter new literal palette values through component styles. Derived transparency can use `color-mix()` with tokens. Keep ambient blur behind legible content, not on text or icons.
3. Create or edit a component when it represents a repeatable UI pattern or behavior. Prefer composing existing project/Fragments primitives to duplicating their input and interaction logic. Keep one-off, data-dependent layout in its owning view. Avoid speculative variants or broad abstractions.
4. Document each introduced or materially changed component in `docs/design-system.md`: purpose, when to use it, anatomy, meaningful variants and states, token roles, interaction/accessibility rules, and any layout constraints. Record decisions that future contributors need; avoid duplicating implementation details that are obvious from code.
5. Verify the section in every context where the component appears, including compact and full-size layouts when applicable. Check empty, populated, loading, failure, long-content, keyboard-focus, and reduced-motion states where relevant. Run the repo's type check and production build for implementation changes; report any environment limitation rather than claiming a check passed.

## Current conventions

- Shared Fragments adaptations are exported from `src/ui/design-system/primitives.tsx`; import those in product views. Workspace views (sidebar, tasks, groups/threads, routines) live in `src/ui/views/`, styled by `src/ui/workspace.scss`. New section-specific components may go in `src/ui/design-system/`, but do not force every UI element into it.
- The current aesthetic uses an off-white canvas, milky glass surfaces, deep green ink, lime for primary action and selection, and lemon as restrained ambient light. The selected concept is `design/concepts/03-lime-glass.png`; the Paper Tasks sketch linked from `docs/design-system.md` informs the compact layout.
- Preserve existing behavior, source links, status text, and accessible names while changing presentation. Color alone must not convey working, failed, or selected state.
- Token and component documentation should change in the same task as the implementation so the design system remains usable as it grows.
