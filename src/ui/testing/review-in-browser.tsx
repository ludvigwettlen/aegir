import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { AppEvent, DesktopApi, Snapshot, Task, TaskChange, ThreadSummary } from '../../../shared/types';

// Isolated fixture for Review in browser: tasks with one draft, several drafts, an attached draft and none.
const now = new Date().toISOString();
const task = (id: string, title: string, extra: Partial<Task>): Task => ({
  id, title, notes: '', label: null, dueAt: null, status: 'ready', agentId: null, threadId: null, outputDir: null,
  sourceUrl: null, sourceKey: null, createdAt: now, updatedAt: now, completedAt: null, ...extra,
});
const thread = (id: string, taskId: string, title: string): ThreadSummary => ({
  id, groupId: 'general', title, kind: 'task', taskId, status: 'active', createdAt: now, updatedAt: now,
  agentIds: ['lead'], busyAgentIds: [], snippet: '', messageCount: 1,
});
const files: Record<string, string[]> = {
  'dm-thread': ['connor-dm.md'],
  'memo-thread': ['memo.md', 'notes/sources.md', 'status.md'],
  'empty-thread': [],
  'brief-thread': ['brief.md', 'appendix.md'],
};
const data = {
  agents: [{ id: 'lead', name: 'Claude', role: 'Lead', color: '#ede7fc', instructions: '', createdAt: now }],
  groups: [{ id: 'general', title: 'General', kind: 'group', agentIds: ['lead'], leadAgentId: 'lead', instructions: '', createdAt: now }],
  threads: [thread('dm-thread', 'dm', 'Draft the DM to Connor'), thread('memo-thread', 'memo', 'Write the board memo'), thread('empty-thread', 'empty', 'Look up the venue'), thread('brief-thread', 'brief', 'Brief the new designer')],
  tasks: [
    task('dm', 'Draft the DM to Connor', { status: 'review', threadId: 'dm-thread', agentId: 'lead', outputDir: '/mock/dm' }),
    task('memo', 'Write the board memo', { status: 'review', threadId: 'memo-thread', agentId: 'lead', outputDir: '/mock/memo' }),
    task('empty', 'Look up the venue', { status: 'review', threadId: 'empty-thread', agentId: 'lead', outputDir: '/mock/empty' }),
    task('brief', 'Brief the new designer', { status: 'review', threadId: 'brief-thread', agentId: 'lead', outputDir: '/mock/brief' }),
    task('attached', 'Polish the offsite agenda', {}),
  ],
  taskLinks: [{ id: 'link', taskId: 'attached', url: 'file:///Users/m/brain/drafts/offsite%20agenda.md', createdAt: now }],
  routines: [], routineRuns: [], connectors: [], approvals: [], legacyMemoryCount: 0, memoryInstructions: '',
  codexStatus: 'Connected', engine: location.search.includes('codex') ? 'Codex' : 'Claude Code', memoryProvider: 'gbrain',
  reminders: { enabled: false, list: '', state: 'off', detail: '', lastSyncAt: null }, launchAtLogin: false,
  browser: { enabled: false, status: 'disabled', detail: '', threadId: null },
  mcpSettings: { slackClientId: '', slackConfigured: false },
} as unknown as Snapshot;

const listeners = new Set<(event: AppEvent) => void>();
const emit = () => { const value = structuredClone(data); for (const listener of listeners) listener({ type: 'snapshot', value }); };
const change = (id: string, update: Partial<Task>) => {
  data.tasks = data.tasks.map((item) => (item.id === id ? { ...item, ...update, updatedAt: new Date().toISOString() } : item));
  emit();
};
const fixture = { calls: [] as Array<[string, ...unknown[]]> };
Object.assign(window, { fixture });
const record = (name: string, ...args: unknown[]) => { fixture.calls.push([name, ...args]); };

window.aegir = {
  snapshot: async () => structuredClone(data),
  onEvent: (listener: (event: AppEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  threadMessages: async () => ({ messages: [], before: null }),
  skillLibrary: async () => ({ skills: [], proposals: [], routineBindings: {} }),
  listDocuments: async (threadId: string) => files[threadId] || [],
  runEvents: async () => [],
  claudeRoutines: async () => ({ source: null, tasks: [] }),
  updateTask: async (id: string, update: TaskChange) => { record('updateTask', id, update); change(id, update); },
  handOff: async (id: string, instruction: string) => {
    record('handOff', id, instruction);
    data.threads = [...data.threads, thread(`thread-${id}`, id, data.tasks.find((item) => item.id === id)!.title)];
    change(id, { status: 'running', threadId: `thread-${id}`, agentId: 'lead', outputDir: `/mock/${id}` });
  },
  sendMessage: async (threadId: string, content: string) => {
    record('sendMessage', threadId, content);
    change(data.tasks.find((item) => item.threadId === threadId)!.id, { status: 'running' });
  },
  stopTask: async (id: string) => { record('stopTask', id); },
} as unknown as DesktopApi;

const { App } = await import('../App');
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultMode="light"><App /></ThemeProvider>);
