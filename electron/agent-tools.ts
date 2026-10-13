import { createHash } from 'node:crypto';
import type { Agent, Routine, RoutineChange, Task, TaskChange } from '../shared/types.js';
import type { Tool } from './codex.js';
import { validSchedule } from '../shared/routines.js';

export type RunKind = 'chat' | 'task' | 'routine' | 'prep';

// Tasks and routines only see read-only connector tools. Browser grants are
// separate and enforced by BrowserManager for attended chat/task responses.
export function connectorToolsFor(kind: RunKind, tools: Tool[]): Tool[] {
  return kind === 'chat' ? tools : tools.filter(tool => tool.readOnly);
}

export function memoryTool(agent: Agent): Tool {
  return { name: `memory__remember_${agent.id.replace(/-/g, '_')}`, description: 'Save one durable user or project memory. Choose shared for facts useful to all agents, private for your own working context. Follow the workspace memory guidance and never store secrets or guesses.', inputSchema: { type: 'object', properties: { content: { type: 'string' }, scope: { type: 'string', enum: ['shared', 'private'] }, sourceUrl: { type: 'string' } }, required: ['content', 'scope'] }, readOnly: false };
}

export function memoryRecallTool(agent: Agent): Tool {
  return { name: `memory__recall_${agent.id.replace(/-/g, '_')}`, description: 'Search and retrieve durable memories from the shared bank and your own private bank in Mnemosyne. Use a focused query when you need prior decisions, preferences, or project context; you can search again with different terms.', inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 2000 } }, required: ['query'], additionalProperties: false }, readOnly: true };
}

export const taskStatuses: Task['status'][] = ['proposed', 'ready', 'running', 'review', 'blocked', 'done', 'dismissed'];

export const taskReadTools: Tool[] = [
  {
    name: 'tasks__list',
    description: 'Find the user’s todos in Aegir by title or notes. Returns ids and summaries; use tasks__read for the complete saved notes. Use status="proposed" for pending proposals. Omit query to browse all todos, and use nextOffset for more results. Collect matching ids across all pages before editing or dismissing results.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, status: { type: 'string', enum: taskStatuses }, offset: { type: 'integer', minimum: 0 } }, additionalProperties: false },
    readOnly: true,
  },
  {
    name: 'tasks__read',
    description: 'Read a todo and its complete saved notes by id, including status and linked thread. Use tasks__list to find the id.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    readOnly: true,
  },
];

export const taskProposalTools: Tool[] = [
  {
    name: 'tasks__update_proposal',
    description: 'Edit a pending task proposal in Aegir as requested by the user. Only tasks with status proposed can be changed. Omitted fields are preserved; null clears label or dueAt. Returns the saved task. Cannot accept proposals or edit accepted tasks.',
    inputSchema: { type: 'object', properties: {
      id: { type: 'string', minLength: 1 },
      change: { type: 'object', properties: {
        title: { type: 'string', minLength: 1, maxLength: 240 },
        notes: { type: 'string' },
        label: { type: ['string', 'null'] },
        dueAt: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null to clear' },
      }, minProperties: 1, additionalProperties: false },
    }, required: ['id', 'change'], additionalProperties: false },
    readOnly: false,
  },
  {
    name: 'tasks__dismiss_proposal',
    description: 'Dismiss a pending task proposal in Aegir as requested by the user, removing it from Needs you. Preserves its source and deduplication record. Only tasks with status proposed can be dismissed. Returns the saved task.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1 } }, required: ['id'], additionalProperties: false },
    readOnly: false,
  },
];

export const taskProposalInstructions = `Task proposals in Aegir:
Use tasks__list with status="proposed" and tasks__read to inspect pending proposals. When the user asks to correct or clean up proposals, use tasks__update_proposal or tasks__dismiss_proposal directly within that request. These local tools do not require browser control or external-write approval. Collect all matching ids before mutating a paginated list. Only pending proposals can be changed; accepted tasks are protected. Preserve source attribution and report the actual saved results. Changes can be undone in the task list.`;

export function cleanTaskProposalChange(value: unknown): TaskChange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A proposal change is required');
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (!keys.length) throw new Error('The proposal change is empty');
  if (keys.some(key => !['title', 'notes', 'label', 'dueAt'].includes(key))) throw new Error('Unsupported proposal field');
  const change: TaskChange = {};
  if ('title' in input) {
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 240) throw new Error('A proposal title must be 1–240 characters');
    change.title = input.title.trim();
  }
  if ('notes' in input) {
    if (typeof input.notes !== 'string') throw new Error('Proposal notes must be text');
    change.notes = input.notes;
  }
  if ('label' in input) {
    if (input.label !== null && typeof input.label !== 'string') throw new Error('Proposal label must be text or null');
    change.label = input.label?.trim().replace(/^#/, '').toLowerCase() || null;
  }
  if ('dueAt' in input) {
    if (input.dueAt !== null && (typeof input.dueAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.dueAt)
      || !Number.isFinite(Date.parse(input.dueAt)) || new Date(input.dueAt).toISOString().slice(0, 10) !== input.dueAt))
      throw new Error('Proposal dueAt must be a valid YYYY-MM-DD date or null');
    change.dueAt = input.dueAt as string | null;
  }
  return change;
}

export const suggestTaskTool: Tool = {
  name: 'tasks__suggest',
  description: 'Suggest a task to the user. It appears under Needs you until they accept or dismiss it. Requires primary-source evidence of personal ownership and a new actionable request. Never suggest routine Slack reply/read/acknowledgement reminders; Slack already handles unread conversations. A substantive obligation originating in Slack must be titled for its actual outcome, not replying to a person. An independent review checks relevance and all existing task statuses before saving; created=false means nothing was saved.',
  inputSchema: { type: 'object', properties: { title: { type: 'string' }, notes: { type: 'string' }, sourceUrl: { type: 'string' }, label: { type: 'string' }, ownershipEvidence: { type: 'string', description: 'Evidence identifying the user and their explicit personal obligation, not team ownership.' }, sourceEvidence: { type: 'string', description: 'Concise factual excerpt or paraphrase from the current primary source you read.' }, freshnessEvidence: { type: 'string', description: 'Dated new request or material change; explain any resurfacing after completion or dismissal.' } }, required: ['title', 'sourceUrl', 'ownershipEvidence', 'sourceEvidence', 'freshnessEvidence'] },
  readOnly: false
};

const scheduleSchema = { type: 'object', properties: { every: { type: 'string', enum: ['hour', 'day', 'week'] }, at: { type: 'string', description: 'HH:MM, 24h local time' }, day: { type: 'integer', description: '0=Sunday … 6=Saturday, weekly only' }, weekdaysOnly: { type: 'boolean' } }, required: ['every'] };
export const proposeRoutineTool: Tool = {
  name: 'routines__propose_change',
  description: 'Propose creating or changing a scheduled routine. The user sees the change and applies or discards it. Omit routineId to propose a new routine (name, instructions and schedule are then required).',
  inputSchema: { type: 'object', properties: { routineId: { type: 'string' }, reason: { type: 'string' }, change: { type: 'object', properties: { name: { type: 'string' }, instructions: { type: 'string' }, agentId: { type: 'string' }, enabled: { type: 'boolean' }, schedule: scheduleSchema } } }, required: ['reason', 'change'] },
  readOnly: false
};

export function taskSourceKey(provider: string, sourceUrl: string, title: string): string {
  return createHash('sha256').update(`${provider}|${sourceUrl.trim()}|${title.toLowerCase().replace(/\s+/g, ' ').trim()}`).digest('hex');
}

// Validates a routine change coming from an agent. Returns only the fields that are well formed.
export function cleanRoutineChange(value: unknown, agents: Agent[], isNew: boolean): RoutineChange {
  const input = (value || {}) as Record<string, unknown>;
  const change: RoutineChange = {};
  if (typeof input.name === 'string' && input.name.trim()) change.name = input.name.trim().slice(0, 80);
  if (typeof input.instructions === 'string' && input.instructions.trim()) change.instructions = input.instructions.trim().slice(0, 4000);
  if (typeof input.agentId === 'string' && agents.some(agent => agent.id === input.agentId)) change.agentId = input.agentId;
  if (typeof input.enabled === 'boolean') change.enabled = input.enabled;
  if (input.schedule !== undefined) { if (!validSchedule(input.schedule)) throw new Error('Invalid schedule'); change.schedule = input.schedule; }
  if (!Object.keys(change).length) throw new Error('The change is empty');
  if (isNew && (!change.name || !change.instructions || !change.schedule)) throw new Error('A new routine needs a name, instructions and a schedule');
  return change;
}

export { mentionedAgents } from '../shared/agent-mentions.js';

// Routines are tagged as @Routine name. Longer names win so "@Weekly metrics digest" does not also match "@Weekly".
export function mentionedRoutines(text: string, routines: Routine[]): Routine[] {
  const lower = text.toLowerCase();
  return [...routines].sort((a, b) => b.name.length - a.name.length).filter(routine => lower.includes(`@${routine.name.toLowerCase()}`));
}

export function slug(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 48) || 'task';
}

export function jsonObject<T>(text: string): Partial<T> {
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  try { return JSON.parse(text.slice(start, end + 1)) as Partial<T>; } catch { return {}; }
}

// One-line, bounded rendering of tool arguments and results for the run log.
export function logText(value: unknown, max = 600): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text === undefined) return 'null';
  return text.length > max ? `${text.slice(0, max)}… (${(text.length / 1024).toFixed(1)} KB)` : text;
}
