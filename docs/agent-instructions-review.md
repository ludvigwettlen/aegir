# Agent instruction review

Reviewed 28 September 2026 against the published [Hermes prompt builder](https://github.com/NousResearch/hermes-agent/blob/main/agent/prompt_builder.py), particularly `DEFAULT_AGENT_IDENTITY`, `TASK_COMPLETION_GUIDANCE`, `OPENAI_MODEL_EXECUTION_GUIDANCE`, and `build_memory_guidance`.

| Area | Decision for Aegir |
| --- | --- |
| Completion and verification | Added shared guidance to finish authorized work, validate artifacts, verify external changes when possible, and report blockers honestly. |
| Evidence | Added search coverage, pagination, literal identifier preservation, and a distinction between source evidence and instructions. |
| Communication | Added proportionate reporting, explicit uncertainty, and focused clarification. |
| Memory | Clarified durable facts versus reusable procedures, stale context, duplicate avoidance, scope, and exclusion of secrets. |
| Existing skills | Retained catalog discovery, loading, authoring, proposals, revisions, and reflection guidance. |
| Runtime-specific features | Did not import Hermes identity, tool names, session search, kanban, delegation machinery, or compaction markers unavailable in Aegir. |

`electron/agent-instructions.ts` supplies common guidance to chat, task, and routine runs. Editable personalities and memory settings remain intact. Task outputs stay in their designated folder; Slack and Notion connectors remain read-only for tasks and routines. Chat connector writes still require approval. Optional browser tools are available in chats and tasks under a separate per-response approval, enforced in the browser manager; routines cannot use them. Routines report unavailable sources instead of presenting failed searches as no findings.

Tests verify that custom instructions reach the provider and that tool permissions remain correct in all three run modes. Prompt prose is not locked to exact wording. These are instruction and integration checks, not evidence of live model compliance; real-account end-to-end validation remains on the TODO list.
