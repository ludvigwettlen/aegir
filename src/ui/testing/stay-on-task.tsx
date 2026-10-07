import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { AppEvent, DesktopApi, Snapshot, Task, TaskChange, ThreadSummary } from '../../../shared/types';
import { isoDate } from '../../../shared/tasks';

// Isolated fixture for staying on a task after sending it to the agent: fake tasks and an in-memory API.
const now = new Date().toISOString();
const today = isoDate(new Date());
const task = (id: string, title: string, extra: Partial<Task>): Task => ({
  id, title, notes: '', label: null, dueAt: null, status: 'ready', agentId: null, threadId: null, outputDir: null,
  sourceUrl: null, sourceKey: null, createdAt: now, updatedAt: now, completedAt: null, priority: null, prioritySource: null, agentPriority: null, priorityReason: null, prioritySetAt: null, priorityCheckedAt: null, ...extra,
});
const thread = (id: string, taskId: string, title: string): ThreadSummary => ({
  id, groupId: 'general', title, kind: 'task', taskId, status: 'active', createdAt: now, updatedAt: now,
  agentIds: ['lead'], busyAgentIds: [], snippet: '', messageCount: 1,
});
const data = {
  agents: [{ id: 'lead', name: 'Claude', role: 'Lead', color: '#ede7fc', instructions: '', createdAt: now }],
  groups: [{ id: 'general', title: 'General', kind: 'group', agentIds: ['lead'], leadAgentId: 'lead', instructions: '', createdAt: now }],
  threads: [thread('research-thread', 'research', 'Research competitor pricing')],
  tasks: [
    task('deck', 'Prep board deck', { label: 'board' }),
    task('calls', 'Summarise customer calls', {}),
    task('dentist', 'Book dentist', {}),
    task('research', 'Research competitor pricing', { status: 'review', threadId: 'research-thread', agentId: 'lead', outputDir: '/mock' }),
    task('offsite', 'Plan offsite', { dueAt: today }),
  ],
  taskLinks: [], taskFiles: [], routines: [], routineRuns: [], connectors: [], approvals: [], legacyMemoryCount: 0, memoryInstructions: '',
  codexStatus: 'Connected', engine: 'Claude Code', memoryProvider: 'gbrain',
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
const fixture = {
  calls: [] as Array<[string, ...unknown[]]>,
  // Stands in for the agent finishing its run.
  finish: (id: string) => change(id, { status: 'review' }),
};
Object.assign(window, { fixture });
const record = (name: string, ...args: unknown[]) => { fixture.calls.push([name, ...args]); };

window.aegir = {
  snapshot: async () => structuredClone(data),
  onEvent: (listener: (event: AppEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  threadMessages: async () => ({ messages: [], before: null }),
  skillLibrary: async () => ({ skills: [], proposals: [], routineBindings: {} }),
  listDocuments: async () => [],
  runEvents: async () => [],
  claudeRoutines: async () => ({ source: null, tasks: [] }),
  updateTask: async (id: string, update: TaskChange) => { record('updateTask', id, update); change(id, update); },
  // Like the app: the task turns to team work and its snapshot arrives before the hand-off call returns.
  handOff: async (id: string, instruction: string) => {
    record('handOff', id, instruction);
    const title = data.tasks.find((item) => item.id === id)!.title;
    data.threads = [...data.threads, thread(`thread-${id}`, id, title)];
    change(id, { status: 'running', threadId: `thread-${id}`, agentId: 'lead', outputDir: '/mock' });
    await new Promise((done) => setTimeout(done, 50));
  },
  sendMessage: async (threadId: string, content: string) => {
    record('sendMessage', threadId, content);
    const id = data.tasks.find((item) => item.threadId === threadId)!.id;
    change(id, { status: 'running' });
  },
  stopTask: async (id: string) => { record('stopTask', id); change(id, { status: 'blocked' }); },
  stopThread: async (threadId: string) => { record('stopThread', threadId); },
} as unknown as DesktopApi;

const { App } = await import('../App');
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultMode="light"><App /></ThemeProvider>);
