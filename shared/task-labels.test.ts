import { expect, it } from 'vitest';
import { normalizeLabels, parseLabels } from './task-labels.js';
import { parseQuickAdd } from './tasks.js';
import { searchTasks } from './task-search.js';
it('normalizes comma-separated labels and captures every hashtag without changing one-label parsing', () => {
  expect(parseLabels(' #Work, board, work, ')).toEqual(['work','board']);
  expect(parseQuickAdd('Draft memo #work #board #work tomorrow', new Date('2026-10-26T12:00:00'))).toMatchObject({ title: 'Draft memo', label: 'work', labels: ['work','board'], dueAt: '2026-10-27' });
  expect(() => normalizeLabels([42])).toThrow(); expect(() => normalizeLabels(['a,b'])).toThrow();
});
it('finds secondary labels with hashtag search', () => {
  const task = { id: 'task', title: 'Memo', notes: '', label: 'work', labels: ['work','board'], dueAt: null, status: 'ready', listId: null, createdAt: '', updatedAt: '' } as import('./types.js').Task;
  expect(searchTasks([task], '#board').map(match => match.task.id)).toEqual(['task']);
  expect(searchTasks([task], '#work #board')).toHaveLength(1);
});
