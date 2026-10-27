import { expect, it } from 'vitest';
import { filterTasks, compareTasks, defaultTaskFilter, readTaskFilter } from './task-filters.js';
import type { Task } from './types.js';
it('combines filters without moving tasks between lists and sorts missing values last', () => {
  const tasks = [{ id: 'one', label: 'work', status: 'ready', priority: 1, dueAt: null }, { id: 'two', label: null, status: 'blocked', priority: null, dueAt: '2026-10-26' }] as Task[];
  expect(filterTasks(tasks, { ...defaultTaskFilter, label: 'work', priority: '1', status: 'ready' }).map(t => t.id)).toEqual(['one']);
  expect(filterTasks(tasks, { ...defaultTaskFilter, label: '__none', priority: 'none' }).map(t => t.id)).toEqual(['two']);
  expect([...tasks].sort((a,b) => compareTasks(a,b,'due'))[0].id).toBe('two');
  expect([...tasks].sort((a,b) => compareTasks(a,b,'priority'))[0].id).toBe('one');
  expect(readTaskFilter({ sort: 'invalid', status: 'evil', label: 'work' })).toEqual({ ...defaultTaskFilter, label: 'work' });
});
it('matches all or any labels, excludes labelled tasks from no-label views and retains legacy presets', () => {
  const tasks = [{ id: 'a', label: 'work', labels: ['work','board'], status: 'ready' }, { id: 'b', label: 'board', labels: ['board'], status: 'ready' }, { id: 'c', label: null, labels: [], status: 'ready' }] as Task[];
  const filter = { ...defaultTaskFilter, labels: ['work','board'] };
  expect(filterTasks(tasks, filter).map(task => task.id)).toEqual(['a']);
  expect(filterTasks(tasks, { ...filter, labelMode: 'any' }).map(task => task.id)).toEqual(['a','b']);
  expect(filterTasks(tasks, { ...defaultTaskFilter, label: '__none' }).map(task => task.id)).toEqual(['c']);
  expect(filterTasks(tasks, readTaskFilter({ label: 'board' })).map(task => task.id)).toEqual(['a','b']);
});
it('validates saved views and selects tasks across lists without losing the scope', async () => {
  const { validateTaskView, readTaskViews, tasksForSavedView } = await import('./task-filters.js');
  const view = validateTaskView({ id: 'one', name: ' Board work ', scope: 'all', filter: { labels: ['board'], sort: 'priority' } });
  expect(view.name).toBe('Board work'); expect(readTaskViews(JSON.stringify([view]))).toEqual([view]);
  const tasks = [{ id: 'a', status: 'ready', label: 'board', listId: 'one' }, { id: 'b', status: 'ready', label: 'board', listId: 'two' }, { id: 'c', status: 'done', label: 'board', listId: null }] as Task[];
  expect(tasksForSavedView(view, tasks).map(task => task.id)).toEqual(['a','b']);
  expect(tasksForSavedView({ ...view, scope: 'list:one' }, tasks).map(task => task.id)).toEqual(['a']);
  expect(() => validateTaskView({ ...view, scope: 'view:recursive' })).toThrow();
  expect(() => validateTaskView({ ...view, name: '' })).toThrow();
  expect(readTaskViews('{broken')).toEqual([]);
});
