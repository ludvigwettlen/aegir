import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { AppEvent, DesktopApi, Snapshot, Task, TaskChange } from '../../../shared/types';
const now = new Date().toISOString();
const task = { id: 'original', title: 'Plan launch', notes: 'Keep this context', listId: null, status: 'ready', threadId: null, dueAt: null, label: null, createdAt: now, updatedAt: now } as Task;
let data = { agents: [], groups: [], threads: [], tasks: [task], taskLists: [], taskLinks: [], routines: [], approvals: [], connectors: [], routineRuns: [] } as unknown as Snapshot;
const listeners = new Set<(event: AppEvent) => void>();
const publish = () => { data = structuredClone(data); listeners.forEach(listener => listener({ type: 'snapshot', value: data })); };
const undo: { id: string; before: TaskChange }[] = [];
const fixture = { fail: false, delay: 0 };
Object.assign(window, { fixture });
const check = async () => { if (fixture.delay) await new Promise(resolve => setTimeout(resolve, fixture.delay)); if (fixture.fail) throw new Error('Could not save list'); };
window.aegir = {
  snapshot: async () => data,
  onEvent: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  createTaskList: async name => { await check(); const list = { id: crypto.randomUUID(), name, createdAt: now }; data.taskLists.push(list); publish(); return list; },
  renameTaskList: async (id, name) => { await check(); data.taskLists.find(list => list.id === id)!.name = name; publish(); },
  deleteTaskList: async id => { await check(); data.taskLists = data.taskLists.filter(list => list.id !== id); data.tasks.forEach(task => { if (task.listId === id) task.listId = null; }); publish(); },
  createTask: async input => { const added = { ...task, ...input, id: crypto.randomUUID() }; data.tasks.push(added); publish(); return added; },
  updateTask: async (id, change) => { await check(); const task = data.tasks.find(task => task.id === id)!; undo.push({ id, before: { listId: task.listId } }); Object.assign(task, change); publish(); },
  undoTaskAction: async () => { const action = undo.pop(); if (!action) return null; Object.assign(data.tasks.find(task => task.id === action.id)!, action.before); publish(); return { taskId: action.id, action: 'task edit' }; },
} as DesktopApi;
const { App } = await import('../App');
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultMode="light"><App /></ThemeProvider>);
