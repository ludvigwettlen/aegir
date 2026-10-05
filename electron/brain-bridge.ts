import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Task } from '../shared/types.js';
import { tasksFor } from '../shared/tasks.js';
import type { Store } from './db.js';
import { taskSourceKey } from './agent-tools.js';

// ---- Inbox: suggestions written by scheduled jobs outside the app ------------------------
// A *.json file holds one suggestion or an array of them. A *.md file holds one suggestion: a
// front-matter header (title, sourceKey, sourceUrl, label, dueAt) and the notes as its body, which
// is easier for agents to write than escaped JSON. Files younger than two seconds are left for
// later so the app never reads half a file.
// A close entry ({ close: <sourceKey>, reason? }, or front matter with close: and no title) marks the
// suggestion with that key done when the user already acted at the source. Closes run after every
// suggestion in the same pass, and only touch tasks that are still suggested or to do.
export type InboxItem = { title: string; notes: string; sourceUrl: string | null; sourceKey: string | null; label: string | null; dueAt: string | null };

export function parseInboxItem(raw: unknown): InboxItem {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Each suggestion must be a JSON object');
  const value = raw as Record<string, unknown>;
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  if (!title || title.length > 240) throw new Error('title must be 1–240 characters');
  const notes = typeof value.notes === 'string' ? value.notes : '';
  if (notes.length > 20_000) throw new Error('notes must be at most 20,000 characters');
  const sourceUrl = typeof value.sourceUrl === 'string' && value.sourceUrl.trim() ? value.sourceUrl.trim() : null;
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) throw new Error('sourceUrl must start with http:// or https://');
  const sourceKey = typeof value.sourceKey === 'string' && value.sourceKey.trim() ? value.sourceKey.trim() : null;
  if (sourceKey && !/^[\w:.\-/]{1,200}$/.test(sourceKey)) throw new Error('sourceKey may only use letters, digits and : . - _ /');
  const label = typeof value.label === 'string' && value.label.trim() ? value.label.trim().replace(/^#/, '').toLowerCase().slice(0, 40) : null;
  const dueAt = typeof value.dueAt === 'string' && value.dueAt.trim() ? value.dueAt.trim() : null;
  if (dueAt && !/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) throw new Error('dueAt must be YYYY-MM-DD');
  return { title, notes, sourceUrl, sourceKey, label, dueAt };
}

export type InboxClose = { close: string; reason: string | null };

export function parseInboxClose(value: Record<string, unknown>): InboxClose {
  if (value.title !== undefined) throw new Error('A close entry must not have a title');
  const close = typeof value.close === 'string' ? value.close.trim() : '';
  if (!/^[\w:.\-/]{1,200}$/.test(close)) throw new Error('close must be a sourceKey of letters, digits and : . - _ /');
  const reason = typeof value.reason === 'string' && value.reason.trim() ? value.reason.trim().split(/\r?\n/)[0].slice(0, 240) : null;
  return { close, reason };
}

const isClose = (raw: unknown): raw is Record<string, unknown> => !!raw && typeof raw === 'object' && !Array.isArray(raw) && 'close' in raw;

export function parseInboxMarkdown(text: string): Record<string, string> {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error('A Markdown suggestion needs a front-matter header between --- lines');
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^(\w+):\s*(.*)$/);
    if (pair) fields[pair[1]] = pair[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { ...fields, notes: match[2].trim() };
}

export function importInbox(store: Pick<Store, 'hasTaskSource' | 'createTask' | 'taskBySource' | 'updateTask'>, dir: string, now = Date.now()) {
  const counts = { created: 0, skipped: 0, rejected: 0, closed: 0 };
  if (!existsSync(dir)) return counts;
  const closes: InboxClose[] = [];
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.json') || file.endsWith('.md')).sort()) {
    const path = join(dir, name);
    if (now - statSync(path).mtimeMs < 2000) continue;
    try {
      const text = readFileSync(path, 'utf8');
      const raw: unknown = name.endsWith('.md') ? parseInboxMarkdown(text) : JSON.parse(text);
      const entries = Array.isArray(raw) ? raw : [raw];
      const fileCloses = entries.filter(isClose).map(parseInboxClose);
      const items = entries.filter((entry) => !isClose(entry)).map(parseInboxItem);
      for (const item of items) {
        // The same key never comes back, even after the task is dismissed or done.
        const key = item.sourceKey ? `inbox:${item.sourceKey}` : taskSourceKey('inbox', item.sourceUrl || '', item.title);
        if (store.hasTaskSource(key)) { counts.skipped++; continue; }
        store.createTask({ title: item.title, notes: item.notes, label: item.label, dueAt: item.dueAt, status: 'proposed', sourceUrl: item.sourceUrl, sourceKey: key });
        counts.created++;
      }
      closes.push(...fileCloses);
      mkdirSync(join(dir, 'processed'), { recursive: true });
      renameSync(path, join(dir, 'processed', name));
    } catch (error) {
      mkdirSync(join(dir, 'rejected'), { recursive: true });
      writeFileSync(join(dir, 'rejected', `${name}.error.txt`), `${String(error)}\n`);
      renameSync(path, join(dir, 'rejected', name));
      counts.rejected++;
    }
  }
  for (const { close, reason } of closes) {
    const task = store.taskBySource(`inbox:${close}`);
    if (!task || (task.status !== 'proposed' && task.status !== 'ready')) { counts.skipped++; continue; }
    store.updateTask(task.id, { status: 'done', notes: `${task.notes ? `${task.notes}\n\n` : ''}Closed automatically: ${reason || 'acted on at the source'}` });
    counts.closed++;
  }
  return counts;
}

// ---- Export: a readable copy of the task list for the brain and other skills -------------
const statusWord: Record<Task['status'], string> = {
  proposed: 'suggested', ready: 'to do', running: 'agent working', review: 'ready for review',
  blocked: 'blocked', done: 'done', dismissed: 'dismissed',
};

function line(task: Task) {
  const parts = [`**${task.title}**`, statusWord[task.status]];
  if (task.label) parts.push(`#${task.label}`);
  if (task.dueAt) parts.push(`due ${task.dueAt}`);
  if (task.sourceUrl) parts.push(`[source](${task.sourceUrl})`);
  const note = task.notes.trim().split('\n').find((text) => text.trim());
  return `- ${parts.join(' · ')}${note ? `\n  ${note.trim().slice(0, 200)}` : ''}`;
}

export function renderTaskExport(tasks: Task[], today = new Date()): string {
  const weekAgo = new Date(today.getTime() - 7 * 86_400_000).toISOString();
  const sections: [string, Task[]][] = [
    ['Needs you', tasksFor('needs', tasks, today)],
    ['Today', tasksFor('today', tasks, today).filter((task) => task.status === 'ready')],
    ['Inbox (no date)', tasksFor('inbox', tasks, today).filter((task) => task.status === 'ready')],
    ['Upcoming', tasksFor('upcoming', tasks, today).filter((task) => task.status === 'ready')],
    ['Agent working', tasks.filter((task) => task.status === 'running')],
    ['Done in the last 7 days', tasksFor('completed', tasks, today).filter((task) => (task.completedAt || task.updatedAt) >= weekAgo)],
  ];
  const body = sections.map(([title, list]) => `## ${title} (${list.length})\n\n${list.map(line).join('\n') || '_None._'}\n`).join('\n');
  return `---\ntitle: Legolas tasks\ntype: export\n---\n\n# Legolas tasks\n\nLegolas rewrites this file whenever a task changes. Change tasks in Legolas, not here.\n\n${body}`;
}

// Writes only when the content changed, so the brain's git history shows real task changes.
export function exportTasks(tasks: Task[], dir: string): boolean {
  if (!existsSync(dir)) return false;
  const markdown = renderTaskExport(tasks);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const current = tasks.filter((task) => task.status !== 'dismissed' && (task.status !== 'done' || (task.completedAt || task.updatedAt) >= weekAgo));
  const json = `${JSON.stringify(current, null, 1)}\n`;
  const mdPath = join(dir, 'legolas-tasks.md');
  const jsonPath = join(dir, 'legolas-tasks.json');
  let changed = false;
  if (!existsSync(mdPath) || readFileSync(mdPath, 'utf8') !== markdown) { writeFileSync(mdPath, markdown); changed = true; }
  if (!existsSync(jsonPath) || readFileSync(jsonPath, 'utf8') !== json) { writeFileSync(jsonPath, json); changed = true; }
  return changed;
}
