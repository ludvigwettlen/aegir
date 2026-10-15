import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { AppEvent, DesktopApi, Message, MessageDraft, Priority, Snapshot, Task } from '../../../shared/types';
import { isoDate } from '../../../shared/tasks';

// Sample screen for design mockups: a full Today list with Claude's bands, one task open with a short conversation and
// two draft cards. Read-only; nothing here is a test.
const now = new Date().toISOString();
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const today = isoDate(new Date());
const later = isoDate(new Date(Date.now() + 3 * 86_400_000));
const task = (id: string, title: string, extra: Partial<Task>): Task => ({
  id, title, notes: '', label: null, dueAt: null, status: 'ready', agentId: null, threadId: null, outputDir: null,
  sourceUrl: null, sourceKey: null, createdAt: now, updatedAt: now, completedAt: null, priority: null, prioritySource: null, agentPriority: null, priorityReason: null, prioritySetAt: null, priorityCheckedAt: null, ...extra,
});
const claude = (priority: Priority, reason: string) => ({ priority, prioritySource: 'agent' as const, agentPriority: priority, priorityReason: reason });
const threadId = 'nordvik-thread';
const data = {
  agents: [{ id: 'lead', name: 'Claude', role: 'Lead', color: '#ede7fc', instructions: '', createdAt: now }],
  groups: [
    { id: 'general', title: 'General', kind: 'group', agentIds: ['lead'], leadAgentId: 'lead', instructions: '', createdAt: now },
    { id: 'claude', title: 'Claude', kind: 'private', agentIds: ['lead'], leadAgentId: 'lead', instructions: '', createdAt: now },
  ],
  threads: [{ id: threadId, groupId: 'general', title: 'Follow up with Nordvik on the rollout', kind: 'task', taskId: 'nordvik', status: 'active',
    createdAt: now, updatedAt: now, agentIds: ['lead'], busyAgentIds: [], snippet: 'Both drafts are below.', messageCount: 4 }],
  tasks: [
    task('nordvik', 'Follow up with Nordvik on the rollout', { status: 'review', threadId, agentId: 'lead', label: 'customers', dueAt: today, ...claude(1, 'Pilot starts Monday, Petra is waiting') }),
    task('tove', 'Answer Tove on the September report', { label: 'finance', dueAt: today, ...claude(1, 'Blocks the board pack going out Friday') }),
    task('greenfield', 'Prep Greenfield call with Dana Whitfield', { label: 'investor', dueAt: today, ...claude(2, 'Investor intro call, prep can wait a day') }),
    task('people', 'Map direct reports to level and stage', { label: 'people', dueAt: today, ...claude(2, 'Due before Thursday mgmt') }),
    task('agenda', 'Add pricing decision to the mgmt agenda', { label: 'mgmt', dueAt: today, ...claude(2, 'Mgmt meets Monday') }),
    task('cognition', 'Read the Cognition playbook piece', { label: 'read', dueAt: today, ...claude(3, 'Reading, no deadline') }),
    task('linkedin', 'Edit Thursday LinkedIn post on agentic hiring', { label: 'gtm', dueAt: today, ...claude(3, 'Post goes out Thursday') }),
    task('board', 'Sign off the board pack', { label: 'board', dueAt: later, ...claude(1, 'Board meets next week') }),
    task('jobb', 'Prep for Jobbsprånget', { status: 'proposed', label: 'gtm', sourceKey: 'inbox:calendar-1', ...claude(1, 'Meeting tomorrow') }),
  ],
  taskLinks: [], taskFiles: [],
  routines: [{ id: 'hourly', name: 'Hourly discovery', instructions: '', agentId: 'lead', schedule: { every: 'hour' }, enabled: true, lastRunAt: null, createdAt: now, updatedAt: now }],
  routineRuns: [], connectors: [], approvals: [], legacyMemoryCount: 0, memoryInstructions: '', codexStatus: 'Connected', engine: 'Claude Code',
  memoryProvider: 'gbrain', brainDir: null, triage: { state: 'idle', detail: 'Claude prioritized 8 · 09:12', lastRunAt: now },
  reminders: { enabled: true, list: 'Reminders', state: 'on', detail: '', lastSyncAt: now }, launchAtLogin: false,
  browser: { enabled: false, status: 'disabled', detail: '', threadId: null },
  mcpSettings: { slackClientId: '', slackConfigured: false },
} as unknown as Snapshot;

const line = (id: string, role: 'user' | 'agent', content: string, createdAt: string): Message =>
  ({ id, threadId, agentId: role === 'agent' ? 'lead' : null, role, content, status: 'complete', meta: null, createdAt });
const draft = (id: string, createdAt: string, fields: Omit<MessageDraft, 'type' | 'original'>): Message => ({
  id, threadId, agentId: 'lead', role: 'system', content: `${fields.channel === 'slack' ? 'Slack' : 'Email'} draft: ${fields.label}`, status: 'complete',
  createdAt, meta: { type: 'message-draft', original: fields.text, ...fields },
});
const messages: Message[] = [
  line('ask', 'user', 'Draft the follow-ups to Petra and Johan about the Nordvik rollout. Keep Johan short.', ago(14)),
  line('reply', 'agent', 'Both drafts are below. Petra gets the plan you agreed on the call, Johan gets a two-line heads-up. Send them from the cards.', ago(12)),
  draft('slack', ago(11.9), { channel: 'slack', label: 'DM to Johan', state: 'pending', slack: { channelId: 'U06TESTUSR1', name: 'Johan Lund' },
    text: 'Hej Johan, mailet till Petra om Nordvik är på väg. Säg till om du vill lägga till något innan hon svarar.' }),
  draft('email', ago(11.8), { channel: 'email', label: 'Reply to Petra at Nordvik', state: 'pending',
    email: { to: ['petra.berg@example.com'], cc: ['johan.lund@example.com'], bcc: [], subject: 'Re: Nordvik rollout plan',
      draftId: 'draft-7f3a', threadId: '18f2c3a4b5d6e7f8', account: 'mia@example.com', confirmed: true },
    text: 'Hi Petra,\n\nThanks for the call today. Here is the plan we agreed:\n\n1. Pilot with the Stockholm team from 14 October.\n2. Review it together on 28 October.\n3. Roll out to everyone in November if the pilot holds.\n\nBest,\nMia' }),
];

const listeners = new Set<(event: AppEvent) => void>();
const noop = async () => {};
window.aegir = new Proxy({
  snapshot: async () => structuredClone(data),
  onEvent: (listener: (event: AppEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  threadMessages: async (id: string) => ({ messages: structuredClone(messages.filter((item) => item.threadId === id)), before: null }),
  skillLibrary: async () => ({ skills: [], proposals: [], routineBindings: {} }),
  listDocuments: async () => ['nordvik-rollout-plan.md'],
  readDocument: async (_thread: string, path: string) => ({ path, revision: '0', content: '# Nordvik rollout plan\n\nPilot with the Stockholm team from 14 October. Review together on 28 October, then roll out to everyone in November if the pilot holds.\n\n## Owners\n\n- Petra Berg, Nordvik\n- Johan Lund, Northwind\n\n## Open questions\n\n1. Which teams join the pilot after Stockholm?\n2. Who signs off the November rollout?\n' }),
  saveDocument: async (_thread: string, path: string, _expected: string, content: string) => ({ path, content, revision: '1' }),
  runEvents: async () => [],
  claudeRoutines: async () => ({ source: null, tasks: [] }),
} as Record<string, unknown>, { get: (target, name: string) => target[name] ?? noop }) as unknown as DesktopApi;

const { App } = await import('../App');
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultMode="light"><App /></ThemeProvider>);
