import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isoDate, parseQuickAdd } from '../shared/tasks.js';
import { jsonObject } from './agent-tools.js';

// ---- Add with Claude: a rambling quick-add entry becomes a clean task --------------------
// The user types or dictates a task with its context ("Draft investor memo for September, schedule for
// Friday, I'm waiting for the numbers from Tobias"). One quick model call, without tools, turns that into
// a short title, the context as notes, one of the existing labels and a date. People's names are spelled
// from the brain's people pages, so a dictated "Tobias" comes out as Tove.

export type PolishedTask = { title: string; notes: string; label: string | null; dueAt: string | null };

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// A date word Claude leaves at the end of a title ("Ring Ludde imorgon") is already the due date.
const TRAILING_DATE = /\s+(?:today|tonight|tomorrow|(?:on |next |this )?(?:mon|tues|wednes|thurs|fri|satur|sun)day|idag|ikväll|imorgon|i morgon|(?:på )?(?:mån|tis|ons|tors|fre|lör|sön)dag)$/i;
const MAX_PEOPLE = 400;

// One line per person page: the H1 name and, when the page has one, the role from its Status line.
export function brainPeople(brainDir: string | null | undefined): string[] {
  const dir = brainDir ? join(brainDir, 'people') : null;
  if (!dir || !existsSync(dir)) return [];
  const people: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.md') || name.toLowerCase() === 'readme.md') continue;
    try {
      const head = readFileSync(join(dir, name), 'utf8').slice(0, 1500);
      const title = head.match(/^# (.+)$/m)?.[1].trim();
      if (!title || /\(retired/i.test(title)) continue;
      // "Status: Active — Head of Finance (DR…)" or "Status: Active mgmt team. CPO; owns…" → the role words.
      const status = head.match(/Status:\s*([^|\n]+)/)?.[1] || '';
      const role = status.replace(/^\s*(active|inactive)\b\s*[—–:-]?\s*/i, '').split(/[;(]/)[0].trim().replace(/[.,]$/, '');
      people.push(role ? `${title} (${role.slice(0, 60)})` : title);
    } catch { /* an unreadable page is skipped */ }
    if (people.length >= MAX_PEOPLE) break;
  }
  return people;
}

export function polishInstructions() {
  return [
    'You turn one spoken or typed note into a task for a busy CEO\'s task list. Reply with JSON only:',
    '{"title": "...", "notes": "...", "label": "..." or null, "dueAt": "YYYY-MM-DD" or null}',
    '- title: what to do, starting with a verb, at most 70 characters, sentence case, no full stop. Keep his words where they work. No date words in the title.',
    '- notes: the useful context from the note that is not in the title: who or what it waits on, why, details. Plain short sentences. Leave out the date and label, they have their own fields. Empty string when there is none. Never invent facts.',
    '- label: labels route a task to a meeting (mgmt, board, a 1:1). Use one of the existing labels only when the note names it or says the item is to be raised in that meeting. A meeting mentioned only as background is not a reason. Otherwise null. Never make up a label.',
    '- dueAt: the date the note asks for, worked out from today. A weekday means its next occurrence, today included. null when the note gives no date.',
    '- Dictation mishears names: when a name in the note is clearly a misspelling of someone in the known people list, use that spelling. A name or nickname that already appears in the list stays as written. Leave other names alone.',
    '- Write in the language of the note. No em dashes.',
  ].join('\n');
}

export function polishPrompt(text: string, context: { today: Date; labels: string[]; people: string[] }) {
  const { today, labels, people } = context;
  return [
    `Today: ${weekdays[today.getDay()]} ${isoDate(today)}`,
    `Existing labels: ${labels.length ? labels.join(', ') : '(none)'}`,
    people.length ? `Known people:\n${people.join('\n')}` : 'Known people: (none)',
    '',
    `Note:\n${text.trim()}`,
  ].join('\n');
}

// Checks the model's reply. Anything it gets wrong falls back to what the user typed: an explicit #label or
// wins, a date word is used when Claude gives no date, and an unusable title means the entry is added as typed.
export function readPolished(reply: string, text: string, labels: string[], today = new Date()): PolishedTask {
  const typed = parseQuickAdd(text, today);
  const value = jsonObject<Record<string, unknown>>(reply);
  const title = typeof value.title === 'string' ? value.title.replace(/\s+/g, ' ').trim().replace(/[.。]$/, '') : '';
  if (!title || title.length > 240) throw new Error('Claude did not return a usable title');
  const notes = typeof value.notes === 'string' ? value.notes.trim().slice(0, 20_000) : '';
  const known = new Set(labels.map((label) => label.toLowerCase()));
  const proposed = typeof value.label === 'string' ? value.label.trim().replace(/^#/, '').toLowerCase() : '';
  const label = typed.label ?? (known.has(proposed) ? proposed : null);
  const date = typeof value.dueAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.dueAt) && !Number.isNaN(Date.parse(value.dueAt)) ? value.dueAt : null;
  const dueAt = date ?? typed.dueAt;
  const trimmed = dueAt ? title.replace(TRAILING_DATE, '') : title;
  return { title: trimmed || title, notes, label, dueAt };
}
