import type { Task } from './types.js';
import { normalizeLabels, taskLabels } from './task-labels.js';
import { tasksFor, type BuiltInTaskView, type TaskView } from './tasks.js';
export type TaskFilter = { label: string; labels?: string[]; labelMode?: 'all' | 'any'; status: string; priority: string; sort: 'default' | 'due' | 'priority' | 'title' | 'newest' };
export type TaskScope = BuiltInTaskView | `list:${string}`;
export type SavedTaskView = { id: string; name: string; scope: TaskScope; filter: TaskFilter };
export const defaultTaskFilter: TaskFilter = { label: '', status: '', priority: '', sort: 'default' };
export const selectedLabels = (filter: TaskFilter) => filter.labels ?? (filter.label && filter.label !== '__none' ? [filter.label] : []);
export function filterTasks(tasks: Task[], filter: TaskFilter) {
  const selected = selectedLabels(filter);
  return tasks.filter(task => {
    const labels = taskLabels(task);
    const matchesLabels = filter.label === '__none' ? labels.length === 0 : !selected.length || (filter.labelMode === 'any' ? selected.some(label => labels.includes(label)) : selected.every(label => labels.includes(label)));
    return matchesLabels && (!filter.status || task.status === filter.status) && (!filter.priority || (filter.priority === 'none' ? !task.priority : String(task.priority) === filter.priority));
  });
}
export function compareTasks(a: Task, b: Task, sort: TaskFilter['sort']) {
  if (sort === 'due') return (a.dueAt || '9999').localeCompare(b.dueAt || '9999');
  if (sort === 'priority') return (a.priority || 4) - (b.priority || 4);
  if (sort === 'title') return a.title.localeCompare(b.title);
  if (sort === 'newest') return b.createdAt.localeCompare(a.createdAt);
  return 0;
}
export function readTaskFilter(value: unknown): TaskFilter {
  if (!value || typeof value !== 'object') return { ...defaultTaskFilter };
  const item = value as Record<string, unknown>;
  let labels: string[] | undefined;
  try { if (item.labels !== undefined) labels = normalizeLabels(item.labels); } catch { /* old/damaged preferences fall back to their legacy label */ }
  return { label: typeof item.label === 'string' ? item.label : '', ...(labels ? { labels } : {}), ...(item.labelMode === 'any' ? { labelMode: 'any' as const } : {}), status: ['proposed','ready','running','review','blocked','done'].includes(String(item.status)) ? String(item.status) : '', priority: ['1','2','3','none'].includes(String(item.priority)) ? String(item.priority) : '', sort: ['due','priority','title','newest'].includes(String(item.sort)) ? item.sort as TaskFilter['sort'] : 'default' };
}
export function validTaskScope(value: unknown): value is TaskScope {
  return typeof value === 'string' && (['all','inbox','today','upcoming','team','needs','completed'].includes(value) || /^list:.+/.test(value));
}
export function validateTaskView(value: unknown): SavedTaskView {
  if (!value || typeof value !== 'object') throw new Error('Invalid filtered view.');
  const item = value as SavedTaskView;
  if (typeof item.id !== 'string' || !item.id || item.id.length > 200 || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 60 || !validTaskScope(item.scope)) throw new Error('Name the view (up to 60 characters) and choose its scope.');
  if (item.filter?.labels !== undefined) normalizeLabels(item.filter.labels);
  return { id: item.id, name: item.name.trim(), scope: item.scope, filter: readTaskFilter(item.filter) };
}
export function readTaskViews(raw?: string): SavedTaskView[] {
  try { const value = JSON.parse(raw || '[]'); return Array.isArray(value) ? value.flatMap(item => { try { return [validateTaskView(item)]; } catch { return []; } }).slice(0, 100) : []; } catch { return []; }
}
export function taskFilterForPriorities(filter: TaskFilter, show = true): TaskFilter { return show ? filter : { ...filter, priority: '', sort: filter.sort === 'priority' ? 'default' : filter.sort }; }
export function tasksForSavedView(view: SavedTaskView, tasks: Task[], today = new Date(), showPriorities = true) { return filterTasks(tasksFor(view.scope, tasks, today), taskFilterForPriorities(view.filter, showPriorities)); }
export function taskViewScope(view: TaskView, views: SavedTaskView[]): TaskScope | null {
  return view.startsWith('view:') ? views.find(item => item.id === view.slice(5))?.scope ?? null : view as TaskScope;
}
