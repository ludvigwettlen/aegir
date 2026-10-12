import type { Task, TaskRecurrence } from './types.js';

const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
function addDays(date: Date, days: number) { const next = new Date(date); next.setDate(next.getDate() + days); return next; }

// Resolves one date word (today, tomorrow, fri, 2026-10-02) to YYYY-MM-DD. Weekdays mean the next occurrence, today included.
export function parseDue(word: string, today: Date): string | null {
  const value = word.toLowerCase();
  if (value === 'today' || value === 'tod') return isoDate(today);
  if (value === 'tomorrow' || value === 'tmr') return isoDate(addDays(today, 1));
  const day = value.length >= 3 ? weekdays.findIndex(name => name.startsWith(value)) : -1;
  if (day >= 0) return isoDate(addDays(today, (day - today.getDay() + 7) % 7));
  return validTaskDate(value) ? value : null;
}

// "Summarise calls #customers fri" → title, label and due date. Only the first label and date are used.
export function parseQuickAdd(text: string, today = new Date()): { title: string; label: string | null; dueAt: string | null; recurrence?: TaskRecurrence } {
  let label: string | null = null; let dueAt: string | null = null;
  let recurrence: TaskRecurrence | undefined;
  const repeats: Record<string, TaskRecurrence> = { day: 'daily', weekday: 'weekdays', week: 'weekly', month: 'monthly' };
  text = text.replace(/\bevery\s+(day|weekday|week|month)\b/i, (_match, unit: string) => {
    recurrence = repeats[unit.toLowerCase()];
    return '';
  });
  const kept = text.trim().split(/\s+/).filter(token => {
    const tag = token.match(/^#([\w-]+)$/);
    if (tag && !label) { label = tag[1].toLowerCase(); return false; }
    const due = dueAt ? null : parseDue(token, today);
    if (due) { dueAt = due; return false; }
    return true;
  });
  return { title: kept.join(' '), label, dueAt: dueAt ?? (recurrence ? isoDate(today) : null), ...(recurrence ? { recurrence } : {}) };
}

export type BuiltInTaskView = 'inbox' | 'today' | 'upcoming' | 'team' | 'needs' | 'completed';
export type TaskView = BuiltInTaskView | `list:${string}`;
export const customListId = (view: TaskView): string | null => view.startsWith('list:') ? view.slice(5) : null;

// Keep selection near a removed task in the previous visible order.
export function taskCursor(order: string[], previousOrder: string[], selected?: string): string | undefined {
  if (selected && order.includes(selected)) return selected;
  const index = selected ? previousOrder.indexOf(selected) : -1;
  if (index >= 0) {
    const remaining = new Set(order);
    return previousOrder.slice(index + 1).find(id => remaining.has(id))
      ?? previousOrder.slice(0, index).reverse().find(id => remaining.has(id))
      ?? order[0];
  }
  return order[0];
}

// Needs you = suggested tasks, team work ready for review, and blocked team work. The team list = anything an agent has taken on.
export function tasksFor(view: TaskView, tasks: Task[], today = new Date()): Task[] {
  const now = isoDate(today);
  if (view === 'completed') return tasks.filter(task => task.status === 'done').sort((a, b) => (b.completedAt || b.updatedAt).localeCompare(a.completedAt || a.updatedAt));
  const open = tasks.filter(task => task.status !== 'done' && task.status !== 'dismissed');
  const listId = customListId(view);
  if (listId) return open.filter(task => task.listId === listId);
  if (view === 'inbox') return open.filter(task => !task.listId);
  if (view === 'needs') return open.filter(task => task.status === 'proposed' || task.status === 'review' || task.status === 'blocked');
  if (view === 'team') return open.filter(task => task.threadId !== null);
  if (view === 'today') return open.filter(task => task.status !== 'proposed' && (task.dueAt ? task.dueAt <= now : !task.listId));
  return open.filter(task => task.status !== 'proposed' && task.dueAt !== null && task.dueAt > now);
}

export const taskRecurrenceLabels: Record<TaskRecurrence, string> = {
  daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly', monthly: 'Monthly',
};

export function validTaskDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && isoDate(date) === value;
}

export function validateTaskRecurrence(value: unknown): asserts value is TaskRecurrence | null {
  if (value !== null && (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(taskRecurrenceLabels, value)))
    throw new Error('Choose daily, weekdays, weekly, or monthly repetition');
}

// Calendar dates are local, so a DST change never moves the task to another day.
// Skip missed slots and keep the original day of month when a short month clamps it.
export function nextTaskDue(dueAt: string, recurrence: TaskRecurrence, today = new Date(), anchor = dueAt): string {
  validateTaskRecurrence(recurrence);
  if (!validTaskDate(dueAt) || !validTaskDate(anchor)) throw new Error('A repeating task needs a valid due date');
  const date = new Date(`${dueAt}T12:00:00`);
  const cutoff = new Date(`${isoDate(today)}T12:00:00`).getTime();
  const day = Number(anchor.slice(8));
  do {
    if (recurrence === 'monthly') {
      date.setDate(1);
      date.setMonth(date.getMonth() + 1);
      const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      date.setDate(Math.min(day, last));
    } else {
      date.setDate(date.getDate() + (recurrence === 'weekly' ? 7 : 1));
      if (recurrence === 'weekdays') {
        while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
      }
    }
  } while (date.getTime() <= cutoff);
  const result = isoDate(date);
  if (!validTaskDate(result)) throw new Error('The next occurrence is outside the supported date range');
  return result;
}
