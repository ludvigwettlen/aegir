import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { AppEvent, DesktopApi, Snapshot, Task, TaskChange } from '../../../shared/types';
import { isoDate } from '../../../shared/tasks';

// Isolated fixture for the command palette: fake tasks and an in-memory API, no app database or accounts.
const now = new Date().toISOString();
const today = isoDate(new Date());
const task = (id: string, title: string, extra: Partial<Task>): Task => ({
  id, title, notes: '', label: null, dueAt: null, status: 'ready', agentId: null, threadId: null, outputDir: null,
  sourceUrl: null, sourceKey: null, createdAt: now, updatedAt: now, completedAt: null, ...extra,
});
const data = {
  agents: [{ id: 'lead', name: 'Claude', role: 'Lead', color: '#ede7fc', instructions: '', createdAt: now }],
  groups: [
    { id: 'general', title: 'General', kind: 'group', agentIds: ['lead'], leadAgentId: 'lead', instructions: '', createdAt: now },
    { id: 'claude', title: 'Claude', kind: 'private', agentIds: ['lead'], leadAgentId: 'lead', instructions: '', createdAt: now },
  ],
  threads: [{ id: 'research-thread', groupId: 'general', title: 'Research competitor pricing', kind: 'task', taskId: 'research', status: 'active',
    createdAt: now, updatedAt: now, agentIds: ['lead'], busyAgentIds: [], snippet: 'Pricing table is ready.', messageCount: 1 }],
  tasks: [
    task('calls', 'Summarise customer calls', { label: 'customers', dueAt: today }),
    task('deck', 'Prep board deck', { label: 'board', dueAt: today }),
    task('research', 'Research competitor pricing', { status: 'review', threadId: 'research-thread', agentId: 'lead', dueAt: today, outputDir: '/mock' }),
    task('churn', 'Check churn numbers', { status: 'proposed', sourceKey: 'fixture:churn' }),
    task('dentist', 'Book dentist', {}),
  ],
  taskLinks: [],
  routines: [{ id: 'hourly', name: 'Hourly discovery', instructions: '', agentId: 'lead', schedule: { every: 'hour' }, enabled: true, lastRunAt: null, createdAt: now, updatedAt: now }],
  routineRuns: [], connectors: [], approvals: [], legacyMemoryCount: 0, memoryInstructions: '', codexStatus: 'Connected', engine: 'Claude Code',
  memoryProvider: 'gbrain', reminders: { enabled: false, list: '', state: 'off', detail: '', lastSyncAt: null }, launchAtLogin: false,
  browser: { enabled: false, status: 'disabled', detail: '', threadId: null },
  mcpSettings: { slackClientId: '', slackConfigured: false },
} as unknown as Snapshot;

const listeners = new Set<(event: AppEvent) => void>();
const emit = () => { const value = structuredClone(data); for (const listener of listeners) listener({ type: 'snapshot', value }); };
const fixture = {
  calls: [] as Array<[string, ...unknown[]]>, clipboard: 'https://example.com/notes', deleted: [] as Task[],
  // Stands in for the app changing a task on its own, e.g. an agent or a sweep, while the palette is open.
  setDue: (id: string, dueAt: string | null) => change(id, { dueAt }),
};
Object.assign(window, { fixture });
const record = (name: string, ...args: unknown[]) => { fixture.calls.push([name, ...args]); };
const change = (id: string, update: TaskChange) => {
  data.tasks = data.tasks.map((item) => (item.id === id ? { ...item, ...update, updatedAt: new Date().toISOString() } : item));
  emit();
};

window.aegir = {
  snapshot: async () => structuredClone(data),
  onEvent: (listener: (event: AppEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  threadMessages: async () => ({ messages: [], before: null }),
  skillLibrary: async () => ({ skills: [], proposals: [], routineBindings: {} }),
  listDocuments: async () => [],
  runEvents: async () => [],
  claudeRoutines: async () => ({ source: '/fixture/scheduled-tasks.json', tasks: [
    { id: 'cron-daily-brief', name: 'cron-daily-brief', description: 'Morning brief', schedule: 'Daily at 05:00', cron: '0 5 * * *', enabled: true, lastRunAt: null, runs: [] },
  ] }),
  updateTask: async (id: string, update: TaskChange) => { record('updateTask', id, update); change(id, update); },
  deleteTask: async (id: string) => {
    record('deleteTask', id);
    fixture.deleted.push(data.tasks.find((item) => item.id === id)!);
    data.tasks = data.tasks.filter((item) => item.id !== id);
    emit();
  },
  undoTaskAction: async () => {
    const restored = fixture.deleted.pop();
    if (!restored) return null;
    record('undoTaskAction', restored.id);
    data.tasks = [...data.tasks, restored];
    emit();
    return { taskId: restored.id, action: 'delete' };
  },
  handOff: async (id: string, instruction: string) => { record('handOff', id, instruction); },
  stopTask: async (id: string) => { record('stopTask', id); },
  readClipboardText: async () => fixture.clipboard,
  addTaskLink: async (id: string, url: string) => { record('addTaskLink', id, url); return { id: 'link', taskId: id, url, createdAt: now }; },
  openTaskOutput: async (id: string) => { record('openTaskOutput', id); },
  openTaskLink: async (id: string) => { record('openTaskLink', id); },
  runRoutine: async (id: string) => { record('runRoutine', id); },
  setRoutineEnabled: async (id: string, enabled: boolean) => {
    record('setRoutineEnabled', id, enabled);
    data.routines = data.routines.map((item) => (item.id === id ? { ...item, enabled } : item));
    emit();
  },
  createGroup: async (title: string) => { record('createGroup', title); return data.groups[0]; },
} as unknown as DesktopApi;

const { App } = await import('../App');
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultMode="light"><App /></ThemeProvider>);
