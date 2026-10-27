import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { Store } from './db.js';
import { defaultTaskFilter } from '../shared/task-filters.js';
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));
it('persists, renames, scopes and deletes views without changing their tasks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aegir-views-')); let store = new Store(join(dir, 'db'));
  try {
    const list = store.createTaskList('Work'); const task = store.createTask({ title: 'Memo', labels: ['work', 'board'], listId: list.id });
    const view = { id: 'board', name: 'Board work', scope: `list:${list.id}`, filter: { ...defaultTaskFilter, labels: ['work','board'], labelMode: 'all' } };
    store.saveTaskView(view); store.close(); store = new Store(join(dir, 'db'));
    expect(store.taskViews()[0]).toMatchObject({ id: 'board', name: 'Board work', scope: view.scope, filter: { labels: ['work','board'] } });
    store.saveTaskView({ ...view, name: 'Updated board view', scope: 'all' });
    expect(store.taskViews()).toHaveLength(1); expect(store.taskViews()[0].name).toBe('Updated board view');
    expect(() => store.saveTaskView({ ...view, scope: 'list:missing' })).toThrow('no longer exists');
    store.deleteTaskView(view.id); expect(store.taskViews()).toEqual([]);
    expect(store.get('tasks', task.id)).toMatchObject({ title: 'Memo', labels: ['work','board'], listId: list.id });
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
