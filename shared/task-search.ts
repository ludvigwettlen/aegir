import type { ContentMatch, Task } from './types.js';
import { tasksFor, type TaskView } from './tasks.js';

// ---- Find a task: one search across every list -----------------------------------------------
// ⌘K and the sidebar's search bar use this. Every word typed must be somewhere in the task: its title, its label, its
// context (notes), its conversation or the documents in its folder. The words can be in different places ("board pdf"
// finds the board task whose chat mentions the PDF). Case and accents don't matter, so "jobbspranget" finds
// Jobbsprånget. A title match ranks above a label match, which ranks above one only in the context, conversation or a
// document. Open tasks come before finished ones, then the most recently changed. Finished tasks are found too and open
// in Completed; dismissed tasks are on no list, so they are never found.

// content is set when a word was only in the task's conversation or a document: the row then quotes that.
export type TaskMatch = { task: Task; list: TaskView; snippet: string | null; content: ContentMatch | null };

// The words searched for, as both sides number them: the app's database answers with indices into this list.
export const searchWords = (query: string) => fold(query).split(/\s+/).filter(Boolean);
// Only the first few words are looked up in conversations and documents; later ones must be in the task itself.
export const CONTENT_WORDS = 8;

// The full-text query for one searched word in task conversations (SQLite FTS5): a prefix, case and accents left to the
// index. A word with punctuation ("q3-plan") becomes its parts, all required in one message. Parts are split the way the
// index splits text, and quoted so nothing typed is read as an operator. Null when there is too little to search for.
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
  if (['proposed', 'review', 'blocked'].includes(task.status)) return 'needs';
  if (task.listId) return `list:${task.listId}`;
  if (!task.dueAt) return 'inbox';
  return views.find((view) => tasksFor(view, [task], today).length > 0) ?? null;
}

// Agents write Markdown: headings, bold and code marks would show as raw characters in a one-line quote.
const oneLine = (text: string) => text.replace(/^#+ /gm, '').replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();
// A few words either side of the first place the text holds any of the words, for a match that is not in the title.
export function snippetFor(text: string, ...tokens: string[]) {
  const flat = oneLine(text);
  const folded = fold(flat);
  const hits = tokens.map((word) => [folded.indexOf(word), word] as const).filter(([at]) => at >= 0).sort((a, b) => a[0] - b[0]);
  if (!hits.length) return null;
  const [at, token] = hits[0];
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

// Conversation and document matches from two sources, one per task: the words either holds, quoting the one that holds
// more of them (the conversation when even).
export function mergeContent(...sources: ContentMatch[][]): ContentMatch[] {
  const merged = new Map<string, ContentMatch>();
  for (const match of sources.flat()) {
    const seen = merged.get(match.taskId);
    if (!seen) { merged.set(match.taskId, match); continue; }
    const words = [...new Set([...seen.words, ...match.words])].sort((a, b) => a - b);
    merged.set(match.taskId, { ...(match.words.length > seen.words.length ? match : seen), words });
  }
  return [...merged.values()].sort((a, b) => b.words.length - a.words.length);
}

// content: what the app's database found in conversations and documents, by task. Without it only the task's own
// fields are searched, which is instant; the palette searches again once content arrives.
export function searchTasks(tasks: Task[], query: string, today = new Date(), limit = 50, content?: ReadonlyMap<string, ContentMatch>): TaskMatch[] {
  const words = searchWords(query);
  // Built once per search: does the word start a word in the title.
  const starts = new Map(words.map((raw) => [raw, new RegExp(`(^|[^a-z0-9])${raw.replace(/^#/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)]));
  const scored: { match: TaskMatch; score: number }[] = [];
  for (const task of tasks) {
    const list = homeList(task, today);
    if (!list) continue;
    if (!words.length) {
      // Nothing typed yet: the open tasks you touched last.
      if (task.status !== 'done') scored.push({ match: { task, list, snippet: null, content: null }, score: 0 });
      continue;
    }
    const { title, label, notes } = textOf(task);
    let score = 0;
    let snippet: string | null = null;
    let quoted: ContentMatch | null = null;
    let all = true;
    const found = content?.get(task.id);
    for (const [index, raw] of words.entries()) {
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
      else if (found?.words.includes(index)) { score += 1; quoted = found; }
      else { all = false; break; }
    }
    if (!all) continue;
    if (words.length > 1 && title.includes(words.join(' '))) score += 3;
    scored.push({ match: { task, list, snippet, content: quoted }, score });
  }
  return scored
    .sort((a, b) => b.score - a.score
      || Number(a.match.task.status === 'done') - Number(b.match.task.status === 'done')
      || (b.match.task.updatedAt || '').localeCompare(a.match.task.updatedAt || ''))
    .slice(0, words.length ? limit : 15)
    .map(({ match }) => match);
}
