import type { Task } from './types.js';

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
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

// "Summarise calls #customers fri" → title, label and due date. Only the first label and date are used.
export function parseQuickAdd(text: string, today = new Date()): { title: string; label: string | null; dueAt: string | null } {
  let label: string | null = null; let dueAt: string | null = null;
  const kept = text.trim().split(/\s+/).filter(token => {
    const tag = token.match(/^#([\w-]+)$/);
    if (tag && !label) { label = tag[1].toLowerCase(); return false; }
    const due = dueAt ? null : parseDue(token, today);
    if (due) { dueAt = due; return false; }
    return true;
  });
  return { title: kept.join(' '), label, dueAt };
}

export type TaskView = 'today' | 'upcoming' | 'team' | 'needs' | 'completed';
// Needs you = suggested tasks, team work ready for review, and blocked team work. The team list = anything an agent has taken on.
export function tasksFor(view: TaskView, tasks: Task[], today = new Date()): Task[] {
  const now = isoDate(today);
  if (view === 'completed') return tasks.filter(task => task.status === 'done').sort((a, b) => (b.completedAt || b.updatedAt).localeCompare(a.completedAt || a.updatedAt));
  const open = tasks.filter(task => task.status !== 'done' && task.status !== 'dismissed');
  if (view === 'needs') return open.filter(task => task.status === 'proposed' || task.status === 'review' || task.status === 'blocked');
  if (view === 'team') return open.filter(task => task.threadId !== null);
  if (view === 'today') return open.filter(task => task.status !== 'proposed' && (!task.dueAt || task.dueAt <= now));
  return open.filter(task => task.status !== 'proposed' && task.dueAt !== null && task.dueAt > now);
}
