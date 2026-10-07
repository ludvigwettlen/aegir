import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Task } from '../shared/types.js';
import { exportPriorityEvents, exportTasks, importInbox, parseInboxItem, renderTaskExport } from './brain-bridge.js';

function fakeStore() {
  const tasks: Task[] = [];
  return {
    tasks,
    hasTaskSource: (key: string) => tasks.some((task) => task.sourceKey === key),
    taskBySource: (key: string) => tasks.find((task) => task.sourceKey === key),
    createTask: (input: Parameters<import('./db.js').Store['createTask']>[0]) => {
      const task = { id: String(tasks.length + 1), notes: '', status: 'ready', ...input } as Task;
      tasks.push(task);
      return task;
    },
    updateTask: (id: string, change: Partial<Task>) => { Object.assign(tasks.find((task) => task.id === id)!, change); },
  };
}
function drop(dir: string, name: string, value: unknown, ageMs = 10_000) {
  const path = join(dir, name);
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
  const then = new Date(Date.now() - ageMs);
  utimesSync(path, then, then);
  return path;
}

describe('suggestion inbox', () => {
  it('validates suggestions', () => {
    expect(parseInboxItem({ title: ' Reply to Anna ', label: '#GTM', dueAt: '2026-10-07' })).toMatchObject({ title: 'Reply to Anna', label: 'gtm', dueAt: '2026-10-07' });
    expect(() => parseInboxItem({ title: '' })).toThrow(/title/);
    expect(() => parseInboxItem({ title: 'x', sourceUrl: 'javascript:alert(1)' })).toThrow(/sourceUrl/);
    expect(() => parseInboxItem({ title: 'x', dueAt: 'tomorrow' })).toThrow(/dueAt/);
    expect(() => parseInboxItem({ title: 'x', sourceKey: 'bad key with spaces' })).toThrow(/sourceKey/);
  });

  it('imports once per source key, keeps young files, and quarantines bad ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aegir-inbox-'));
    const store = fakeStore();
    drop(dir, 'a.json', [{ title: 'Reply to Anna', sourceKey: 'gmail-malcolm-1a0c3d33', notes: 'Draft attached' }, { title: 'Prep Nordvik', sourceUrl: 'https://calendar.google.com/x' }]);
    drop(dir, 'b.json', { title: 'Reply to Anna again', sourceKey: 'gmail-malcolm-1a0c3d33' });
    drop(dir, 'c.json', '{ not json');
    const young = drop(dir, 'd.json', { title: 'Still being written' }, 0);
    drop(dir, 'e.md', '---\ntitle: "Prep for Greenfield, Tue 10:00"\nsourceKey: calendar-abc123def456\nlabel: Investor\ndueAt: 2026-10-06\n---\n#### Recommendation: enrich\n- Two partners have no brain page.\n');
    drop(dir, 'f.md', 'no header here');
    expect(importInbox(store, dir)).toEqual({ created: 3, skipped: 1, rejected: 2, updated: 0, closed: 0 });
    expect(store.tasks[2]).toMatchObject({ title: 'Prep for Greenfield, Tue 10:00', label: 'investor', dueAt: '2026-10-06', notes: '#### Recommendation: enrich\n- Two partners have no brain page.', sourceKey: 'inbox:calendar-abc123def456' });
    expect(store.tasks.map((task) => [task.title, task.status])).toEqual([['Reply to Anna', 'proposed'], ['Prep Nordvik', 'proposed'], ['Prep for Greenfield, Tue 10:00', 'proposed']]);
    expect(store.tasks[0].sourceKey).toBe('inbox:gmail-malcolm-1a0c3d33');
    expect(existsSync(join(dir, 'processed', 'a.json'))).toBe(true);
    expect(readFileSync(join(dir, 'rejected', 'c.json.error.txt'), 'utf8')).toMatch(/JSON/);
    expect(existsSync(young)).toBe(true);
  });

  it('closes suggestions the user already acted on, after importing the same pass', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aegir-inbox-'));
    const store = fakeStore();
    drop(dir, 'a-close.md', '---\nclose: slack-C1-123\nreason: Replied in the thread\n---\n');
    drop(dir, 'b.json', [{ title: 'Reply to Maja', sourceKey: 'slack-C1-123', notes: 'Context' }, { title: 'Prep Nordvik', sourceKey: 'cal-nordvik' }, { title: 'Read memo', sourceKey: 'gmail-9' }]);
    drop(dir, 'c-close.json', [{ close: 'cal-nordvik' }, { close: 'never-seen', reason: 'gone' }]);
    expect(importInbox(store, dir)).toEqual({ created: 3, skipped: 1, rejected: 0, updated: 0, closed: 2 });
    expect(store.tasks.map((task) => [task.title, task.status])).toEqual([['Reply to Maja', 'done'], ['Prep Nordvik', 'done'], ['Read memo', 'proposed']]);
    expect(store.tasks[0].notes).toBe('Context\n\nClosed automatically: Replied in the thread');
    expect(store.tasks[1].notes).toBe('Closed automatically: acted on at the source');
    expect(existsSync(join(dir, 'processed', 'a-close.md'))).toBe(true);
    expect(existsSync(join(dir, 'processed', 'c-close.json'))).toBe(true);
    expect(store.tasks).toHaveLength(3);
  });

  it('leaves tasks the user or an agent has moved on, and rejects malformed closes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aegir-inbox-'));
    const store = fakeStore();
    for (const [key, status] of [['r', 'running'], ['v', 'review'], ['b', 'blocked'], ['d', 'dismissed'], ['t', 'ready']] as const)
      store.tasks.push({ id: key, title: key, notes: '', status, sourceKey: `inbox:${key}` } as Task);
    drop(dir, 'a.json', ['r', 'v', 'b', 'd', 't'].map((close) => ({ close })));
    drop(dir, 'b.json', { close: 'x', title: 'Both' });
    drop(dir, 'c.md', '---\nclose: bad key\n---\n');
    expect(importInbox(store, dir)).toEqual({ created: 0, skipped: 4, rejected: 2, updated: 0, closed: 1 });
    expect(store.tasks.map((task) => task.status)).toEqual(['running', 'review', 'blocked', 'dismissed', 'done']);
    expect(readFileSync(join(dir, 'rejected', 'b.json.error.txt'), 'utf8')).toMatch(/title/);
    expect(readFileSync(join(dir, 'rejected', 'c.md.error.txt'), 'utf8')).toMatch(/close/);
  });
});

describe('suggestion updates', () => {
  const now = Date.now();

  it('rewrites a waiting suggestion and keeps what the user wrote on an accepted task', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aegir-inbox-'));
    const store = fakeStore();
    store.tasks.push(
      { id: 'p', title: 'Reply to Anna', notes: 'Old draft', label: 'gtm', dueAt: null, status: 'proposed', sourceKey: 'inbox:gmail-1' } as Task,
      { id: 'r', title: 'My own title', notes: 'My notes', label: 'board', dueAt: '2026-10-09', status: 'ready', sourceKey: 'inbox:gmail-2' } as Task,
    );
    drop(dir, 'a.md', '---\nupdate: gmail-1\nreason: Anna sent the signed contract\ntitle: "File Anna\'s signed contract"\ndueAt: 2026-10-07\n---\n#### Recommendation: file it\n- Signed today.\n', 10_000);
    drop(dir, 'b.md', '---\nupdate: gmail-2\nreason: Bea replied\ntitle: Ignored\ndueAt: 2026-12-01\n---\nNew draft v1\n', 10_000);
    expect(importInbox(store, dir, now)).toMatchObject({ updated: 2, rejected: 0 });
    expect(store.tasks[0]).toMatchObject({ title: "File Anna's signed contract", dueAt: '2026-10-07', label: 'gtm', status: 'proposed' });
    expect(store.tasks[0].notes).toMatch(/^Updated \d+ \w+.*: Anna sent the signed contract\n\n#### Recommendation: file it/);
    expect(store.tasks[1]).toMatchObject({ title: 'My own title', dueAt: '2026-10-09', label: 'board', status: 'ready' });
    expect(store.tasks[1].notes).toMatch(/^My notes\n\n#### Latest from the sweep\nUpdated .*: Bea replied\n\nNew draft v1$/);

    drop(dir, 'c.md', '---\nupdate: gmail-2\nreason: Bea signed off\n---\n', 10_000);
    importInbox(store, dir, now);
    expect(store.tasks[1].notes).toMatch(/^My notes\n\n#### Latest from the sweep\nUpdated .*: Bea signed off$/);
  });

  it('leaves tasks an agent holds or that are finished, and rejects malformed updates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aegir-inbox-'));
    const store = fakeStore();
    for (const status of ['running', 'review', 'blocked', 'done', 'dismissed'] as const)
      store.tasks.push({ id: status, title: status, notes: 'n', status, sourceKey: `inbox:${status}` } as Task);
    drop(dir, 'a.json', [...store.tasks.map((task) => ({ update: task.id, reason: 'moved' })), { update: 'never-seen', reason: 'x' }]);
    drop(dir, 'b.json', { update: 'x', close: 'x' });
    drop(dir, 'c.md', '---\nupdate: x\n---\n');
    drop(dir, 'd.md', '---\nupdate: bad key\nreason: y\n---\n');
    expect(importInbox(store, dir, now)).toEqual({ created: 0, skipped: 6, rejected: 3, updated: 0, closed: 0 });
    expect(store.tasks.every((task) => task.notes === 'n')).toBe(true);
  });

  it('updates a suggestion created earlier in the same pass, then lets a close finish it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aegir-inbox-'));
    const store = fakeStore();
    drop(dir, 'a.json', { title: 'Prep Nordvik', sourceKey: 'cal-nordvik', notes: 'v1' });
    drop(dir, 'b.json', { update: 'cal-nordvik', notes: 'v2' });
    drop(dir, 'c.json', { close: 'cal-nordvik', reason: 'Meeting passed' });
    expect(importInbox(store, dir, now)).toMatchObject({ created: 1, updated: 1, closed: 1 });
    expect(store.tasks[0].status).toBe('done');
    expect(store.tasks[0].notes).toMatch(/v2\n\nClosed automatically: Meeting passed$/);
  });
});

describe('task export', () => {
  const base = { notes: '', label: null, dueAt: null, agentId: null, threadId: null, outputDir: null, sourceUrl: null, sourceKey: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', completedAt: null, priority: null, prioritySource: null, agentPriority: null, priorityReason: null, prioritySetAt: null, priorityCheckedAt: null };
  const tasks = [
    { ...base, id: '1', title: 'Approve Q4 hiring plan', status: 'proposed', notes: 'From Maja\nSecond line', sourceUrl: 'https://mail.google.com/x' },
    { ...base, id: '2', title: 'Board deck', status: 'ready', label: 'board', dueAt: '2026-10-05' },
    { ...base, id: '3', title: 'Old thing', status: 'dismissed' },
  ] as Task[];

  it('groups tasks the way the app does', () => {
    const markdown = renderTaskExport(tasks, new Date('2026-10-05T10:00:00'));
    expect(markdown).toContain('## Needs you (1)');
    expect(markdown).toContain('**Approve Q4 hiring plan** · suggested · [source](https://mail.google.com/x)\n  From Maja');
    expect(markdown).toContain('## Today (1)');
    expect(markdown).toContain('**Board deck** · to do · #board · due 2026-10-05');
    expect(markdown).not.toContain('Old thing');
  });

  // The sweeps and daily-brief read legolas-tasks.json, so what is attached has to be in it.
  it('lists a task\'s files with absolute paths, and the brain copy once it is filed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aegir-export-files-'));
    expect(exportTasks(tasks, dir, [
      { taskId: '1', name: 'pack.pdf', path: '/Users/m/Documents/Legolas/board-abc123/attachments/pack.pdf', bytes: 2_517_291, brainPath: '/Users/m/brain/sources/q3-close/.raw/pack.pdf' },
    ])).toBe(true);
    const exported = JSON.parse(readFileSync(join(dir, 'legolas-tasks.json'), 'utf8')) as (Task & { files?: unknown[] })[];
    expect(exported.find(task => task.id === '1')?.files).toEqual([
      { name: 'pack.pdf', path: '/Users/m/Documents/Legolas/board-abc123/attachments/pack.pdf', bytes: 2_517_291, brainPath: '/Users/m/brain/sources/q3-close/.raw/pack.pdf' },
    ]);
    expect(exported.find(task => task.id === '2')).not.toHaveProperty('files');
  });

  it('puts the most important task first in each section and says who set its priority', () => {
    const ranked = [
      { ...base, id: 'a', title: 'Read the Cognition piece', status: 'ready', priority: 3, prioritySource: 'agent' },
      { ...base, id: 'b', title: 'Investor AB follow-up', status: 'ready', priority: 1, prioritySource: 'user' },
      { ...base, id: 'c', title: 'Webinar talking points', status: 'ready', priority: 2, prioritySource: 'agent' },
    ] as Task[];
    const markdown = renderTaskExport(ranked, new Date('2026-10-05T10:00:00'));
    const inbox = markdown.slice(markdown.indexOf('## Inbox'));
    expect(inbox.indexOf('Investor AB')).toBeLessThan(inbox.indexOf('Webinar'));
    expect(inbox.indexOf('Webinar')).toBeLessThan(inbox.indexOf('Cognition'));
    expect(markdown).toContain('- P1 · **Investor AB follow-up** · to do');
    expect(markdown).toContain('- P2 (Claude) · **Webinar talking points** · to do');
  });

  it('writes the priority log for the weekly eval, only when it changed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aegir-events-'));
    const events = [{ id: 'e1', taskId: 'b', at: '2026-10-07T08:00:00Z', kind: 'band', actor: 'user', priority: 1, previous: 2, previousActor: 'agent', agentPriority: 2, reason: 'Can wait', runId: null, p1Free: null, title: 'Investor AB follow-up', label: null, dueAt: null, status: 'ready', source: 'reminders', notes: '' }] as const;
    expect(exportPriorityEvents([...events], dir)).toBe(true);
    expect(exportPriorityEvents([...events], dir)).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, 'legolas-priority-events.json'), 'utf8'))).toEqual(events);
    expect(exportPriorityEvents([], join(dir, 'missing'))).toBe(false);
  });

  it('writes only when something changed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aegir-export-'));
    expect(exportTasks(tasks, dir)).toBe(true);
    expect(exportTasks(tasks, dir)).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, 'legolas-tasks.json'), 'utf8')).map((task: Task) => task.id)).toEqual(['1', '2']);
    expect(exportTasks(tasks, join(dir, 'missing'))).toBe(false);
  });
});
