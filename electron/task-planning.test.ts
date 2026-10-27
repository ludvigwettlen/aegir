import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { Store } from './db.js';
import { isoDate, tasksFor } from '../shared/tasks.js';
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));
it('sets today as the deadline, clears snooze and supports undo with repeating tasks in custom lists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aegir-today-')); const store = new Store(join(dir, 'db'));
  try {
    const list = store.createTaskList('Work'), today = isoDate(new Date());
    const task = store.createTask({ title: 'Due today', listId: list.id, dueAt: '2099-12-31', recurrence: 'weekly' });
    store.updateTask(task.id, { priority: 1, snoozedUntil: '2099-11-30' });
    store.updateTask(task.id, { dueAt: today, snoozedUntil: null }, true);
    const saved = store.get('tasks', task.id)!;
    expect(saved).toMatchObject({ dueAt: today, snoozedUntil: null, priority: 1, listId: list.id, recurrence: 'weekly', recurrenceAnchor: today });
    expect(tasksFor('today', [saved])).toHaveLength(1);
    store.undoTaskAction();
    expect(store.get('tasks', task.id)).toMatchObject({ dueAt: '2099-12-31', snoozedUntil: '2099-11-30', recurrenceAnchor: '2099-12-31' });
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
