import { describe, expect, it } from 'vitest';
import { parseDue, parseQuickAdd, taskCursor, tasksFor } from './tasks.js';
import type { Task } from './types.js';

const saturday = new Date(2026, 8, 26);
describe('quick add', () => {
  it('extracts a label and a due date and keeps the rest as the title', () => {
    expect(parseQuickAdd('Summarise calls #Customers fri', saturday)).toEqual({ title: 'Summarise calls', label: 'customers', dueAt: '2026-10-02' });
  });
  it('treats a weekday as the next occurrence, including today', () => {
    expect(parseDue('sat', saturday)).toBe('2026-09-26');
    expect(parseDue('monday', saturday)).toBe('2026-09-28');
    expect(parseDue('tomorrow', saturday)).toBe('2026-09-27');
    expect(parseDue('wednesday', saturday)).toBe('2026-09-30');
    expect(parseDue('tues', saturday)).toBe('2026-09-29');
  });
  it('leaves ordinary words alone', () => {
    expect(parseQuickAdd('Monitor #ops dashboards', saturday)).toEqual({ title: 'Monitor dashboards', label: 'ops', dueAt: null });
  });
});

describe('task lists', () => {
  const base: Task = { id: '', title: '', notes: '', label: null, dueAt: null, status: 'ready', agentId: null, threadId: null, outputDir: null, sourceUrl: null, sourceKey: null, createdAt: '', updatedAt: '', completedAt: null };
  const tasks: Task[] = [
    { ...base, id: 'undated' }, { ...base, id: 'later', dueAt: '2026-10-02' }, { ...base, id: 'overdue', dueAt: '2026-09-20' },
    { ...base, id: 'suggested', status: 'proposed' }, { ...base, id: 'blocked', status: 'blocked', threadId: 't' }, { ...base, id: 'done', status: 'done', completedAt: '2026-09-25' }, { ...base, id: 'recently-done', status: 'done', completedAt: '2026-09-26' }
  ];
  it('splits inbox, today, upcoming, team and needs-you', () => {
    expect(tasksFor('inbox', tasks, saturday).map(x => x.id)).toEqual(['undated', 'blocked']);
    expect(tasksFor('today', tasks, saturday).map(x => x.id)).toEqual(['overdue']);
    expect(tasksFor('upcoming', tasks, saturday).map(x => x.id)).toEqual(['later']);
    expect(tasksFor('team', tasks, saturday).map(x => x.id)).toEqual(['blocked']);
    expect(tasksFor('needs', tasks, saturday).map(x => x.id)).toEqual(['suggested', 'blocked']);
    expect(tasksFor('completed', tasks, saturday).map(x => x.id)).toEqual(['recently-done', 'done']);
  });
  it.each(['ready', 'dismissed'] as const)('advances past a proposal changed to %s instead of jumping to review', status => {
    const before: Task[] = [
      { ...base, id: 'review', status: 'review' },
      { ...base, id: 'first-proposal', status: 'proposed' },
      { ...base, id: 'next-proposal', status: 'proposed' },
    ];
    const after = tasksFor('needs', before.map(task => task.id === 'first-proposal' ? { ...task, status } : task));
    expect(taskCursor(after.map(task => task.id), before.map(task => task.id), 'first-proposal')).toBe('next-proposal');
  });
});

describe('task cursor', () => {
  it('moves backward when the last task disappears', () => {
    expect(taskCursor(['review', 'first'], ['review', 'first', 'last'], 'last')).toBe('first');
  });
  it('skips other tasks removed in the same update', () => {
    expect(taskCursor(['review', 'last'], ['review', 'first', 'second', 'last'], 'first')).toBe('last');
  });
  it('keeps the selected task when the list is reordered', () => {
    expect(taskCursor(['second', 'first'], ['first', 'second'], 'first')).toBe('first');
  });
  it('handles empty and newly opened lists', () => {
    expect(taskCursor([], ['only'], 'only')).toBeUndefined();
    expect(taskCursor(['first', 'second'], [])).toBe('first');
  });
});
