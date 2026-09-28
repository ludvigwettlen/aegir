# Skills architecture proposal

Status: first release implemented on 2026-09-28. The ownership defaults below were accepted. Script execution, remote catalogs, and background curation remain later work.

## Direction

Use portable file-based skill packages, a shared library, and an additional library owned by each agent. Discover through short descriptions and load instructions and supporting files on demand. Keep agent identity, procedural skills, factual memory, and executable tools separate.

## What to borrow from Hermes

Hermes uses `SKILL.md` packages, optional supporting files, progressive disclosure through `skills_list` and `skill_view`, explicit slash-command invocation, and agent authoring through `skill_manage`. It supports local and external directories with deterministic precedence. External directories are mutable when filesystem permissions allow it. See the [Hermes skills documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/).

Hermes also has a curator for agent-created skills: usage tracking, reversible archival, pinning, and optional consolidation. See the [curator documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/curator/).

For Ägir, adopt package portability, selective loading, explicit invocation, and learning from completed work. Add ownership and concurrency rules designed for multiple agents sharing one app. Initially use explicit import rather than a live writable connection to another application's skill directory. Defer automatic consolidation until usage data shows it is useful.

## Storage and identity

Managed layout beneath Electron's existing user-data directory:

```text
skills/
  shared/<skill-id>/
    SKILL.md
    references/
    scripts/
    assets/
  agents/<agent-id>/<skill-id>/
    SKILL.md
    references/
  .staging/<skill-id>/...
  .archive/<skill-id>/...
```

Folders are the source of truth for package contents. SQLite holds stable IDs, ownership, enablement, source provenance, immutable whole-package revision snapshots, pending change packages, publication journals, and use events. Keeping revision snapshots and pending packages in SQLite makes recovery independent of partially written working folders. The current live package on disk remains the content source of truth. Folders discovered directly on disk retain their original directory names while receiving a stable internal ID. The index is reconciled with disk at startup and before a run; direct file edits create a recorded revision rather than silently bypassing history. Invalid packages remain visible in the UI with an error but do not enter the agent catalog.

Use standard `name` and `description` frontmatter, with optional Ägir-specific metadata under `metadata.aegir`. Preserve unknown metadata on import/export. Bundle the full package on export; keep runtime usage history out of exported instructions. Stable skill IDs survive display-name changes and archive/restore. Imported copies get new local IDs and record the import source. Export preserves the full package and existing upstream metadata; Ägir ownership, usage, and local revision history are not exported.

Initial bundled skills are copied into the shared library once. Updates must not overwrite user changes; offer an upstream diff. Convert the four active hardcoded workflows in `electron/skills.ts` into these packages. Keep mandatory execution and permission rules in runtime instructions, not optional skills; remove or absorb the unused goal workflow accordingly.

## Shared versus agent-specific

| Scope | Visibility | Default editing behavior |
| --- | --- | --- |
| Shared | All agents, subject to per-agent enablement | User edits directly; agents submit a proposed revision |
| Agent-owned | Owning agent and user | Agent can create/refine its own skills with recorded, reversible revisions |
| Imported | Chosen shared or agent-owned scope | Preserve origin; agent changes start as proposals unless user enables maintenance |

Shared skills are inherited by default. Each agent can disable an inherited skill without copying it. Shared skills can also be enabled for only selected agents, allowing two specialists to use one maintained package. Ownership and availability are separate concepts.

Use stable IDs for bindings and qualified references such as `shared/meeting-review` and `agent/<id>/meeting-review`. Do not silently shadow same-named shared skills. An explicit customization records `extendsSkillId`; when both would be selected, use the customization and show its relationship to the shared original. Initially customizations are complete package copies, avoiding an implicit inheritance/merge language. Show when the original changes; merging is explicit.

Promotion copies an agent skill into shared scope with provenance and history; it does not broaden the original's visibility silently. Only the promoted copy becomes shared. Check for agent-specific context before proposing promotion.

Agent scope controls app catalog access, not OS-level confidentiality. Filesystem isolation would require additional sandbox work; do not describe agent-owned packages as a security boundary.

## Discovery and execution

Build one `SkillRegistry` and one run-context builder used by chat, task, and routine execution. At each run:

1. Resolve enabled shared skills, agent-owned skills, explicit customizations, and pinned bindings for this agent and run type.
2. Check declared requirements against actual available tools, connectors, and platform. Show declared requirements and invalid-package errors in the UI. Runtime discovery includes the precise reason when a requirement cannot be satisfied. An explicitly requested unavailable skill produces a clear explanation.
3. Snapshot eligible package revisions for the run. Include only names, short descriptions, IDs, and availability information in the initial catalog.
4. Expose `skills__list`, `skills__search`, and `skills__read` for discovery, full instructions, and specific supporting files. For a small library include the full short catalog; add bounded search/pagination as it grows.
5. Explicitly selected or pinned skills load before execution. Otherwise the agent selects relevant skills by description and reads them before applying them. Replace keyword injection.
6. Record loaded skill IDs and revisions in the run log. Loading alone is not proof of successful use; keep outcome feedback separate from load counts.

Explicit skill selection in the composer inserts a stable `$skill:<id>` reference; routine bindings also store IDs. Name-based slash commands are deferred, avoiding ambiguity across scopes. Routine pins are required dependencies: fail clearly if disabled or missing rather than silently skipping them. Pins follow the latest active revision between runs; reproducible fixed-version pins can follow later.

Shared code must give routines the same discovery and loading path as other runs. A resumed conversation needs a fresh run catalog; it must not rely on stale thread-start instructions. Preserve the revision snapshot throughout one run, including supporting files, even if another agent edits a package concurrently.

Skill instructions do not grant tools or permissions. A Slack-writing skill cannot make a read-only task or routine write to Slack. Supporting scripts use the existing execution tools and sandbox only; loading a package does not execute it. Resolve supporting paths inside the package, reject traversal and symlink escapes, and enforce size limits. Initial release can load text references and expose assets; defer general script staging/execution until the working-directory and dependency contract is implemented.

## Learning and changes

Give agents scoped `skills__create` and `skills__propose_change` operations; allow direct owner updates through `skills__update` where the maintenance policy permits. Derive agent identity and allowed scope from the active run, never from a caller-supplied agent ID. Mutation tools remain classified as writes even when a policy permits automatic local changes.

After substantive work, ask the agent to consider whether a verified, reusable procedure was learned. Prefer improving a relevant existing skill over creating a narrow duplicate. Save task-specific facts to memory and procedural knowledge to skills. A failed attempt can justify documenting a pitfall, but not claiming an untested remedy works. Skip reflection for trivial turns and routine runs with no new learning.

Implemented policy: automatically save changes to agent-created, agent-owned skills; propose changes to shared, imported, or user-authored skills. User pinning prevents autonomous editing and archival. Unattended runs can save proposals without waiting. This is the accepted product default; broader maintenance-policy settings can be added later.

Every revision records the actor, source run, reason, parent revision, and package hash. Use optimistic concurrency: an update supplies its expected base revision; stale updates become conflicts instead of overwrites. Write validated packages atomically, with a recovery journal so a crash between filesystem publication and DB commit can be reconciled. Undo creates a new revision restoring old content; archive is reversible.

Defer a background curator. Start with recent changes, duplicates suggested by agents, and usage evidence. Later curation can suggest consolidation or archival while preserving pinned skills and routine dependencies.

## User-facing management

One Skills library with Shared, By agent, and Proposed changes filters. A skill detail shows instructions, supporting files, availability, source, agent bindings, revision history, and recent loads. Actions: create, import, edit, enable/disable, customize for an agent, promote to shared, archive/restore, and undo. Agent settings show inherited and owned skills. Applying or dismissing a proposed revision uses a readable diff, including supporting-file changes.

Keep the existing distinction visible: agent instructions define role and behavior; skills describe reusable methods; memory stores durable facts and preferences; routines determine when work runs.

## Delivery sequence

1. Foundation: package parser, registry, scope resolution, revision storage, reconciliation, and migration from hardcoded workflows.
2. Runtime: discovery/read tools, unified run context for chats/tasks/routines, explicit bindings, revision snapshots, and load logs. Verify the provider does not independently inject an unfiltered skill catalog; app scope must not be undermined by host-level discovery.
3. Management and learning: library UI, per-agent bindings, file/folder import/export, authoring tools, shared-change review, conflicts, and undo.
4. Later: Hermes-directory import convenience, remote sources and update checks, script execution support, optional curation, fixed-version routine pins, and project-scoped skills if a concrete need appears.

Phases 1–3 constitute the useful first release. A marketplace is not required.

## Acceptance checks

- Agents see enabled shared packages and their own packages; tool calls cannot impersonate another agent or fetch its scoped packages.
- Duplicate names resolve explicitly; renames preserve routine bindings.
- Chat, task, and routine runs use the same catalog and loader.
- Explicitly requested unavailable skills report the missing capability, without broadening permissions.
- Edits made during a run do not change that run's snapshot; subsequent runs see new revisions.
- Concurrent updates detect conflicts; crash recovery and undo restore complete packages.
- Import, customization, and promotion preserve supporting files and provenance.
- Invalid metadata, oversized files, path traversal, and escaping symlinks fail predictably.
- Bundled updates preserve local edits, and archive cannot silently break a routine dependency.

## Accepted defaults

Shared skills are inherited by default, agent-owned learned skills may evolve automatically with undo, and shared changes are proposed for review. The storage and runtime architecture supports changing these policies without moving skill content.

## Validation

The first release has registry/package tests covering scopes, customization, immutable reads, conflicting revisions, agent mutation policy, routine dependencies, direct disk edits, binary assets, malicious paths, and recovery from interrupted publication. Runtime tests exercise the same skills tools in chats, tasks, and routines. An isolated Electron UI check exercises create/edit/undo, proposal comparison/application, search empty states, and the minimum supported window width. Live connector-backed model runs still need an end-to-end account check.

Codex host skills are enumerated and disabled using per-thread `skills.config` overrides; this does not change the user's global Codex configuration. See the [official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference). The agent run receives its Ägir catalog through instructions and scoped dynamic tools.
