import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { AppEvent, DesktopApi, Snapshot, Task } from '../../../shared/types';
import { isoDate } from '../../../shared/tasks';
import { fold, searchWords, snippetFor } from '../../../shared/task-search';

// Isolated fixture for searching tasks in ⌘K: tasks on every list, a finished one and a dismissed one, a conversation
// and a document.
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
    task('offsite', 'Set up the Harbourline offsite', { label: 'ops', updatedAt: ago(4) }),
  ],
  taskLinks: [], taskFiles: [], routines: [], routineRuns: [], connectors: [], approvals: [], legacyMemoryCount: 0, memoryInstructions: '',
  codexStatus: 'Connected', engine: 'Claude Code', memoryProvider: 'gbrain', brainDir: null,
  triage: { state: 'idle', detail: '', lastRunAt: null },
  reminders: { enabled: false, list: '', state: 'off', detail: '', lastSyncAt: null }, launchAtLogin: false,
  browser: { enabled: false, status: 'disabled', detail: '', threadId: null },
  mcpSettings: { slackClientId: '', slackConfigured: false },
} as unknown as Snapshot;

// What was said in the memo and deck tasks' conversations, and a document in the deck's folder; none of it is in a
// task's title or context.
const conversation = [
  { id: 'm1', taskId: 'memo', role: 'agent', text: 'Fjelltek signed the renewal on Friday, so the memo can lead with it.' },
  { id: 'm2', taskId: 'deck', role: 'user', text: 'Put the churn slide last.' },
];
const documents = [{ taskId: 'deck', path: 'drafts/board-deck-outline.md', text: '# Outline\nSlide 4: churn by cohort, then the Lidingö pilot.' }];
let release: (() => void) | null = null;
const fixture = { hold: false, waiting: false, release: () => release?.() };
Object.assign(window, { fixture });

const listeners = new Set<(event: AppEvent) => void>();
window.aegir = {
  snapshot: async () => structuredClone(data),
  onEvent: (listener: (event: AppEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  threadMessages: async () => ({ messages: [], before: null }),
  skillLibrary: async () => ({ skills: [], proposals: [], routineBindings: {} }),
  listDocuments: async () => [],
  runEvents: async () => [],
  claudeRoutines: async () => ({ source: null, tasks: [] }),
  // Stands in for the app's database: which searched words each task's conversation and documents hold, quoting the
  // place that holds the most.
  searchTaskContent: async (query: string) => {
    if (fixture.hold) { fixture.waiting = true; await new Promise<void>((done) => { release = done; }); fixture.waiting = false; }
    const words = searchWords(query);
    const places = [
      ...conversation.map((message) => ({ ...message, where: 'conversation', document: null })),
      ...documents.map((document) => ({ ...document, id: null, role: null, where: 'document', document: document.path })),
    ].map((place) => ({ ...place, held: words.flatMap((word, index) => (!word.startsWith('#') && fold(place.text).includes(word) ? [index] : [])) }))
      .filter((place) => place.held.length);
    const tasks = [...new Set(places.map((place) => place.taskId))];
    return tasks.map((taskId) => {
      const mine = places.filter((place) => place.taskId === taskId);
      const best = mine.reduce((top, place) => (place.held.length > top.held.length ? place : top));
      return {
        taskId, words: [...new Set(mine.flatMap((place) => place.held))].sort(), where: best.where, document: best.document,
        role: best.role, agentId: best.role === 'agent' ? 'lead' : null, draft: false, messageId: best.id,
        snippet: snippetFor(best.text, ...best.held.map((index) => words[index])) || best.text,
      };
    });
  },
} as unknown as DesktopApi;

const { App } = await import('../App');
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultMode="light"><App /></ThemeProvider>);
