import { describe, expect, it } from 'vitest';
import { compareTasks, parseDue, parseQuickAdd, parseWhen, sourceKind, taskCursor, taskGroups, tasksFor, withHeld } from './tasks.js';
import type { Task } from './types.js';

const saturday = new Date(2026, 8, 26);
describe('quick add', () => {
  it('extracts a label and a due date and keeps the rest as the title', () => {
    expect(parseQuickAdd('Summarise calls #Customers fri', saturday)).toEqual({ title: 'Summarise calls', label: 'customers', dueAt: '2026-10-02', priority: null });
  });
  it('treats a weekday as the next occurrence, including today', () => {
    expect(parseDue('sat', saturday)).toBe('2026-09-26');
    expect(parseDue('monday', saturday)).toBe('2026-09-28');
    expect(parseDue('tomorrow', saturday)).toBe('2026-09-27');
    expect(parseDue('wednesday', saturday)).toBe('2026-09-30');
    expect(parseDue('tues', saturday)).toBe('2026-09-29');
  });
  it('reads !1, !2 and !3 as a priority, once, and leaves other exclamations alone', () => {
    expect(parseQuickAdd('Prep board deck !1 #board fri', saturday)).toEqual({ title: 'Prep board deck', label: 'board', dueAt: '2026-10-02', priority: 1 });
    expect(parseQuickAdd('Ship it !3 !1', saturday)).toEqual({ title: 'Ship it !1', label: null, dueAt: null, priority: 3 });
    expect(parseQuickAdd('Wow! !4 !!1', saturday).priority).toBeNull();
  });
  it('leaves ordinary words alone', () => {
    expect(parseQuickAdd('Monitor #ops dashboards', saturday)).toEqual({ title: 'Monitor dashboards', label: 'ops', dueAt: null, priority: null });
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
  const base: Task = { id: '', title: '', notes: '', label: null, dueAt: null, status: 'ready', agentId: null, threadId: null, outputDir: null, sourceUrl: null, sourceKey: null, createdAt: '', updatedAt: '', completedAt: null, priority: null, prioritySource: null, agentPriority: null, priorityReason: null, prioritySetAt: null, priorityCheckedAt: null };
  const tasks: Task[] = [
    { ...base, id: 'undated' }, { ...base, id: 'later', dueAt: '2026-10-02' }, { ...base, id: 'overdue', dueAt: '2026-09-20' },
    { ...base, id: 'suggested', status: 'proposed' }, { ...base, id: 'blocked', status: 'blocked', threadId: 't' }, { ...base, id: 'done', status: 'done', completedAt: '2026-09-25' }, { ...base, id: 'recently-done', status: 'done', completedAt: '2026-09-26' }
  ];
  it('splits inbox, today, upcoming, team and needs-you', () => {
    expect(tasksFor('inbox', tasks, saturday).map(x => x.id)).toEqual(['undated', 'suggested']);
    expect(tasksFor('today', tasks, saturday).map(x => x.id)).toEqual(['overdue']);
    expect(tasksFor('upcoming', tasks, saturday).map(x => x.id)).toEqual(['later']);
    expect(tasksFor('team', tasks, saturday).map(x => x.id)).toEqual(['blocked']);
    expect(tasksFor('needs', tasks, saturday).map(x => x.id)).toEqual(['suggested', 'blocked']);
    expect(tasksFor('completed', tasks, saturday).map(x => x.id)).toEqual(['recently-done', 'done']);
  });
  it('keeps work with the agent and work waiting for review out of the inbox', () => {
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

describe('a task held after sending it to the agent', () => {
  const base: Task = { id: '', title: '', notes: '', label: null, dueAt: null, status: 'ready', agentId: null, threadId: null, outputDir: null, sourceUrl: null, sourceKey: null, createdAt: '', updatedAt: '', completedAt: null, priority: null, prioritySource: null, agentPriority: null, priorityReason: null, prioritySetAt: null, priorityCheckedAt: null };
  const sent: Task = { ...base, id: 'sent', label: 'board' };
  const other: Task = { ...base, id: 'other' };
  const ids = (view: Parameters<typeof withHeld>[0], tasks: Task[], held: Task | null) => withHeld(view, tasks, held, saturday).map(task => task.id);

  it('stays in the list it was sent from, sorted as it was when sent', () => {
    const working: Task = { ...sent, status: 'running', threadId: 't' };
    expect(ids('inbox', [working, other], sent)).toEqual(['sent', 'other']);
    expect(ids('inbox', [working, other], null)).toEqual(['other']);
    expect(withHeld('inbox', [working], sent, saturday)[0].status).toBe('ready');
  });
  it('stays while the agent finishes, and while it is stopped', () => {
    for (const status of ['review', 'blocked'] as const) expect(ids('inbox', [{ ...sent, status, threadId: 't' }], sent)).toEqual(['sent']);
  });
  it('stays in Needs you and Completed when a reply sets it working again', () => {
    const review: Task = { ...sent, status: 'review', threadId: 't' };
    expect(ids('needs', [{ ...review, status: 'running' }], review)).toEqual(['sent']);
    const done: Task = { ...sent, status: 'done', threadId: 't', completedAt: '2026-09-25' };
    expect(ids('completed', [{ ...done, status: 'running', completedAt: null, priority: null, prioritySource: null, agentPriority: null, priorityReason: null, prioritySetAt: null, priorityCheckedAt: null }], done)).toEqual(['sent']);
  });
  it('drops out when it is finished or deleted', () => {
    for (const status of ['done', 'dismissed'] as const) expect(ids('inbox', [{ ...sent, status, threadId: 't' }, other], sent)).toEqual(['other']);
    expect(ids('inbox', [other], sent)).toEqual(['other']);
  });
  it('applies a new date or label as usual', () => {
    const working: Task = { ...sent, status: 'running', threadId: 't' };
    expect(ids('inbox', [{ ...working, dueAt: '2026-10-02' }, other], sent)).toEqual(['other']);
    const review: Task = { ...sent, status: 'review', threadId: 't' };
    expect(ids('needs', [{ ...review, status: 'running', dueAt: '2026-10-02' }], review)).toEqual(['sent']);
    expect(withHeld('inbox', [{ ...working, label: 'ops' }], sent, saturday)[0].label).toBe('ops');
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

describe('priority bands', () => {
  const base: Task = { id: '', title: '', notes: '', label: null, dueAt: null, status: 'ready', agentId: null, threadId: null, outputDir: null, sourceUrl: null, sourceKey: null, createdAt: '2026-10-01', updatedAt: '', completedAt: null, priority: null, prioritySource: null, agentPriority: null, priorityReason: null, prioritySetAt: null, priorityCheckedAt: null };
  const status = { proposed: 'Suggested', ready: 'Open', running: 'Working', review: 'Ready for your review', blocked: 'Stopped', done: 'Done', dismissed: 'Dismissed' } as const;
  const names = (groups: [string, Task[]][]) => groups.map(([name, list]) => `${name}: ${list.map((task) => task.id).join(',')}`);
  it('groups Today by band, P1 first and untriaged last, overdue first inside a band', () => {
    const tasks: Task[] = [
      { ...base, id: 'none', label: 'finance' },
      { ...base, id: 'p3', priority: 3, prioritySource: 'agent' },
      { ...base, id: 'p1-today', priority: 1, prioritySource: 'user', dueAt: '2026-10-07' },
      { ...base, id: 'p1-overdue', priority: 1, prioritySource: 'agent', dueAt: '2026-10-02' },
      { ...base, id: 'p2', priority: 2, prioritySource: 'agent', label: 'board' },
    ];
    expect(names(taskGroups('today', tasks, status))).toEqual(['P1: p1-overdue,p1-today', 'P2: p2', 'P3: p3', 'Not prioritized yet: none']);
  });
  it('keeps suggestions on top of the Inbox, ordered by band', () => {
    const tasks: Task[] = [
      { ...base, id: 'mine', priority: 1, prioritySource: 'agent' },
      { ...base, id: 's3', status: 'proposed', priority: 3, prioritySource: 'agent' },
      { ...base, id: 's1', status: 'proposed', priority: 1, prioritySource: 'agent' },
    ];
    expect(names(taskGroups('inbox', tasks, status))).toEqual(['Suggested: s1,s3', 'P1: mine']);
  });
  it('leaves Needs you grouped by status and Delegated by label', () => {
    const tasks: Task[] = [
      { ...base, id: 'blocked', status: 'blocked', threadId: 't', priority: 1, prioritySource: 'agent' },
      { ...base, id: 'review', status: 'review', threadId: 't', label: 'gtm', priority: 3, prioritySource: 'agent' },
      { ...base, id: 'suggested', status: 'proposed', label: 'board' },
    ];
    expect(names(taskGroups('needs', tasks, status))).toEqual(['Ready for your review: review', 'Stopped: blocked', 'Suggested: suggested']);
    expect(names(taskGroups('team', tasks.slice(0, 2), status))).toEqual(['#gtm: review', 'No label: blocked']);
  });
  it('puts every open P1 on Today, whatever its date or status, and nothing else that is not due', () => {
    const tasks: Task[] = [
      { ...base, id: 'review-p1', status: 'review', threadId: 't', priority: 1, prioritySource: 'agent' },
      { ...base, id: 'later-p1', dueAt: '2026-10-20', priority: 1, prioritySource: 'user' },
      { ...base, id: 'suggested-p1', status: 'proposed', priority: 1, prioritySource: 'agent' },
      { ...base, id: 'later-p2', dueAt: '2026-10-20', priority: 2, prioritySource: 'agent' },
      { ...base, id: 'done-p1', status: 'done', priority: 1, prioritySource: 'agent' },
    ];
    expect(tasksFor('today', tasks, new Date(2026, 9, 7)).map((task) => task.id).sort()).toEqual(['later-p1', 'review-p1', 'suggested-p1']);
    expect(tasksFor('upcoming', tasks, new Date(2026, 9, 7)).map((task) => task.id).sort()).toEqual(['later-p1', 'later-p2']);
  });
  it('sorts by band, then status, then date, then age', () => {
    const order = [
      { ...base, id: 'c', priority: 2 as const, dueAt: '2026-10-09' },
      { ...base, id: 'b', priority: 2 as const, dueAt: '2026-10-08' },
      { ...base, id: 'a', priority: 1 as const },
      { ...base, id: 'd' },
    ].sort(compareTasks).map((task) => task.id);
    expect(order).toEqual(['a', 'b', 'c', 'd']);
  });
  it('names where a task came from', () => {
    expect(sourceKind('inbox:gmail-malcolm-1a0c3d33d742')).toBe('gmail');
    expect(sourceKind('inbox:slack-mpdm-malcolm')).toBe('slack');
    expect(sourceKind('inbox:calendar-53nfjhe')).toBe('calendar');
    expect(sourceKind('reminders:527AF46D')).toBe('reminders');
    expect(sourceKind(null)).toBeNull();
  });
});
