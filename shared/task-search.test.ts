import { describe, expect, it } from 'vitest';
import { fold, homeList, searchTasks } from './task-search.js';
import type { Task } from './types.js';

const wednesday = new Date(2026, 9, 7);
const base: Task = {
  id: '', title: '', notes: '', label: null, dueAt: null, status: 'ready', agentId: null, threadId: null, outputDir: null, sourceUrl: null, sourceKey: null,
  createdAt: '2026-10-01T08:00:00Z', updatedAt: '2026-10-01T08:00:00Z', completedAt: null,
  priority: null, prioritySource: null, agentPriority: null, priorityReason: null, prioritySetAt: null, priorityCheckedAt: null,
};
const task = (id: string, fields: Partial<Task>): Task => ({ ...base, id, title: id, ...fields });
const ids = (query: string, tasks: Task[]) => searchTasks(tasks, query, wednesday).map((match) => match.task.id);

describe('finding a task', () => {
  it('ignores case and Swedish accents', () => {
    expect(fold('Jobbsprånget ÅÄÖ')).toBe('jobbspranget aao');
    expect(ids('jobbspranget', [task('j', { title: 'Prep for Jobbsprånget' })])).toEqual(['j']);
  });

  it('ranks a title match above a label match above a match only in the context', () => {
    const tasks = [
      task('notes', { title: 'Weekly sync', notes: 'Bring the board numbers' }),
      task('inside', { title: 'Onboarding plan' }),
      task('start', { title: 'Prep board deck' }),
      task('label', { title: 'Q4 pack', label: 'board' }),
    ];
    expect(ids('board', tasks)).toEqual(['start', 'inside', 'label', 'notes']);
  });

  it('needs every word to match, and reads #label as the label', () => {
    const tasks = [task('deck', { title: 'Prep board deck' }), task('memo', { title: 'Board memo', label: 'investor' }), task('other', { title: 'Deck for Harborlight', label: 'board' })];
    expect(ids('board deck', tasks)).toEqual(['deck', 'other']);
    expect(ids('#board', tasks)).toEqual(['other']);
    expect(ids('#inv memo', tasks)).toEqual(['memo']);
  });

  it('shows where in the context it matched', () => {
    const [match] = searchTasks([task('t', { title: 'Follow up', notes: '#### Recommendation\nSend Tove the four answers before the board pack goes out on Friday, then close.' })], 'tove', wednesday);
    expect(match.snippet).toContain('Tove the four answers');
    expect(match.snippet?.endsWith('…')).toBe(true);
    expect(match.snippet).not.toContain('####');
  });

  it('puts open tasks before finished ones, then the most recently changed, and never finds a dismissed task', () => {
    const tasks = [
      task('done', { title: 'Board pack', status: 'done', completedAt: '2026-10-06T08:00:00Z', updatedAt: '2026-10-06T09:00:00Z' }),
      task('old', { title: 'Board seat', updatedAt: '2026-10-02T08:00:00Z' }),
      task('new', { title: 'Board call', updatedAt: '2026-10-05T08:00:00Z' }),
      task('gone', { title: 'Board dinner', status: 'dismissed' }),
    ];
    expect(ids('board', tasks)).toEqual(['new', 'old', 'done']);
  });

  it('with nothing typed, offers the open tasks changed last', () => {
    const tasks = [
      task('a', { updatedAt: '2026-10-03T08:00:00Z' }), task('b', { updatedAt: '2026-10-06T08:00:00Z' }),
      task('done', { status: 'done', updatedAt: '2026-10-07T08:00:00Z' }),
      ...Array.from({ length: 20 }, (_, n) => task(`x${n}`, { updatedAt: '2026-09-01T08:00:00Z' })),
    ];
    const recent = ids('', tasks);
    expect(recent.slice(0, 2)).toEqual(['b', 'a']);
    expect(recent).not.toContain('done');
    expect(recent).toHaveLength(15);
  });

  it('opens a found task in the list you work from first', () => {
    expect(homeList(task('t', { dueAt: '2026-10-07' }), wednesday)).toBe('today');
    expect(homeList(task('t', { dueAt: '2026-10-12' }), wednesday)).toBe('upcoming');
    expect(homeList(task('t', {}), wednesday)).toBe('inbox');
    expect(homeList(task('t', { status: 'proposed' }), wednesday)).toBe('inbox');
    expect(homeList(task('t', { status: 'review', threadId: 'x' }), wednesday)).toBe('today');
    expect(homeList(task('t', { status: 'review', threadId: 'x', dueAt: '2026-10-12' }), wednesday)).toBe('upcoming');
    expect(homeList(task('t', { status: 'done' }), wednesday)).toBe('completed');
    expect(homeList(task('t', { status: 'dismissed' }), wednesday)).toBeNull();
  });
});
