import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { AppEvent, DesktopApi, Message, MessageDraft, Snapshot, Task } from '../../../shared/types';

// Isolated fixture for draft cards: a task in Needs you whose conversation holds Slack and email drafts, and an
// in-memory API that records each call and answers the way the app does, with the changed message as an event.
const now = new Date().toISOString();
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const threadId = 'nordvik-thread';
const task: Task = {
  id: 'nordvik', title: 'Follow up with Nordvik', notes: '', label: 'customers', dueAt: null, status: 'review', agentId: 'lead', threadId,
  outputDir: null, sourceUrl: null, sourceKey: null, createdAt: now, updatedAt: now, completedAt: null,
};
const data = {
  agents: [{ id: 'lead', name: 'Claude', role: 'Lead', color: '#ede7fc', instructions: '', createdAt: now }],
  groups: [{ id: 'team', title: 'Team', kind: 'group', agentIds: ['lead'], leadAgentId: 'lead', instructions: '', createdAt: now }],
  threads: [{ id: threadId, groupId: 'team', title: task.title, kind: 'task', taskId: task.id, status: 'active', createdAt: now, updatedAt: now,
    agentIds: ['lead'], busyAgentIds: [], snippet: 'Edit them in the cards, copy, and send them.', messageCount: 8 }],
  tasks: [task],
  taskLinks: [], routines: [], routineRuns: [], connectors: [], approvals: [], legacyMemoryCount: 0, memoryInstructions: '', codexStatus: 'Connected', engine: 'Claude Code',
  memoryProvider: 'gbrain', reminders: { enabled: false, list: '', state: 'off', detail: '', lastSyncAt: null }, launchAtLogin: false,
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
  line('ask', 'user', 'Draft the follow-ups to Petra and Johan about the Nordvik rollout.', ago(40)),
  line('first', 'agent', 'Here is a first go at the Slack to Johan, plus a heads-up for #mgmt.', ago(39)),
  draft('slack-old', ago(38.9), { channel: 'slack', label: 'DM to Johan', state: 'replaced', replacedBy: 'slack', slack: { channelId: 'D04TESTDM01' },
    text: 'Hej Johan, mailet till Petra om Nordvik-utrullningen är på väg. Jag återkommer när hon har svarat och vi vet mer om tidsplanen.' }),
  draft('slack-mgmt', ago(38.8), { channel: 'slack', label: '#mgmt', state: 'discarded', slack: { channelId: 'C05MGMT0001' },
    text: 'Nordvik-piloten startar 14 oktober med Stockholmsteamet.' }),
  line('again', 'user', 'Shorter for Johan, and add the reply to Petra.', ago(12)),
  line('reply', 'agent', 'Done. The Slack to Johan is shorter and the reply to Petra is in Superhuman. Edit them in the cards, copy, and send them from Slack or Superhuman.', ago(10)),
  draft('slack', ago(9.9), { channel: 'slack', label: 'DM to Johan Lund', state: 'pending', slack: { channelId: 'D04TESTDM01', threadTs: '1759693200.000100' },
    text: 'Hej Johan, mailet till Petra om Nordvik är skickat. Säg till om du vill lägga till något innan hon svarar.' }),
  draft('email', ago(9.8), { channel: 'email', label: 'Reply to Petra at Nordvik', state: 'pending',
    email: { to: ['petra.berg@example.com'], cc: ['johan.lund@example.com'], bcc: ['crm-log+nordvik-rollout-pilot-2026@example.com'], subject: 'Re: Nordvik rollout plan',
      draftId: 'draft-7f3a', threadId: '18f2c3a4b5d6e7f8', account: 'malcolm@example.com' },
    text: 'Hi Petra,\n\nThanks for the call today. Here is the rollout plan we agreed:\n\n1. Pilot with the Stockholm team from 14 October.\n2. Review it together on 28 October.\n3. Roll out to everyone in November if the pilot holds.\n\nBest,\nMalcolm' }),
];

const listeners = new Set<(event: AppEvent) => void>();
const fixture = { calls: [] as Array<[string, ...unknown[]]>, clipboard: '' };
Object.assign(window, { fixture });
const record = (name: string, ...args: unknown[]) => { fixture.calls.push([name, ...args]); };
// Like the app: a draft changes only while pending, and the changed message comes back as an event.
const change = (id: string, update: Partial<MessageDraft>) => {
  const message = messages.find((item) => item.id === id);
  if (message?.meta?.type !== 'message-draft') throw new Error(`No draft ${id}`);
  if (message.meta.state !== 'pending') throw new Error('This draft is no longer open.');
  message.meta = { ...message.meta, ...update };
  const value = structuredClone(message);
  for (const listener of listeners) listener({ type: 'message', value });
};
// The card copies through navigator.clipboard; keep what it wrote instead of touching the real clipboard.
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
  writeText: async (text: string) => { record('writeText', text); fixture.clipboard = text; },
} });

window.aegir = {
  snapshot: async () => structuredClone(data),
  onEvent: (listener: (event: AppEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  threadMessages: async (id: string) => ({ messages: structuredClone(messages.filter((item) => item.threadId === id)), before: null }),
  skillLibrary: async () => ({ skills: [], proposals: [], routineBindings: {} }),
  listDocuments: async () => [],
  runEvents: async () => [],
  claudeRoutines: async () => ({ source: null, tasks: [] }),
  updateDraft: async (id: string, text: string) => { record('updateDraft', id, text); change(id, { text }); },
  markDraftSent: async (id: string, text: string) => { record('markDraftSent', id, text); change(id, { text, state: 'sent', sentAt: new Date().toISOString() }); },
  discardDraft: async (id: string) => { record('discardDraft', id); change(id, { state: 'discarded' }); },
  openExternal: async (url: string) => { record('openExternal', url); },
  copyChatTranscript: async (id: string) => { record('copyChatTranscript', id); },
} as unknown as DesktopApi;

const { App } = await import('../App');
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultMode="light"><App /></ThemeProvider>);
