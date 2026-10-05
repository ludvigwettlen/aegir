import { describe, expect, it } from 'vitest';
import { parseDue, parseQuickAdd, parseWhen, taskCursor, tasksFor } from './tasks.js';
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

describe('snooze and due-date phrases', () => {
  const monday = new Date(2026, 9, 5);
  it.each([
    ['3 days', '2026-10-08'], ['in 3 days', '2026-10-08'], ['+3d', '2026-10-08'], ['2 weeks', '2026-10-19'], ['a week', '2026-10-12'],
    ['1 month', '2026-11-05'], ['in 2 months', '2026-12-05'], ['1y', '2027-10-05'], ['tomorrow', '2026-10-06'], ['fri', '2026-10-09'],
    ['next fri', '2026-10-09'], ['next mon', '2026-10-12'], ['next week', '2026-10-12'], ['next month', '2026-11-01'], ['weekend', '2026-10-10'],
    ['20 oct', '2026-10-20'], ['Oct 20', '2026-10-20'], ['1 okt', '2027-10-01'], ['3 maj', '2027-05-03'], ['20/10', '2026-10-20'], ['20.10.2027', '2027-10-20'], ['2026-11-03', '2026-11-03'],
  ])('reads %s', (phrase, date) => expect(parseWhen(phrase, monday)).toBe(date));
  it('rejects what it cannot read', () => {
    for (const phrase of ['', 'banana', '31 feb', '13/13', 'inbox']) expect(parseWhen(phrase, monday)).toBeNull();
  });
  it('keeps month-end dates inside the month', () => expect(parseWhen('1 month', new Date(2027, 0, 31))).toBe('2027-02-28'));
});

describe('task lists', () => {
  const base: Task = { id: '', title: '', notes: '', label: null, dueAt: null, status: 'ready', agentId: null, threadId: null, outputDir: null, sourceUrl: null, sourceKey: null, createdAt: '', updatedAt: '', completedAt: null };
  const tasks: Task[] = [
    { ...base, id: 'undated' }, { ...base, id: 'later', dueAt: '2026-10-02' }, { ...base, id: 'overdue', dueAt: '2026-09-20' },
    { ...base, id: 'suggested', status: 'proposed' }, { ...base, id: 'blocked', status: 'blocked', threadId: 't' }, { ...base, id: 'done', status: 'done', completedAt: '2026-09-25' }, { ...base, id: 'recently-done', status: 'done', completedAt: '2026-09-26' }
  ];
  it('splits inbox, today, upcoming, team and needs-you', () => {
    expect(tasksFor('inbox', tasks, saturday).map(x => x.id)).toEqual(['undated']);
    expect(tasksFor('today', tasks, saturday).map(x => x.id)).toEqual(['overdue']);
    expect(tasksFor('upcoming', tasks, saturday).map(x => x.id)).toEqual(['later']);
    expect(tasksFor('team', tasks, saturday).map(x => x.id)).toEqual(['blocked']);
    expect(tasksFor('needs', tasks, saturday).map(x => x.id)).toEqual(['suggested', 'blocked']);
    expect(tasksFor('completed', tasks, saturday).map(x => x.id)).toEqual(['recently-done', 'done']);
  });
  it('keeps work with the agent and work waiting on the user out of the inbox', () => {
    const handled: Task[] = (['running', 'review', 'blocked'] as const).map(status => ({ ...base, id: status, status, threadId: 't' }));
    expect(tasksFor('inbox', [...handled, { ...base, id: 'new' }], saturday).map(x => x.id)).toEqual(['new']);
    expect(tasksFor('needs', handled, saturday).map(x => x.id)).toEqual(['review', 'blocked']);
    expect(tasksFor('team', handled, saturday).map(x => x.id)).toEqual(['running', 'review', 'blocked']);
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
