import { describe, expect, it } from 'vitest';
import { parseDue, parseQuickAdd, tasksFor } from './tasks.js';
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
  const base: Task = { id: '', title: '', notes: '', label: null, dueAt: null, status: 'ready', agentId: null, threadId: null, outputDir: null, sourceUrl: null, sourceKey: null, createdAt: '', updatedAt: '' };
  const tasks: Task[] = [
    { ...base, id: 'undated' }, { ...base, id: 'later', dueAt: '2026-10-02' }, { ...base, id: 'overdue', dueAt: '2026-09-20' },
    { ...base, id: 'suggested', status: 'proposed' }, { ...base, id: 'blocked', status: 'blocked', threadId: 't' }, { ...base, id: 'done', status: 'done' }
  ];
  it('splits today, upcoming, team and needs-you', () => {
    expect(tasksFor('today', tasks, saturday).map(x => x.id)).toEqual(['undated', 'overdue', 'blocked']);
    expect(tasksFor('upcoming', tasks, saturday).map(x => x.id)).toEqual(['later']);
    expect(tasksFor('team', tasks, saturday).map(x => x.id)).toEqual(['blocked']);
    expect(tasksFor('needs', tasks, saturday).map(x => x.id)).toEqual(['suggested', 'blocked']);
  });
});
