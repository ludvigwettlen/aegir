import type { Task } from './types.js';
import { tasksFor, type TaskView } from './tasks.js';

// ---- Find a task: one search across every list -----------------------------------------------
// ⌘F, the sidebar's search bar and "Find a task…" in ⌘K all use this. Every word typed must match the task's title,
// its label or its context (notes); case and accents don't matter, so "jobbspranget" finds Jobbsprånget. A title match
// ranks above a label match, which ranks above one only in the context. Open tasks come before finished ones, then the
// most recently changed. Dismissed tasks are on no list, so they are never found.

export type TaskMatch = { task: Task; list: TaskView; snippet: string | null };

// The full-text query for task conversations (SQLite FTS5): every word a prefix, all required, case and accents left
// to the index. Words are split the way the index splits text, and quoted so nothing typed is read as an operator.
// Null when there is too little to search for.
export function conversationQuery(text: string): string | null {
  const words = (text.normalize('NFC').match(/[\p{L}\p{N}]+/gu) || []).slice(0, 8);
  if (words.join('').length < 2) return null;
  return words.map((word) => `"${word}"*`).join(' ');
}

// Lower case without accents, so å, ä and ö match a, a and o.
export const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const views: TaskView[] = ['today', 'upcoming', 'inbox', 'needs', 'team'];
// The list a found task opens in: the one you work from first. Finished tasks open in Completed.
export function homeList(task: Task, today = new Date()): TaskView | null {
  if (task.status === 'dismissed') return null;
  if (task.status === 'done') return 'completed';
  return views.find((view) => tasksFor(view, [task], today).length > 0) ?? null;
}

const oneLine = (text: string) => text.replace(/^#+ /gm, '').replace(/\s+/g, ' ').trim();
// A few words either side of the first place the context matches, for a match that is not in the title.
function snippetFor(notes: string, token: string) {
  const flat = oneLine(notes);
  const at = fold(flat).indexOf(token);
  if (at < 0) return null;
  const start = Math.max(0, flat.lastIndexOf(' ', Math.max(0, at - 30)) + 1);
  const end = Math.min(flat.length, at + token.length + 50);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`;
}

// The folded text per task, kept while the task object lives: the palette searches the same snapshot on every keystroke.
const prepared = new WeakMap<Task, { title: string; label: string; notes: string }>();
const textOf = (task: Task) => {
  let text = prepared.get(task);
  if (!text) prepared.set(task, text = { title: fold(task.title), label: fold(task.label || ''), notes: fold(task.notes) });
  return text;
};

export function searchTasks(tasks: Task[], query: string, today = new Date(), limit = 50): TaskMatch[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  // Built once per search: does the word start a word in the title.
  const starts = new Map(words.map((raw) => [raw, new RegExp(`(^|[^a-z0-9])${raw.replace(/^#/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)]));
  const scored: { match: TaskMatch; score: number }[] = [];
  for (const task of tasks) {
    const list = homeList(task, today);
    if (!list) continue;
    if (!words.length) {
      // Nothing typed yet: the open tasks you touched last.
      if (task.status !== 'done') scored.push({ match: { task, list, snippet: null }, score: 0 });
      continue;
    }
    const { title, label, notes } = textOf(task);
    let score = 0;
    let snippet: string | null = null;
    let all = true;
    for (const raw of words) {
      // "#board" means the label.
      const word = raw.replace(/^#/, '');
      if (!word) continue;
      if (raw.startsWith('#')) {
        if (label.startsWith(word)) { score += 3; continue; }
        all = false; break;
      }
      if (starts.get(raw)!.test(title)) score += 4;
      else if (title.includes(word)) score += 3;
      else if (label.includes(word)) score += 2;
      else if (notes.includes(word)) { score += 1; snippet ??= snippetFor(task.notes, word); }
      else { all = false; break; }
    }
    if (!all) continue;
    if (words.length > 1 && title.includes(words.join(' '))) score += 3;
    scored.push({ match: { task, list, snippet }, score });
  }
  return scored
    .sort((a, b) => b.score - a.score
      || Number(a.match.task.status === 'done') - Number(b.match.task.status === 'done')
      || (b.match.task.updatedAt || '').localeCompare(a.match.task.updatedAt || ''))
    .slice(0, words.length ? limit : 15)
    .map(({ match }) => match);
}
