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

const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const swedishMonths: Record<string, number> = { maj: 4, okt: 9 };
function addMonths(date: Date, count: number) {
  const target = new Date(date.getFullYear(), date.getMonth() + count, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), last));
}
const monthIndex = (word: string) => (word.length < 3 ? -1 : swedishMonths[word.slice(0, 3)] ?? months.indexOf(word.slice(0, 3)));
// A day and month without a year means the next time that date comes round.
function nextDate(today: Date, month: number, day: number, year?: number) {
  const date = new Date(year ?? today.getFullYear(), month, day);
  if (month < 0 || date.getMonth() !== month) return null;
  if (year === undefined && isoDate(date) < isoDate(today)) date.setFullYear(date.getFullYear() + 1);
  return isoDate(date);
}

// Resolves a snooze or due-date phrase to YYYY-MM-DD: today, tomorrow, fri, next fri, next week (Monday),
// next month (the 1st), weekend, 3 days, 2w, 1 month, in 2 months, 20 oct, oct 20, 20/10 (day first), 2026-10-20.
export function parseWhen(text: string, today: Date): string | null {
  const value = text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^(in |\+ ?)/, '');
  if (!value) return null;
  const word = parseDue(value, today);
  if (word) return word;
  if (value === 'next week') return isoDate(addDays(today, ((8 - today.getDay()) % 7) || 7));
  if (value === 'next month') return isoDate(new Date(today.getFullYear(), today.getMonth() + 1, 1));
  if (value === 'weekend' || value === 'this weekend') return isoDate(addDays(today, (6 - today.getDay() + 7) % 7));
  const next = value.match(/^next ([a-z]{3,})$/);
  const nextDay = next ? weekdays.findIndex(name => name.startsWith(next[1])) : -1;
  if (nextDay >= 0) return isoDate(addDays(today, ((nextDay - today.getDay() + 7) % 7) || 7));
  const span = value.match(/^(\d+|a|an|one) ?(d|days?|w|weeks?|m|mos?|months?|y|years?)$/);
  if (span) {
    const count = /^\d+$/.test(span[1]) ? Number(span[1]) : 1;
    if (span[2][0] === 'd') return isoDate(addDays(today, count));
    if (span[2][0] === 'w') return isoDate(addDays(today, count * 7));
    return isoDate(addMonths(today, span[2][0] === 'm' ? count : count * 12));
  }
  const dayFirst = value.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-zåäö]+)(?: (\d{4}))?$/);
  if (dayFirst && monthIndex(dayFirst[2]) >= 0) return nextDate(today, monthIndex(dayFirst[2]), Number(dayFirst[1]), dayFirst[3] ? Number(dayFirst[3]) : undefined);
  const monthFirst = value.match(/^([a-zåäö]+) (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?$/);
  if (monthFirst && monthIndex(monthFirst[1]) >= 0) return nextDate(today, monthIndex(monthFirst[1]), Number(monthFirst[2]), monthFirst[3] ? Number(monthFirst[3]) : undefined);
  const numeric = value.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?$/);
  if (numeric) return nextDate(today, Number(numeric[2]) - 1, Number(numeric[1]), numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : undefined);
  return null;
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

export type TaskView = 'inbox' | 'today' | 'upcoming' | 'team' | 'needs' | 'completed';

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
// Inbox = all new intake: your own undated tasks that nobody has picked up (phone captures land here) plus agent
// suggestions, which also stay in Needs you. Work with the agent sits in the team list, never in the Inbox. Today = due today or overdue; Upcoming = later.
export function tasksFor(view: TaskView, tasks: Task[], today = new Date()): Task[] {
  const now = isoDate(today);
  if (view === 'completed') return tasks.filter(task => task.status === 'done').sort((a, b) => (b.completedAt || b.updatedAt).localeCompare(a.completedAt || a.updatedAt));
  const open = tasks.filter(task => task.status !== 'done' && task.status !== 'dismissed');
  if (view === 'needs') return open.filter(task => task.status === 'proposed' || task.status === 'review' || task.status === 'blocked');
  if (view === 'team') return open.filter(task => task.threadId !== null);
  if (view === 'inbox') return open.filter(task => task.status === 'proposed' || (task.status === 'ready' && !task.dueAt));
  if (view === 'today') return open.filter(task => task.status !== 'proposed' && task.dueAt !== null && task.dueAt <= now);
  return open.filter(task => task.status !== 'proposed' && task.dueAt !== null && task.dueAt > now);
}
