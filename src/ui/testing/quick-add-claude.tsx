import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { AppEvent, DesktopApi, Snapshot, Task } from '../../../shared/types';

// Isolated fixture for Add with Claude: an in-memory task list, and a polish call the test can hold or fail.
const now = new Date().toISOString();
const data = {
  agents: [{ id: 'lead', name: 'Claude', role: 'Lead', color: '#ede7fc', instructions: '', createdAt: now }],
  groups: [{ id: 'general', title: 'General', kind: 'group', agentIds: ['lead'], leadAgentId: 'lead', instructions: '', createdAt: now }],
  threads: [], tasks: [] as Task[],
  taskLinks: [], taskFiles: [], routines: [], routineRuns: [], connectors: [], approvals: [], legacyMemoryCount: 0, memoryInstructions: '',
  codexStatus: 'Connected', engine: 'Claude Code', memoryProvider: 'gbrain',
  reminders: { enabled: false, list: '', state: 'off', detail: '', lastSyncAt: null }, launchAtLogin: false,
  browser: { enabled: false, status: 'disabled', detail: '', threadId: null },
  mcpSettings: { slackClientId: '', slackConfigured: false },
} as unknown as Snapshot;

const listeners = new Set<(event: AppEvent) => void>();
const emit = () => { const value = structuredClone(data); for (const listener of listeners) listener({ type: 'snapshot', value }); };
let release: (() => void) | null = null;
const fixture = {
  polished: [] as string[],
  fail: false,
  hold: false,
  release: () => release?.(),
};
Object.assign(window, { fixture });

window.aegir = {
  snapshot: async () => structuredClone(data),
  onEvent: (listener: (event: AppEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  threadMessages: async () => ({ messages: [], before: null }),
  skillLibrary: async () => ({ skills: [], proposals: [], routineBindings: {} }),
  listDocuments: async () => [],
  runEvents: async () => [],
  claudeRoutines: async () => ({ source: null, tasks: [] }),
  polishTask: async (text: string) => {
    fixture.polished.push(text);
    if (fixture.hold) await new Promise<void>((done) => { release = done; });
    if (fixture.fail) throw new Error('Claude is not available');
    return { title: 'Draft September investor memo', notes: 'Waiting on the monthly report and close numbers from Tove.', label: null, dueAt: '2099-01-02' };
  },
  createTask: async (input: { title: string; notes?: string; label?: string | null; dueAt?: string | null }) => {
    const task: Task = { id: `t${data.tasks.length + 1}`, title: input.title, notes: input.notes || '', label: input.label ?? null, dueAt: input.dueAt ?? null,
      status: 'ready', agentId: null, threadId: null, outputDir: null, sourceUrl: null, sourceKey: null, createdAt: now, updatedAt: now, completedAt: null };
    data.tasks = [...data.tasks, task];
    emit();
    return task;
  },
} as unknown as DesktopApi;

const { App } = await import('../App');
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultMode="light"><App /></ThemeProvider>);
