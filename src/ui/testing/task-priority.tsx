import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { AppEvent, DesktopApi, Priority, Snapshot, Task } from '../../../shared/types';
import { isoDate } from '../../../shared/tasks';

// Isolated fixture for priority bands: Claude's bands on a few tasks, an in-memory store for the user's overrides.
const now = new Date().toISOString();
const today = isoDate(new Date());
const later = isoDate(new Date(Date.now() + 3 * 86_400_000));
const task = (id: string, title: string, extra: Partial<Task>): Task => ({
  id, title, notes: '', label: null, dueAt: null, status: 'ready', agentId: null, threadId: null, outputDir: null,
  sourceUrl: null, sourceKey: null, createdAt: now, updatedAt: now, completedAt: null, priority: null, prioritySource: null, agentPriority: null, priorityReason: null, prioritySetAt: null, priorityCheckedAt: null, ...extra,
});
const claude = (priority: Priority, reason: string) => ({ priority, prioritySource: 'agent' as const, agentPriority: priority, priorityReason: reason });
const data = {
  agents: [{ id: 'lead', name: 'Claude', role: 'Lead', color: '#ede7fc', instructions: '', createdAt: now }],
  groups: [{ id: 'general', title: 'General', kind: 'group', agentIds: ['lead'], leadAgentId: 'lead', instructions: '', createdAt: now }],
  threads: [],
  tasks: [
    task('greenfield', 'Prep Greenfield call with Dana Whitfield', { label: 'investor', dueAt: today, ...claude(2, 'Investor intro call, prep can wait a day') }),
    task('tove', 'P1: Answer Tove on the September report', { label: 'finance', dueAt: today, ...claude(1, 'Blocks the board pack going out Friday') }),
    task('cognition', 'Read the Cognition playbook piece', { label: 'read', dueAt: today, ...claude(3, 'Reading, no deadline') }),
    task('people', 'Map direct reports to level and stage', { label: 'people', dueAt: today }),
    task('board', 'Sign off the board pack', { label: 'board', dueAt: later, ...claude(1, 'Board meets next week') }),
    task('harbourline', 'Customer advisory board with Harbourline', { dueAt: later, ...claude(1, 'Strategic account, date set') }),
    task('grok', 'Can I add my grok bots to Legolas?', { status: 'review', threadId: 'grok-thread', agentId: 'lead', ...claude(3, 'Your own tooling, no date') }),
    task('jobb', 'Prep for Jobbsprånget', { status: 'proposed', label: 'gtm', sourceKey: 'inbox:calendar-1', ...claude(1, 'Meeting tomorrow') }),
  ],
  taskLinks: [], taskFiles: [], routines: [], routineRuns: [], connectors: [], approvals: [], legacyMemoryCount: 0, memoryInstructions: '',
  codexStatus: 'Connected', engine: 'Claude Code', memoryProvider: 'gbrain', brainDir: null,
  triage: { state: 'idle', detail: 'Claude prioritized 6 · 09:12', lastRunAt: now },
  reminders: { enabled: false, list: '', state: 'off', detail: '', lastSyncAt: null }, launchAtLogin: false,
  browser: { enabled: false, status: 'disabled', detail: '', threadId: null },
  mcpSettings: { slackClientId: '', slackConfigured: false },
} as unknown as Snapshot;

const listeners = new Set<(event: AppEvent) => void>();
const emit = () => { const value = structuredClone(data); for (const listener of listeners) listener({ type: 'snapshot', value }); };
const fixture = { calls: [] as Array<[string, ...unknown[]]>, undo: [] as Task[] };
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
  // The store's rule: the user's band replaces Claude's and keeps what Claude said; null hands it back.
  setTaskPriority: async (id: string, priority: Priority | null) => {
    record('setTaskPriority', id, priority);
    data.tasks = data.tasks.map((item) => {
      if (item.id !== id) return item;
      fixture.undo.push(item);
      return { ...item, priority, prioritySource: priority === null ? null : 'user' };
    });
    emit();
  },
  undoTaskAction: async () => {
    const before = fixture.undo.pop();
    if (!before) return null;
    data.tasks = data.tasks.map((item) => (item.id === before.id ? before : item));
    emit();
    return { taskId: before.id, action: 'priority change' };
  },
  prioritizeTasks: async () => { record('prioritizeTasks'); data.triage = { state: 'running', detail: 'Prioritizing 3 tasks…', lastRunAt: now }; emit(); },
  createTask: async (input: { title: string; label?: string | null; dueAt?: string | null; priority?: Priority | null }) => {
    record('createTask', input);
    const created = task(`t${data.tasks.length + 1}`, input.title, { label: input.label ?? null, dueAt: input.dueAt ?? null,
      priority: input.priority ?? null, prioritySource: input.priority ? 'user' : null });
    data.tasks = [...data.tasks, created];
    emit();
    return created;
  },
  updateTask: async (id: string, update: Partial<Task>) => { record('updateTask', id, update); data.tasks = data.tasks.map((item) => (item.id === id ? { ...item, ...update } : item)); emit(); },
} as unknown as DesktopApi;

const { App } = await import('../App');
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultMode="light"><App /></ThemeProvider>);
