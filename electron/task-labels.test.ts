import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { Store } from './db.js';
import { taskLabels } from '../shared/task-labels.js';
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));
it('migrates old labels, persists multiple labels, preserves them through recurrence and supports Undo', () => {
  const root = mkdtempSync(join(tmpdir(), 'aegir-labels-')); let store = new Store(join(root, 'db'));
  try {
    const old = store.createTask({ title: 'Legacy task', label: 'work', dueAt: '2099-12-31', recurrence: 'weekly' });
    // Reopen a database in the shape used before multiple labels existed.
    store.db.exec('ALTER TABLE tasks DROP COLUMN labels'); store.close(); store = new Store(join(root, 'db'));
    expect(store.get('tasks', old.id)?.labels).toEqual(['work']);
    store.updateTask(old.id, { labels: ['#Work', 'board', 'work'] }, true);
    expect(store.get('tasks', old.id)).toMatchObject({ label: 'work', labels: ['work', 'board'] });
    store.undoTaskAction(); expect(taskLabels(store.get('tasks', old.id)!)).toEqual(['work']);
    store.updateTask(old.id, { labels: ['work', 'board'] });
    store.updateTask(old.id, { label: 'urgent' }); expect(store.get('tasks', old.id)?.labels).toEqual(['urgent', 'board']);
    store.deleteTask(old.id, true); store.undoTaskAction(); expect(store.get('tasks', old.id)?.labels).toEqual(['urgent', 'board']);
    store.updateTask(old.id, { status: 'done' }, true);
    expect(store.list('tasks').find(task => task.id !== old.id)?.labels).toEqual(['urgent', 'board']);
    store.undoTaskAction(); expect(store.list('tasks')).toHaveLength(1);
    store.close(); store = new Store(join(root, 'db')); expect(store.get('tasks', old.id)?.labels).toEqual(['urgent', 'board']);
    expect(() => store.updateTask(old.id, { labels: ['x'.repeat(41)] })).toThrow('40');
    expect(() => store.updateTask(old.id, { labels: Array(21).fill('work') })).toThrow('20');
    store.updateTask(old.id, { labels: [] }); expect(store.get('tasks', old.id)).toMatchObject({ label: null, labels: [] });
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
