import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { Task } from '../shared/types.js';
import type { Store } from './db.js';

// Phone capture: what the user drops into an Apple Reminders list (Siri, Watch, lock screen) becomes
// a task, and the reminder is then ticked off so the phone list works as an inbox.
// The native helper (native/reminders/main.swift) does the EventKit work.

export type Reminder = {
  id: string;
  externalId?: string;
  title: string;
  notes: string;
  due?: string;
  dueTime?: string;
  dueInstant?: string;
  created?: string;
  modified?: string;
  url?: string;
  priority?: number;
  recurring?: boolean;
  hasAlarms?: boolean;
  locationAlarm?: boolean;
};

export class RemindersError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export interface RemindersSource {
  list(name: string): Promise<Reminder[]>;
  complete(id: string): Promise<void>;
}

export class RemindersHelper implements RemindersSource {
  constructor(private binary: string) {}

  private call(args: string[]): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      // The first call can sit on macOS's permission prompt, so allow it time.
      execFile(this.binary, args, { timeout: 320_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
        let output: Record<string, unknown> | null = null;
        try { output = JSON.parse(String(stdout).trim().split('\n').pop() || 'null'); } catch { /* reported below */ }
        if (output && output.ok === true) return resolve(output);
        if (output && output.ok === false) return reject(new RemindersError(String(output.code), String(output.error)));
        reject(new RemindersError('helper', error ? error.message : 'The Reminders helper returned no answer'));
      });
    });
  }

  async list(name: string) {
    const output = await this.call(['list', name]);
    return Array.isArray(output.reminders) ? (output.reminders as Reminder[]) : [];
  }

  async complete(id: string) {
    await this.call(['complete', id]);
  }
}

export function findRemindersHelper(candidates: string[]): string | null {
  return candidates.find((path) => existsSync(path)) || null;
}

// ---- What survives between passes -------------------------------------------------------
// imported: every reminder ever turned into a task (by id and external id), so deleting the task
//   never makes a reopened reminder come back.
// pending: imported, still to be ticked off (a tick-off failed, or the app quit mid-pass).
// waiting: imported reminders with a timed alert, ticked off only once that time has passed.
export type CaptureLedger = { imported: string[]; pending: string[]; waiting: Record<string, string> };
const MAX_IMPORTED = 5000;

export function parseLedger(raw: string | null | undefined, legacyPending?: string | null): CaptureLedger {
  const ledger: CaptureLedger = { imported: [], pending: [], waiting: {} };
  try {
    const value = JSON.parse(raw || 'null');
    if (value && typeof value === 'object') {
      if (Array.isArray(value.imported)) ledger.imported = value.imported.filter((item: unknown) => typeof item === 'string');
      if (Array.isArray(value.pending)) ledger.pending = value.pending.filter((item: unknown) => typeof item === 'string');
      if (value.waiting && typeof value.waiting === 'object')
        for (const [id, at] of Object.entries(value.waiting)) if (typeof at === 'string') ledger.waiting[id] = at;
    }
  } catch { /* a damaged ledger starts empty; the task rows still stop duplicates */ }
  try {
    const legacy = JSON.parse(legacyPending || 'null');
    if (Array.isArray(legacy)) for (const id of legacy) if (typeof id === 'string' && !ledger.pending.includes(id)) ledger.pending.push(id);
  } catch { /* ignore */ }
  return ledger;
}

// ---- Mapping one reminder to a task -----------------------------------------------------
const URL_PATTERN = /https?:\/\/[^\s<>"'“”‘’]+/g;
// Sentence punctuation and closing brackets right after a link belong to the sentence, not the link.
const cleanUrl = (url: string) => url.replace(/[.,;:!?)\]}>]+$/, '');
const urlsIn = (text: string) => (text.match(URL_PATTERN) || []).map(cleanUrl).filter((url) => /^https?:\/\/\S+\.\S+/.test(url));

// A capture keeps the user's own words. Only a typed #label is lifted out; the due date comes from
// the reminder itself, never from guessing at words like "fri" (also Swedish for "free").
export function taskFromReminder(reminder: Reminder, now = new Date()) {
  const raw = reminder.title.replace(/\s+/g, ' ').trim();
  let label: string | null = null;
  const words = raw.split(' ').filter((word) => {
    const tag = word.match(/^#([\p{L}\p{N}_-]+)$/u);
    if (tag && !label) { label = tag[1].toLowerCase(); return false; }
    return true;
  });
  const titleLinks = urlsIn(raw);
  const links = [...new Set([...titleLinks, ...urlsIn(reminder.notes), ...(reminder.url ? urlsIn(reminder.url) : [])])];
  // A capture that is mostly a link is something to read or listen to later.
  if (!label && titleLinks.length && raw.replace(URL_PATTERN, '').replace(/[^\p{L}\p{N}]/gu, '').length < 25) label = 'read';
  const text = words.join(' ') || 'Untitled reminder';
  const title = text.length > 240 ? `${text.slice(0, 239)}…` : text;
  const when = reminder.created && !Number.isNaN(Date.parse(reminder.created))
    ? new Date(reminder.created).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;
  const lines = [
    reminder.notes.trim(),
    text.length > 240 ? `Full capture: ${text}` : '',
    reminder.url && !reminder.notes.includes(reminder.url) && !raw.includes(reminder.url) ? `Link: ${reminder.url}` : '',
    ...stayNote(reminder, now),
    `Captured in Apple Reminders${when ? ` on ${when}` : ''}.`,
  ];
  return {
    title,
    notes: lines.filter(Boolean).join('\n\n'),
    label,
    dueAt: reminder.due && /^\d{4}-\d{2}-\d{2}$/.test(reminder.due) ? reminder.due : null,
    sourceKey: `reminders:${reminder.id}`,
    links,
  };
}

// What to tell the user about the reminder staying on the phone. Nothing once its alert has passed,
// because then it is ticked off on import.
function stayNote(reminder: Reminder, now: Date): string[] {
  const alert = alertDoneAt(reminder);
  if (alert === null || (alert !== 'never' && now.toISOString() >= alert)) return [];
  if (reminder.locationAlarm) return ['This reminder has a location alert, so it stays in Apple Reminders too.'];
  if (alert === 'never') return ['This reminder has an alert, so it stays in Apple Reminders too.'];
  if (reminder.dueTime) return [`Reminder set for ${reminder.dueTime}. It stays in Apple Reminders until then so the alert can fire.`];
  return ['It stays in Apple Reminders until the end of its day so the notification can fire.'];
}

// When a reminder may be ticked off without silencing its alert. null: right away (no alert).
// 'never': it stays in Reminders. Otherwise an ISO time after which the alert has had its chance.
export function alertDoneAt(reminder: Reminder): string | null | 'never' {
  if (reminder.locationAlarm) return 'never';
  if (reminder.due && reminder.dueTime) {
    const instant = reminder.dueInstant ? new Date(reminder.dueInstant) : new Date(`${reminder.due}T${reminder.dueTime}:00`);
    return Number.isNaN(instant.getTime()) ? 'never' : new Date(instant.getTime() + 5 * 60_000).toISOString();
  }
  // Alarms without a due time (absolute alarm dates) aren't exposed in a form we can schedule against.
  if (reminder.hasAlarms) return 'never';
  // A date without a time still notifies on that day, at the time set in the Reminders settings.
  if (reminder.due && /^\d{4}-\d{2}-\d{2}$/.test(reminder.due)) {
    const [year, month, day] = reminder.due.split('-').map(Number);
    const nextMorning = new Date(year, month - 1, day + 1, 0, 5);
    return Number.isNaN(nextMorning.getTime()) ? 'never' : nextMorning.toISOString();
  }
  return null;
}

export type SyncResult = { imported: number; completed: number; skipped: number; settling: number; keptForAlert: number; failed: number };
type SyncStore = Pick<Store, 'hasTaskSource' | 'createTask' | 'addTaskLink'>;
export const SETTLE_MS = 2 * 60_000;

// Order matters: the task is written to SQLite (and the ledger saved) before a reminder is ticked
// off, so a capture is never lost. A reminder is only ticked off by the pass that imported it, by a
// retry, or once its alert time has passed; a reminder the user reopens later is left alone.
export async function syncReminders(
  store: SyncStore,
  source: RemindersSource,
  list: string,
  ledger: CaptureLedger,
  options: { now?: Date; save?: () => void; keepGoing?: () => boolean } = {},
): Promise<SyncResult> {
  const now = options.now || new Date();
  const save = options.save || (() => {});
  const keepGoing = options.keepGoing || (() => true);
  const result: SyncResult = { imported: 0, completed: 0, skipped: 0, settling: 0, keptForAlert: 0, failed: 0 };
  const imported = new Set(ledger.imported);
  const remember = (reminder: Reminder) => {
    for (const key of [reminder.id, reminder.externalId && `ext:${reminder.externalId}`]) {
      if (key && !imported.has(key)) { imported.add(key); ledger.imported.push(key); }
    }
    if (ledger.imported.length > MAX_IMPORTED) ledger.imported.splice(0, ledger.imported.length - MAX_IMPORTED);
  };
  const tickOff = async (reminder: Reminder) => {
    try {
      await source.complete(reminder.id);
      result.completed++;
      return true;
    } catch (error) {
      // notFound: the reminder is already gone, so there is nothing left to tick off.
      if (error instanceof RemindersError && error.code === 'notFound') return true;
      result.failed++;
      return false;
    }
  };
  const listed = await source.list(list);
  let stopped = false;
  for (const reminder of listed) {
    if (!keepGoing()) { stopped = true; break; }
    // Ticking off a repeating reminder would end or advance the series; those stay in Reminders.
    if (reminder.recurring) { result.skipped++; continue; }
    const capture = taskFromReminder(reminder, now);
    const known = imported.has(reminder.id) || (!!reminder.externalId && imported.has(`ext:${reminder.externalId}`)) || store.hasTaskSource(capture.sourceKey);
    if (!known) {
      // Give the user time to finish typing notes or a date on the phone before taking it.
      const touched = Date.parse(reminder.modified || reminder.created || '');
      if (!Number.isNaN(touched) && now.getTime() - touched < SETTLE_MS) { result.settling++; continue; }
      const task: Task = store.createTask({ title: capture.title, notes: capture.notes, label: capture.label, dueAt: capture.dueAt, status: 'ready', sourceKey: capture.sourceKey });
      if (capture.links[0]) {
        try { store.addTaskLink(task.id, capture.links[0], false); } catch { /* the links are still in the title or notes */ }
      }
      remember(reminder);
      const alert = alertDoneAt(reminder);
      result.imported++;
      if (alert === 'never' || (alert && now.toISOString() < alert)) {
        if (alert !== 'never') ledger.waiting[reminder.id] = alert;
        result.keptForAlert++;
        save();
        continue;
      }
      // No alert, or its moment has already passed (an old backlog item): tick it off now.
      ledger.pending.push(reminder.id);
      save();
    } else if (!imported.has(reminder.id)) {
      // Imported before the ledger existed: remember it so a deleted task can't bring it back.
      remember(reminder);
      save();
    }
    if (ledger.pending.includes(reminder.id)) {
      if (await tickOff(reminder)) { ledger.pending = ledger.pending.filter((id) => id !== reminder.id); save(); }
    } else if (ledger.waiting[reminder.id]) {
      // The user may have snoozed, moved or changed the alert since import: decide on today's data.
      const alert = alertDoneAt(reminder);
      if (alert === 'never' || alert === null) {
        // A location alert now, or no alert left: either way it is the user's reminder again.
        delete ledger.waiting[reminder.id];
        save();
        if (alert === 'never') result.keptForAlert++; else result.skipped++;
      } else {
        if (alert !== ledger.waiting[reminder.id]) { ledger.waiting[reminder.id] = alert; save(); }
        if (now.toISOString() >= alert && await tickOff(reminder)) { delete ledger.waiting[reminder.id]; save(); }
        else result.keptForAlert++;
      }
    } else if (known) result.skipped++;
  }
  // Reminders the user ticked off or deleted on the phone drop out of the list. Forget their
  // pending and waiting entries, so reopening one later doesn't get it ticked off straight away.
  if (!stopped && keepGoing()) {
    const seen = new Set(listed.map((reminder) => reminder.id));
    const before = ledger.pending.length + Object.keys(ledger.waiting).length;
    ledger.pending = ledger.pending.filter((id) => seen.has(id));
    for (const id of Object.keys(ledger.waiting)) if (!seen.has(id)) delete ledger.waiting[id];
    if (ledger.pending.length + Object.keys(ledger.waiting).length !== before) save();
  }
  return result;
}
