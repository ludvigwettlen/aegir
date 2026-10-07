import {
  AlarmClock, CalendarDays, CalendarX, Check, ExternalLink, FilePenLine, FileText, Flag, Hash, ListOrdered, Maximize2, MessageSquare, Minimize2, Paperclip,
  PenLine, Plus, RotateCcw, Sparkles, Square, Tag, Trash2, Undo2, X,
} from 'lucide-react';
import type { Priority, Snapshot, Task, TaskChange } from '../../../shared/types';
import type { ReviewTarget } from '../../../shared/review';
import { rankCommands } from '../../../shared/command-search';
import { parseWhen } from '../../../shared/tasks';
import type { Command, CommandOption } from '../commands';

export type TaskActions = {
  data: Snapshot;
  agent: string;
  focused: boolean;
  update: (change: TaskChange) => void;
  // Your band (null hands it back to Claude), and a run of Claude's prioritization over every task now.
  setPriority: (priority: Priority | null) => void;
  prioritize: () => void;
  openBox: (kind: 'handoff' | 'due' | 'snooze') => void;
  edit: (target: 'title' | 'notes' | 'chat') => void;
  toggleFocus: () => void;
  openOutput: () => void;
  attachClipboard: () => void;
  openConversation: () => void;
  dismiss: () => void;
  stop: () => void;
  remove: () => void;
  // Markdown drafts the task can be reviewed on in the browser; empty when it can't be right now.
  reviewFiles: ReviewTarget[];
  review: (target: ReviewTarget) => void;
};

// Pick an existing label or type a new one; the same cleanup as the ⌘L box.
function labelOptions(task: Task, a: TaskActions, query: string): CommandOption[] {
  const labels = [...new Set(a.data.tasks.map((item) => item.label).filter((label): label is string => !!label))].sort();
  const typed = query.replace(/^#/, '').trim().toLowerCase();
  const options: CommandOption[] = rankCommands(labels.map((label) => ({
    id: `label.${label}`, title: label, icon: Hash, current: label === task.label, run: () => a.update({ label }),
  })), typed);
  if (typed && !labels.includes(typed)) options.unshift({ id: 'label.new', title: `Create label #${typed}`, icon: Plus, run: () => a.update({ label: typed }) });
  if (task.label && !typed) options.push({ id: 'label.none', title: 'No label', icon: X, run: () => a.update({ label: null }) });
  return options;
}

// Typing a date (tomorrow, fri, 3 days, 20 oct) puts "Set due date to …" at the top, like Godspeed does for "today".
export function dateCommands(query: string, a: TaskActions, today = new Date()): Command[] {
  const due = parseWhen(query, today);
  if (!due) return [];
  const [year, month, day] = due.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const days = Math.round((date.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000);
  const label = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(year !== today.getFullYear() ? { year: 'numeric' } : {}) });
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days > 1 ? `in ${days} days` : `${-days} days ago`;
  return [{ id: 'task.due.typed', section: 'task', title: `Set due date to ${label}`, subtitle: when, icon: CalendarDays, run: () => a.update({ dueAt: due }) }];
}

// Runs Claude's prioritization over the whole list now; shown with or without a selected task.
export const prioritizeCommand = {
  id: 'tasks.prioritize', title: 'Prioritize with Claude', subtitle: 'Claude bands every task you have not set yourself', icon: ListOrdered,
  keywords: ['triage', 'rank', 'sort', 'priorities', 'reprioritize', 'order'],
} as const;

// What the palette offers for the selected task. Keys and conditions mirror the task list's key handler and the task panel's buttons.
export function taskCommands(task: Task, a: TaskActions): Command[] {
  const commands: Command[] = [];
  const add = (command: Omit<Command, 'section'>) => commands.push({ ...command, section: 'task' });
  const thread = a.data.threads.find((item) => item.id === task.threadId);
  const status = task.status;
  if (status === 'done') add({ id: 'task.reopen', title: 'Reopen', icon: RotateCcw, keys: 'Space', keywords: ['undo', 'not done', 'restore'], run: () => a.update({ status: 'ready' }) });
  if (status === 'ready' || status === 'review' || status === 'blocked')
    add({ id: 'task.done', title: 'Mark done', icon: Check, keys: 'Space', keywords: ['complete', 'finish', 'check', 'tick'], run: () => a.update({ status: 'done' }) });
  if (status === 'proposed') add({ id: 'task.accept', title: 'Accept suggestion', icon: Check, keys: 'Y', keywords: ['approve', 'keep', 'yes'], run: () => a.update({ status: 'ready' }) });
  if (!task.threadId && status !== 'running' && status !== 'done')
    add({ id: 'task.ask', title: `Ask ${a.agent}…`, icon: Sparkles, keys: 'A', keywords: ['hand off', 'delegate', 'agent', 'claude'], run: () => a.openBox('handoff') });
  if (task.threadId) add({ id: 'task.reply', title: `Reply to ${a.agent}`, icon: MessageSquare, keys: 'A', keywords: ['chat', 'message', 'agent'], run: () => a.edit('chat') });
  const files = a.reviewFiles;
  const reviewKeywords = ['human review', 'edit draft', 'comment', 'browser', 'feedback'];
  if (files.length === 1)
    add({ id: 'task.review', title: 'Review in browser', subtitle: files[0].path, icon: FilePenLine, keys: 'R', keywords: reviewKeywords, run: () => a.review(files[0]) });
  else if (files.length > 1)
    add({
      id: 'task.review', title: 'Review in browser…', icon: FilePenLine, keys: 'R', keywords: reviewKeywords,
      step: {
        title: 'Review in browser', placeholder: 'Pick a draft…', empty: 'No draft matches.',
        options: (query) => rankCommands(files.map((file) => ({ id: `review.${file.path}`, title: file.path, icon: FileText, run: () => a.review(file) })), query),
      },
    });
  if (status === 'ready') add({ id: 'task.snooze', title: 'Snooze…', icon: AlarmClock, keys: 'S', keywords: ['later', 'postpone', 'defer'], run: () => a.openBox('snooze') });
  add({ id: 'task.due', title: 'Set due date…', icon: CalendarDays, keys: 'D', keywords: ['date', 'deadline', 'schedule', 'when'], run: () => a.openBox('due') });
  if (task.dueAt) add({ id: 'task.due.clear', title: 'Clear due date', icon: CalendarX, keys: '⇧ D', keywords: ['remove date', 'no date'], run: () => a.update({ dueAt: null }) });
  add({
    id: 'task.label', title: 'Set label…', icon: Tag, keys: '⌘ L', keywords: ['tag', 'category'],
    step: { title: 'Set label', placeholder: 'Search or create a label…', empty: 'No labels yet. Type a name to create one.', options: (query) => labelOptions(task, a, query) },
  });
  if (task.label) add({ id: 'task.label.clear', title: 'Clear label', icon: X, keys: '⇧ B', keywords: ['remove label', 'untag'], run: () => a.update({ label: null }) });
  if (status !== 'done' && status !== 'dismissed') {
    const meaning = { 1: 'a commitment this week', 2: 'real work, this week or next', 3: 'would be good, no rush' } as const;
    for (const band of [1, 2, 3] as Priority[])
      add({
        id: `task.priority.${band}`, title: `Set priority P${band}`, subtitle: task.priority === band ? `${task.prioritySource === 'agent' ? 'Claude set this' : 'Current'} · ${meaning[band]}` : meaning[band],
        icon: Flag, keys: String(band), keywords: ['priority', 'importance', `p${band}`, ...(band === 1 ? ['urgent', 'top', 'important'] : band === 3 ? ['low', 'someday', 'later'] : ['medium', 'normal'])],
        run: () => a.setPriority(band),
      });
    if (task.prioritySource === 'user')
      add({ id: 'task.priority.clear', title: 'Hand priority back to Claude', icon: Undo2, keys: '0', keywords: ['clear priority', 'remove priority', 'claude decides', 'reset'], run: () => a.setPriority(null) });
  }
  add({ ...prioritizeCommand, run: a.prioritize });
  add({ id: 'task.title', title: 'Edit title', icon: PenLine, keys: 'Enter', keywords: ['rename'], run: () => a.edit('title') });
  add({ id: 'task.notes', title: 'Edit context', icon: FileText, keys: 'N', keywords: ['notes', 'details', 'description'], run: () => a.edit('notes') });
  if (thread && a.data.groups.some((group) => group.id === thread.groupId))
    add({ id: 'task.thread', title: 'Open conversation in channel', icon: ExternalLink, keys: '⇧ A', keywords: ['thread', 'chat', 'group'], run: a.openConversation });
  add(a.focused
    ? { id: 'task.focus', title: 'Exit full screen', icon: Minimize2, keys: 'F', keywords: ['focus', 'leave'], run: a.toggleFocus }
    : { id: 'task.focus', title: 'Full screen', icon: Maximize2, keys: 'F', keywords: ['focus', 'expand', 'zoom'], run: a.toggleFocus });
  if (task.outputDir || a.data.taskLinks.some((link) => link.taskId === task.id))
    add({ id: 'task.output', title: 'Open output or attachment', icon: ExternalLink, keys: '⌘ O', keywords: ['files', 'folder', 'link'], run: a.openOutput });
  add({ id: 'task.attach', title: 'Attach copied link or file', icon: Paperclip, keys: '⌘ V', keywords: ['paste', 'clipboard', 'url'], run: a.attachClipboard });
  if (status === 'running') add({ id: 'task.stop', title: `Stop ${a.agent}`, icon: Square, keywords: ['cancel', 'halt', 'agent'], run: a.stop });
  if (status === 'ready' || status === 'review' || status === 'blocked')
    add({ id: 'task.dismiss', title: 'Dismiss', icon: X, keywords: ['drop', 'ignore', 'hide'], run: a.dismiss });
  if (status === 'proposed') add({ id: 'task.remove', title: 'Dismiss suggestion', icon: X, keys: '⌫', keywords: ['reject', 'no', 'remove'], run: a.remove });
  else if (status !== 'running') add({ id: 'task.remove', title: 'Delete task', icon: Trash2, keys: '⌫', keywords: ['remove', 'trash'], run: a.remove });
  return commands;
}
