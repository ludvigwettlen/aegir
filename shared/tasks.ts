import type { Priority, Task } from './types.js';

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

// "Summarise calls #customers fri !1" → title, label, due date and priority. Only the first of each is used.
export function parseQuickAdd(text: string, today = new Date()): { title: string; label: string | null; dueAt: string | null; priority: Priority | null } {
  let label: string | null = null; let dueAt: string | null = null; let priority: Priority | null = null;
  const kept = text.trim().split(/\s+/).filter(token => {
    const tag = token.match(/^#([\w-]+)$/);
    if (tag && !label) { label = tag[1].toLowerCase(); return false; }
    const band = token.match(/^!([123])$/);
    if (band && !priority) { priority = Number(band[1]) as Priority; return false; }
    const due = dueAt ? null : parseDue(token, today);
    if (due) { dueAt = due; return false; }
    return true;
  });
  return { title: kept.join(' '), label, dueAt, priority };
}

// Where a task came from, in one word: the sweep that suggested it (gmail, slack, calendar), reminders, or null
// for a task typed in Legolas.
export function sourceKind(sourceKey: string | null | undefined): string | null {
  if (!sourceKey) return null;
  if (sourceKey.startsWith('reminders:')) return 'reminders';
  const key = sourceKey.replace(/^inbox:/, '');
  return key.match(/^(gmail|slack|calendar|notion|hubspot|fathom|meeting)/)?.[1] ?? (sourceKey.startsWith('inbox:') ? 'inbox' : sourceKey.split(':')[0]);
}

// The lists you work from are grouped by how much a task matters, not by label.
export const PRIORITY_GROUPS = ['P1', 'P2', 'P3', 'Not prioritized yet'] as const;
export const priorityGroup = (task: Pick<Task, 'priority'>) => PRIORITY_GROUPS[(task.priority ?? 4) - 1];
export const bandedLists: TaskView[] = ['today', 'upcoming', 'inbox'];

const statusRank: Record<Task['status'], number> = { review: 0, blocked: 1, proposed: 2, running: 3, ready: 4, done: 5, dismissed: 6 };
// What needs you first, then the earliest date (overdue comes first on its own), then the oldest.
const byStatus = (a: Task, b: Task) => statusRank[a.status] - statusRank[b.status]
  || (a.dueAt || '9999').localeCompare(b.dueAt || '9999')
  || a.createdAt.localeCompare(b.createdAt);
// The lists you work from: priority first, then as above.
export function compareTasks(a: Task, b: Task): number {
  return (a.priority ?? 4) - (b.priority ?? 4) || byStatus(a, b);
}

// The groups a list shows, in order. Today, Upcoming and the Inbox group by priority band, with suggestions
// pinned on top of the Inbox. Needs you groups by status (it is a review queue); Delegated by label.
export function taskGroups(list: TaskView, tasks: Task[], statusText: Record<Task['status'], string>): [string, Task[]][] {
  if (list === 'completed') return tasks.length ? [['Completed', tasks]] : [];
  const groups = new Map<string, Task[]>();
  const keyOf = (task: Task) =>
    list === 'needs' ? statusText[task.status]
      : list === 'inbox' && task.status === 'proposed' ? 'Suggested'
        : bandedLists.includes(list) ? priorityGroup(task)
          : task.label ? `#${task.label}` : 'No label';
  // Delegated is read for what the agent is waiting on, so status leads there; elsewhere priority does.
  for (const task of [...tasks].sort(list === 'team' ? byStatus : compareTasks)) groups.set(keyOf(task), [...(groups.get(keyOf(task)) || []), task]);
  const order = (name: string) => name === 'Suggested' ? -1 : PRIORITY_GROUPS.includes(name as typeof PRIORITY_GROUPS[number]) ? PRIORITY_GROUPS.indexOf(name as typeof PRIORITY_GROUPS[number]) : 10;
  if (list === 'needs') {
    const statuses = (Object.keys(statusRank) as Task['status'][]).map((status) => statusText[status]);
    return [...groups].sort(([a], [b]) => statuses.indexOf(a) - statuses.indexOf(b));
  }
  if (list === 'team') return [...groups].sort(([a], [b]) => (a === 'No label' ? 1 : b === 'No label' ? -1 : a.localeCompare(b)));
  return [...groups].sort(([a], [b]) => order(a) - order(b));
}

export type TaskView = 'inbox' | 'today' | 'upcoming' | 'team' | 'needs' | 'completed';

// An agent has the task, or has handed it back: working on it, finished and waiting for review, or stopped.
export const inHand = (task: Pick<Task, 'status'>) => task.status === 'running' || task.status === 'review' || task.status === 'blocked';
// Whose move it is on a delegated task, as the row says it. Everything is Malcolm's in the end; this says who acts next.
export function ballText(task: Pick<Task, 'status'>): { text: string; yours: boolean } | null {
  if (task.status === 'review') return { text: 'Your review', yours: true };
  if (task.status === 'blocked') return { text: 'Stopped, your move', yours: true };
  if (task.status === 'running') return { text: 'Claude working', yours: false };
  return null;
}

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

// A task you just sent to the agent stays in the list you sent it from until you move on, even when its new
// status belongs elsewhere (an Inbox task becomes team work). `held` is the task as it was when you sent: the
// list is worked out as if its status hadn't changed, so the row keeps its group and place, while a new date
// or label applies as usual. Once it's done, dismissed or deleted it's an ordinary task again.
export function withHeld(view: TaskView, tasks: Task[], held: Task | null | undefined, today = new Date()): Task[] {
  const live = held && tasks.find(task => task.id === held.id);
  if (!held || !live || live.status === 'done' || live.status === 'dismissed') return tasksFor(view, tasks, today);
  // The band is kept as sent too: Claude re-banding the task while you talk to the agent must not move it away.
  const asSent: Task = { ...live, status: held.status, completedAt: held.completedAt, priority: held.priority, prioritySource: held.prioritySource };
  return tasksFor(view, tasks.map(task => (task.id === live.id ? asSent : task)), today);
}

// Needs you = suggested tasks, team work ready for review, and blocked team work. The team list = anything an agent has taken on.
// Inbox = all new intake: your own undated tasks that nobody has picked up (phone captures land here) plus agent
// suggestions, which also stay in Needs you. Work with the agent sits in the team list, never in the Inbox. Today = due today or
// overdue, plus, when they have no date, every P1 and everything an agent is working on or has handed back (working, ready for
// review, stopped), so delegating a task never takes it off the list you open. A date always wins: a P1 or a delegated task dated
// Friday waits in Upcoming until Friday (Malcolm, 7 Oct 2026). Upcoming = later.
export function tasksFor(view: TaskView, tasks: Task[], today = new Date()): Task[] {
  const now = isoDate(today);
  if (view === 'completed') return tasks.filter(task => task.status === 'done').sort((a, b) => (b.completedAt || b.updatedAt).localeCompare(a.completedAt || a.updatedAt));
  const open = tasks.filter(task => task.status !== 'done' && task.status !== 'dismissed');
  if (view === 'needs') return open.filter(task => task.status === 'proposed' || task.status === 'review' || task.status === 'blocked');
  if (view === 'team') return open.filter(task => task.threadId !== null);
  if (view === 'inbox') return open.filter(task => task.status === 'proposed' || (task.status === 'ready' && !task.dueAt));
  if (view === 'today') return open.filter(task => (task.dueAt === null
    ? task.priority === 1 || inHand(task)
    : task.dueAt <= now && (task.status !== 'proposed' || task.priority === 1)));
  return open.filter(task => task.status !== 'proposed' && task.dueAt !== null && task.dueAt > now);
}
