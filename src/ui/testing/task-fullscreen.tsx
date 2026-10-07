import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { AppEvent, DesktopApi, Message, Snapshot, Task } from '../../../shared/types';

// Isolated fixture for a task in full screen: a working task with a conversation, a long title and a long one-line
// context, which is what once made the full-screen panel wider than the window (7 Oct 2026).
const now = new Date().toISOString();
const threadId = 'growth-thread';
const task: Task = {
  id: 'growth', title: 'Raise the bar: plan for 100+ meetings and 2x growth in 2027', status: 'running', agentId: 'lead', threadId,
  notes: 'Mental exercise for mgmt team based on 1-1 notes from Maja yesterday. Current momentum is good (14-20 meetings booked). Question: what would it take to book 100+ meetings a quarter and double new ARR in 2027, and what would we stop doing to get there?',
  label: 'mgmt', dueAt: null, outputDir: null, sourceUrl: null, sourceKey: null, createdAt: now, updatedAt: now, completedAt: null,
  priority: 2, prioritySource: 'agent', agentPriority: 2, priorityReason: 'Your 2027 growth frame for mgmt, real work, but the board pack comes first.', prioritySetAt: now, priorityCheckedAt: now,
};
const data = {
  agents: [{ id: 'lead', name: 'Claude', role: 'Lead', color: '#ede7fc', instructions: '', createdAt: now }],
  groups: [{ id: 'general', title: 'General', kind: 'group', agentIds: ['lead'], leadAgentId: 'lead', instructions: '', createdAt: now }],
  threads: [{ id: threadId, groupId: 'general', title: task.title, kind: 'task', taskId: task.id, status: 'active', createdAt: now, updatedAt: now,
    agentIds: ['lead'], busyAgentIds: [], snippet: 'Your edited text is now the final version.', messageCount: 2 }],
  tasks: [task],
  taskLinks: [], taskFiles: [], routines: [], routineRuns: [], connectors: [], approvals: [], legacyMemoryCount: 0, memoryInstructions: '',
  codexStatus: 'Connected', engine: 'Claude Code', memoryProvider: 'gbrain', brainDir: null,
  triage: { state: 'idle', detail: '', lastRunAt: null },
  reminders: { enabled: false, list: '', state: 'off', detail: '', lastSyncAt: null }, launchAtLogin: false,
  browser: { enabled: false, status: 'disabled', detail: '', threadId: null },
  mcpSettings: { slackClientId: '', slackConfigured: false },
} as unknown as Snapshot;
const line = (id: string, role: 'user' | 'agent', content: string): Message =>
  ({ id, threadId, agentId: role === 'agent' ? 'lead' : null, role, content, status: 'complete', meta: null, createdAt: now });
const messages: Message[] = [
  line('ask', 'user', 'Draft the frame for the mgmt discussion.'),
  line('answer', 'agent', 'Your edited text is now the final version in the file, with a delta section recording what you cut. The pattern in your edits: you removed every place where I told the room what a good answer looks like and left the question open instead.'),
];

const listeners = new Set<(event: AppEvent) => void>();
window.aegir = {
  snapshot: async () => structuredClone(data),
  onEvent: (listener: (event: AppEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  threadMessages: async () => ({ messages: structuredClone(messages), before: null }),
  skillLibrary: async () => ({ skills: [], proposals: [], routineBindings: {} }),
  listDocuments: async () => [],
  runEvents: async () => [],
  claudeRoutines: async () => ({ source: null, tasks: [] }),
  copyChatTranscript: async () => {},
} as unknown as DesktopApi;

const { App } = await import('../App');
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultMode="light"><App /></ThemeProvider>);
