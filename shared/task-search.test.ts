import { describe, expect, it } from 'vitest';
import { conversationQuery, fold, homeList, mergeContent, searchTasks, searchWords } from './task-search.js';
import type { ContentMatch, Task } from './types.js';

const wednesday = new Date(2026, 9, 7);
const base: Task = {
  id: '', title: '', notes: '', label: null, dueAt: null, status: 'ready', agentId: null, threadId: null, outputDir: null, sourceUrl: null, sourceKey: null,
  createdAt: '2026-10-01T08:00:00Z', updatedAt: '2026-10-01T08:00:00Z', completedAt: null,
  listId: null, recurrence: null, recurrenceAnchor: null, nextOccurrenceId: null,
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
    const tasks = [task('deck', { title: 'Prep board deck' }), task('memo', { title: 'Board memo', label: 'investor' }), task('other', { title: 'Deck for Harbourline', label: 'board' })];
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
    expect(homeList(task('t', { status: 'proposed' }), wednesday)).toBe('needs');
    expect(homeList(task('t', { status: 'review', threadId: 'x' }), wednesday)).toBe('needs');
    expect(homeList(task('t', { status: 'review', threadId: 'x', dueAt: '2026-10-12' }), wednesday)).toBe('needs');
    expect(homeList(task('t', { listId: 'project' }), wednesday)).toBe('list:project');
    expect(ids('filed', [task('filed', { listId: 'project' })])).toEqual(['filed']);
    expect(homeList(task('t', { status: 'done' }), wednesday)).toBe('completed');
    expect(homeList(task('t', { status: 'dismissed' }), wednesday)).toBeNull();
  });

  it('finds a task when the words are spread over its title, context, conversation and documents', () => {
    const said = (taskId: string, words: number[], where: ContentMatch['where'] = 'conversation'): ContentMatch => ({
      taskId, words, where, snippet: 'the PDF from Tove', role: 'user', agentId: null, draft: false, messageId: null, document: null,
    });
    const tasks = [task('pack', { title: 'Board pack', notes: 'Numbers from finance' }), task('dinner', { title: 'Board dinner' })];
    // "pdf" is only in the board pack's conversation: without the database's answer nothing matches every word.
    expect(ids('board pdf', tasks)).toEqual([]);
    const content = new Map([['pack', said('pack', [1])], ['dinner', said('dinner', [2])]]);
    const [match, ...rest] = searchTasks(tasks, 'board pdf finance', wednesday, 50, content);
    expect([match.task.id, rest.length]).toEqual(['pack', 0]);
    // The row quotes the conversation, since a word was only there.
    expect(match.content).toBe(content.get('pack'));
    // A task whose own text holds every word quotes nothing from its conversation.
    expect(searchTasks(tasks, 'board', wednesday, 50, content).map((found) => found.content)).toEqual([null, null]);
    // Finished tasks are found the same way.
    const done = [task('signed', { title: 'Close renewal', status: 'done' })];
    expect(searchTasks(done, 'renewal pdf', wednesday, 50, new Map([['signed', said('signed', [1])]])).map((found) => [found.task.id, found.list])).toEqual([['signed', 'completed']]);
  });

  it('numbers the searched words the same way on both sides, and merges what conversations and documents hold', () => {
    expect(searchWords('  Board  #GTM pdf ')).toEqual(['board', '#gtm', 'pdf']);
    const base = { snippet: '', role: null, agentId: null, draft: false, messageId: null, document: null };
    const merged = mergeContent(
      [{ ...base, taskId: 'a', words: [0], where: 'conversation', snippet: 'chat' }, { ...base, taskId: 'b', words: [0, 1], where: 'conversation', snippet: 'b chat' }],
      [{ ...base, taskId: 'a', words: [1, 2], where: 'document', snippet: 'doc', document: 'memo.md' }],
    );
    expect(merged.map((match) => [match.taskId, match.words, match.snippet])).toEqual([['a', [0, 1, 2], 'doc'], ['b', [0, 1], 'b chat']]);
  });

  it('builds a conversation query where every word is a quoted prefix, and nothing typed is an operator', () => {
    expect(conversationQuery('Fjelltek renewal')).toBe('"Fjelltek"* "renewal"*');
    expect(conversationQuery('"OR) NOT q3-renewal*')).toBe('"OR"* "NOT"* "q3"* "renewal"*');
    expect(conversationQuery('Åsne')).toBe('"Åsne"*');
    expect(conversationQuery('k')).toBeNull();
    expect(conversationQuery('  ?! ')).toBeNull();
  });
});

it('opens snoozed custom-list and review tasks in Upcoming where their rows remain visible', () => {
  for (const patch of [{ listId: 'customers' }, { status: 'review' as const }]) {
    const snoozed = task('Follow up', { ...patch, snoozedUntil: '2026-10-09' });
    expect(homeList(snoozed, wednesday)).toBe('upcoming');
    expect(searchTasks([snoozed], 'follow', wednesday)[0].list).toBe('upcoming');
  }
});
