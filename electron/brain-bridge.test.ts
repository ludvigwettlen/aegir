import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Task } from '../shared/types.js';
import { exportTasks, importInbox, parseInboxItem, renderTaskExport } from './brain-bridge.js';

function fakeStore() {
  const tasks: Array<Parameters<import('./db.js').Store['createTask']>[0]> = [];
  return {
    tasks,
    hasTaskSource: (key: string) => tasks.some((task) => task.sourceKey === key),
    createTask: (input: (typeof tasks)[number]) => { tasks.push(input); return input as unknown as Task; },
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
    expect(importInbox(store, dir)).toEqual({ created: 3, skipped: 1, rejected: 2 });
    expect(store.tasks[2]).toMatchObject({ title: 'Prep for Greenfield, Tue 10:00', label: 'investor', dueAt: '2026-10-06', notes: '#### Recommendation: enrich\n- Two partners have no brain page.', sourceKey: 'inbox:calendar-abc123def456' });
    expect(store.tasks.map((task) => [task.title, task.status])).toEqual([['Reply to Anna', 'proposed'], ['Prep Nordvik', 'proposed'], ['Prep for Greenfield, Tue 10:00', 'proposed']]);
    expect(store.tasks[0].sourceKey).toBe('inbox:gmail-malcolm-1a0c3d33');
    expect(existsSync(join(dir, 'processed', 'a.json'))).toBe(true);
    expect(readFileSync(join(dir, 'rejected', 'c.json.error.txt'), 'utf8')).toMatch(/JSON/);
    expect(existsSync(young)).toBe(true);
  });
});

describe('task export', () => {
  const base = { notes: '', label: null, dueAt: null, agentId: null, threadId: null, outputDir: null, sourceUrl: null, sourceKey: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', completedAt: null };
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

  it('writes only when something changed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aegir-export-'));
    expect(exportTasks(tasks, dir)).toBe(true);
    expect(exportTasks(tasks, dir)).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, 'legolas-tasks.json'), 'utf8')).map((task: Task) => task.id)).toEqual(['1', '2']);
    expect(exportTasks(tasks, join(dir, 'missing'))).toBe(false);
  });
});
