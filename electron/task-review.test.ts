import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { Store } from './db';
import { tasksFor } from '../shared/tasks';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));

it.each(['review', 'blocked'] as const)('clears %s attention without completing work, losing context or generating a repeat; supports undo and restart', status => {
  const dir = mkdtempSync(join(tmpdir(), 'aegir-review-'));
  const path = join(dir, 'db.sqlite'); let store = new Store(path);
  try {
    const list = store.createTaskList('Work');
    const task = store.createTask({ title: 'Review proposal', notes: 'Keep context', listId: list.id, recurrence: 'weekly', dueAt: '2026-10-20' });
    const group = store.groups()[0];
    const thread = store.createThread(group.id, task.title, 'task', task.id);
    store.addMessage(thread.id, group.leadAgentId, 'agent', 'Proposal ready', 'complete');
    store.updateTask(task.id, { status, threadId: thread.id, agentId: group.leadAgentId, outputDir: '/tmp/proposal', priority: 2 });
    const before = store.get('tasks', task.id)!;
    store.markTaskReviewed(task.id);
    expect(store.get('tasks', task.id)).toMatchObject({ ...before, status: 'ready', completedAt: null, updatedAt: expect.any(String) });
    expect(tasksFor('needs', store.list('tasks'))).toHaveLength(0);
    expect(tasksFor('team', store.list('tasks')).map(task => task.id)).toContain(task.id);
    expect(tasksFor(`list:${list.id}`, store.list('tasks')).map(task => task.id)).toContain(task.id);
    expect(tasksFor('completed', store.list('tasks'))).toHaveLength(0);
    expect(store.list('tasks')).toHaveLength(1);
    expect(store.messagesForThread(thread.id).map(message => message.content)).toEqual(['Proposal ready']);
    store.undoTaskAction();
    expect(store.get('tasks', task.id)?.status).toBe(status);
    store.markTaskReviewed(task.id);
    store.close(); store = new Store(path);
    expect(store.get('tasks', task.id)).toMatchObject({ status: 'ready', threadId: thread.id, completedAt: null });
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('rejects stale actions, running tasks and suggestions without changing their state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aegir-review-')); const store = new Store(join(dir, 'db.sqlite'));
  try {
    for (const status of ['ready', 'running', 'proposed', 'done', 'dismissed'] as const) {
      const task = store.createTask({ title: status, status });
      expect(() => store.markTaskReviewed(task.id)).toThrow('no longer waiting');
      expect(store.get('tasks', task.id)?.status).toBe(status);
    }
    const stale = store.createTask({ title: 'New run', status: 'review' });
    store.updateTask(stale.id, { status: 'running' });
    expect(() => store.markTaskReviewed(stale.id)).toThrow('no longer waiting');
    expect(store.get('tasks', stale.id)?.status).toBe('running');
    expect(store.undoTaskAction()).toBeNull();
    expect(() => store.markTaskReviewed('missing')).toThrow('Task not found');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
