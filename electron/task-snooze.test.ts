import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { Store } from './db.js';
import { isoDate, tasksFor } from '../shared/tasks.js';
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));
it('keeps deadlines and priorities, supports persistence/undo and restores visibility on the local wake date', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aegir-snooze-')), file = join(dir, 'db'); let store = new Store(file);
  try {
    const today = new Date(), tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const task = store.createTask({ title: 'Deadline stays', dueAt: isoDate(today), listId: null });
    store.updateTask(task.id, { priority: 1 }); store.updateTask(task.id, { snoozedUntil: isoDate(tomorrow) }, true);
    let saved = store.get('tasks', task.id)!;
    expect(saved).toMatchObject({ dueAt: isoDate(today), priority: 1, snoozedUntil: isoDate(tomorrow) });
    for (const view of ['inbox', 'today', 'needs', 'team'] as const) expect(tasksFor(view, [saved], today)).toEqual([]);
    expect(tasksFor('upcoming', [saved], today)).toHaveLength(1);
    expect(tasksFor('today', [saved], tomorrow)).toHaveLength(1);
    store.undoTaskAction(); expect(store.get('tasks', task.id)?.snoozedUntil).toBeNull();
    store.updateTask(task.id, { snoozedUntil: isoDate(tomorrow) }); store.deleteTask(task.id, true); store.undoTaskAction();
    expect(store.get('tasks', task.id)?.snoozedUntil).toBe(isoDate(tomorrow));
    store.close(); store = new Store(file); saved = store.get('tasks', task.id)!;
    expect(saved.snoozedUntil).toBe(isoDate(tomorrow));
    store.updateTask(task.id, { snoozedUntil: null }); expect(tasksFor('today', [store.get('tasks', task.id)!], today)).toHaveLength(1);
    expect(() => store.updateTask(task.id, { snoozedUntil: '2026-02-30' })).toThrow();
    expect(() => store.updateTask(task.id, { snoozedUntil: isoDate(today) })).toThrow('future');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
