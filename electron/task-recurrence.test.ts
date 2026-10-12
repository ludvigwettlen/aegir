import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from './db.js';
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));
let root: string;
let store: Store;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2027, 0, 31, 12));
  root = mkdtempSync(join(tmpdir(), 'aegir-recurrence-'));
  store = new Store(join(root, 'test.sqlite'));
});
afterEach(() => { store.close(); rmSync(root, { recursive: true, force: true }); vi.useRealTimers(); });

describe('recurring task lifecycle', () => {
  it('creates a fresh occurrence with context and keeps history, month anchor and deduplication across restart', () => {
    const list = store.createTaskList('Work');
    const task = store.createTask({ title: 'Review', notes: 'Checklist', label: 'ops', listId: list.id, dueAt: '2027-01-31', recurrence: 'monthly', sourceUrl: 'https://example.com', sourceKey: 'source' });
    const thread = store.createThread(store.groups()[0].id, 'Review', 'task', task.id);
    store.updateTask(task.id, { threadId: thread.id, agentId: 'agent', outputDir: '/tmp/output', status: 'review' });
    store.addTaskLink(task.id, 'https://example.com/checklist');
    store.updateTask(task.id, { status: 'done' }, true);
    const completed = store.get('tasks', task.id)!;
    const next = store.get('tasks', completed.nextOccurrenceId!)!;
    expect(completed).toMatchObject({ status: 'done', threadId: thread.id, outputDir: '/tmp/output' });
    expect(next).toMatchObject({ title: 'Review', notes: 'Checklist', label: 'ops', listId: list.id, dueAt: '2027-02-28', recurrence: 'monthly', recurrenceAnchor: '2027-01-31', status: 'ready', threadId: null, agentId: null, outputDir: null, sourceKey: null, completedAt: null });
    expect(store.taskLinks(next.id).map(link => link.url)).toEqual(['https://example.com/checklist']);
    store.close(); store = new Store(join(root, 'test.sqlite'));
    store.updateTask(task.id, { status: 'done' });
    store.updateTask(task.id, { status: 'ready' });
    store.updateTask(task.id, { status: 'done' });
    expect(store.list('tasks')).toHaveLength(2);
    vi.setSystemTime(new Date(2027, 1, 28, 12));
    store.updateTask(next.id, { status: 'done' });
    expect(store.list('tasks').find(task => task.status === 'ready')?.dueAt).toBe('2027-03-31');
  });
  it('undoes completion and the generated task atomically, then allows completion again', () => {
    const task = store.createTask({ title: 'Review', recurrence: 'daily' });
    store.addTaskLink(task.id, 'https://example.com');
    store.updateTask(task.id, { status: 'done' }, true);
    const nextId = store.get('tasks', task.id)!.nextOccurrenceId!;
    store.undoTaskAction();
    expect(store.get('tasks', task.id)).toMatchObject({ status: 'ready', completedAt: null, nextOccurrenceId: null });
    expect(store.get('tasks', nextId)).toBeUndefined();
    expect(store.taskLinks(nextId)).toEqual([]);
    store.updateTask(task.id, { status: 'done' });
    expect(store.list('tasks')).toHaveLength(2);
  });
  it('protects changed future work when undoing completion', () => {
    const task = store.createTask({ title: 'Review', recurrence: 'daily' });
    store.updateTask(task.id, { status: 'done' }, true);
    const nextId = store.get('tasks', task.id)!.nextOccurrenceId!;
    store.updateTask(nextId, { notes: 'New work' });
    expect(() => store.undoTaskAction()).toThrow('next occurrence has changed');
    expect(store.get('tasks', task.id)?.status).toBe('done');
    expect(store.get('tasks', nextId)?.notes).toBe('New work');
  });
  it('supports undoing repeat settings, stopping repeats, deletion and restoration', () => {
    const task = store.createTask({ title: 'Review' });
    store.updateTask(task.id, { recurrence: 'weekly' }, true);
    expect(store.get('tasks', task.id)?.dueAt).toBe('2027-01-31');
    store.undoTaskAction();
    expect(store.get('tasks', task.id)).toMatchObject({ recurrence: null, dueAt: null, recurrenceAnchor: null });
    store.updateTask(task.id, { recurrence: 'monthly', dueAt: '2027-01-30' });
    store.deleteTask(task.id, true); store.undoTaskAction();
    expect(store.get('tasks', task.id)).toMatchObject({ recurrence: 'monthly', recurrenceAnchor: '2027-01-30' });
    store.updateTask(task.id, { recurrence: null }); store.updateTask(task.id, { status: 'done' });
    expect(store.list('tasks')).toHaveLength(1);
  });
  it('does not generate tasks for dismissal and validates repeat settings before mutation', () => {
    const task = store.createTask({ title: 'Review', recurrence: 'daily' });
    expect(() => store.updateTask(task.id, { recurrence: 'yearly' as any })).toThrow('Choose daily');
    expect(() => store.updateTask(task.id, { dueAt: '2027-02-30' })).toThrow('valid due date');
    expect(() => store.createTask({ title: 'Bad', recurrence: 'daily', dueAt: 'invalid' })).toThrow('valid due date');
    store.updateTask(task.id, { status: 'dismissed' });
    expect(store.list('tasks')).toHaveLength(1);
  });
  it('migrates existing tasks without changing their behavior', () => {
    store.close();
    const file = join(root, 'legacy.sqlite');
    const db = new Database(file);
    db.exec("CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,notes TEXT NOT NULL,status TEXT NOT NULL,agentId TEXT,sourceUrl TEXT,sourceKey TEXT UNIQUE,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL); INSERT INTO tasks VALUES('legacy','Keep me','','ready',NULL,NULL,NULL,'2027-01-01','2027-01-01')"); db.close();
    store = new Store(file);
    expect(store.get('tasks', 'legacy')).toMatchObject({ recurrence: null, recurrenceAnchor: null, nextOccurrenceId: null });
    store.updateTask('legacy', { status: 'done' });
    expect(store.list('tasks')).toHaveLength(1);
  });
});
