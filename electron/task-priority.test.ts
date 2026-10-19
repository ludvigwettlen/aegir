import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { Store } from './db';
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));
it('migrates manual priorities, preserves them across restarts and supports edit/delete undo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aegir-priority-')); const file = join(dir, 'db.sqlite'); let store = new Store(file);
  try {
    const task = store.createTask({ title: 'Manual priority' });
    store.db.exec('ALTER TABLE tasks DROP COLUMN priority'); store.close(); store = new Store(file);
    expect(store.get('tasks', task.id)?.priority).toBeNull();
    store.updateTask(task.id, { priority: 1 }, true); store.updateTask(task.id, { priority: 3 }, true);
    store.undoTaskAction(); expect(store.get('tasks', task.id)?.priority).toBe(1);
    expect(() => store.updateTask(task.id, { priority: 4 as 1 })).toThrow('Choose P1');
    store.deleteTask(task.id, true); store.undoTaskAction(); expect(store.get('tasks', task.id)?.priority).toBe(1);
    store.close(); store = new Store(file); expect(store.get('tasks', task.id)?.priority).toBe(1);
    store.updateTask(task.id, { priority: null }); expect(store.get('tasks', task.id)?.priority).toBeNull();
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
