import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { AppEvent, DesktopApi, Snapshot, Task } from '../../../shared/types';
import { isoDate } from '../../../shared/tasks';

// Isolated fixture for Find a task: tasks on every list, a finished one and a dismissed one.
const now = new Date().toISOString();
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const today = isoDate(new Date());
const later = isoDate(new Date(Date.now() + 4 * 86_400_000));
const task = (id: string, title: string, extra: Partial<Task>): Task => ({
  id, title, notes: '', label: null, dueAt: null, status: 'ready', agentId: null, threadId: null, outputDir: null, sourceUrl: null, sourceKey: null,
  createdAt: now, updatedAt: now, completedAt: null, priority: null, prioritySource: null, agentPriority: null, priorityReason: null, prioritySetAt: null, priorityCheckedAt: null, ...extra,
});
const data = {
  agents: [{ id: 'lead', name: 'Claude', role: 'Lead', color: '#ede7fc', instructions: '', createdAt: now }],
  groups: [{ id: 'general', title: 'General', kind: 'group', agentIds: ['lead'], leadAgentId: 'lead', instructions: '', createdAt: now }],
  threads: [],
  tasks: [
    task('deck', 'Prep board deck', { label: 'board', dueAt: today, priority: 1, prioritySource: 'agent', agentPriority: 1, updatedAt: ago(1) }),
    task('memo', 'Draft investor memo for September', { dueAt: later, priority: 2, prioritySource: 'agent', agentPriority: 2, updatedAt: ago(2) }),
    task('jobb', 'Prep for Jobbsprånget', { status: 'proposed', label: 'gtm', sourceKey: 'inbox:calendar-1', updatedAt: ago(3) }),
    task('signed', 'Close the Q3 renewal', { status: 'done', completedAt: ago(5), updatedAt: ago(5), label: 'gtm',
      notes: 'Signed on Friday. Fjordline asked for the DPA as well, sent by Noor the same day.' }),
    task('dropped', 'Fjordline dinner', { status: 'dismissed', updatedAt: ago(1) }),
  ],
  taskLinks: [], taskFiles: [], routines: [], routineRuns: [], connectors: [], approvals: [], legacyMemoryCount: 0, memoryInstructions: '',
  codexStatus: 'Connected', engine: 'Claude Code', memoryProvider: 'gbrain', brainDir: null,
  triage: { state: 'idle', detail: '', lastRunAt: null },
  reminders: { enabled: false, list: '', state: 'off', detail: '', lastSyncAt: null }, launchAtLogin: false,
  browser: { enabled: false, status: 'disabled', detail: '', threadId: null },
  mcpSettings: { slackClientId: '', slackConfigured: false },
} as unknown as Snapshot;

const listeners = new Set<(event: AppEvent) => void>();
window.aegir = {
  snapshot: async () => structuredClone(data),
  onEvent: (listener: (event: AppEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  threadMessages: async () => ({ messages: [], before: null }),
  skillLibrary: async () => ({ skills: [], proposals: [], routineBindings: {} }),
  listDocuments: async () => [],
  runEvents: async () => [],
  claudeRoutines: async () => ({ source: null, tasks: [] }),
} as unknown as DesktopApi;

const { App } = await import('../App');
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultMode="light"><App /></ThemeProvider>);
