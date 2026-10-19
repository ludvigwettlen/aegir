import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { AppEvent, DesktopApi, Snapshot, Task } from '../../../shared/types';
const now = new Date().toISOString();
const task = (id: string, title: string, change: Partial<Task> = {}): Task => ({ id, title, notes: '', label: null, dueAt: null, listId: null, status: 'ready', threadId: null, outputDir: null, agentId: null, sourceUrl: null, sourceKey: null, createdAt: now, updatedAt: now, completedAt: null, recurrence: null, recurrenceAnchor: null, nextOccurrenceId: null, ...change });
let data = {
  agents: [], groups: [], threads: [], tasks: [task('first', 'Current work'), task('filed', 'Åsne annual renewal', { listId: 'project', label: 'board' }), task('done', 'Archived decision', { status: 'done' }), task('doc', 'Research memo'), task('dismissed', 'Dismissed decision', { status: 'dismissed' })],
  taskLists: [{ id: 'project', name: 'Projects', createdAt: now }], taskLinks: [], routines: [], approvals: [], connectors: [], routineRuns: [],
} as unknown as Snapshot;
let changed: ((event: AppEvent) => void) | undefined;
const fixture = { queries: [] as string[], fail: false, changes: [] as string[] };
Object.assign(window, { fixture });
window.aegir = {
  snapshot: async () => data,
  onEvent: callback => { changed = callback; return () => { changed = undefined; }; },
  updateTask: async (id, change) => { fixture.changes.push(id); data = { ...data, tasks: data.tasks.map(t => t.id === id ? { ...t, ...change } : t) }; changed?.({ type: 'snapshot', value: data }); },
  searchTaskContent: async query => {
    fixture.queries.push(query);
    await new Promise(resolve => setTimeout(resolve, query === 'old' ? 600 : 100));
    if (fixture.fail) throw new Error('Search unavailable');
    return ['contract', 'old'].includes(query) ? [{ taskId: 'doc', where: 'document', document: 'memo.md', words: [0], snippet: 'The contract was renewed', messageId: null, role: null, agentId: null, draft: false }] : [];
  },
} as DesktopApi;
const { App } = await import('../App');
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultMode="light"><App /></ThemeProvider>);
