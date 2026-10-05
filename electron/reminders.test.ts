import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Task } from '../shared/types.js';
import { type CaptureLedger, parseLedger, type Reminder, RemindersError, type RemindersSource, SETTLE_MS, syncReminders, taskFromReminder } from './reminders.js';

const NOW = new Date('2026-10-05T12:00:00Z');
const OLD = new Date(NOW.getTime() - SETTLE_MS - 60_000).toISOString();

function fakeStore() {
  const tasks: Array<Record<string, unknown>> = [];
  const links: Array<[string, string, boolean]> = [];
  const events: string[] = [];
  return {
    tasks, links, events,
    hasTaskSource: (key: string) => tasks.some((task) => task.sourceKey === key),
    createTask: (input: Record<string, unknown>) => {
      const task = { ...input, id: `t${tasks.length + 1}` };
      tasks.push(task);
      events.push(`create ${String(input.sourceKey)}`);
      return task as unknown as Task;
    },
    addTaskLink: (id: string, url: string, undoable = true) => { links.push([id, url, undoable]); return { id: 'l', taskId: id, url } as never; },
  };
}
function fakeSource(reminders: Reminder[], store: ReturnType<typeof fakeStore>, failures: Record<string, string> = {}): RemindersSource & { completed: string[] } {
  const completed: string[] = [];
  return {
    completed,
    list: async () => reminders.filter((reminder) => !completed.includes(reminder.id)),
    complete: async (id) => {
      store.events.push(`complete ${id}`);
      if (failures[id]) throw new RemindersError(failures[id], 'nope');
      completed.push(id);
    },
  };
}
const reminder = (id: string, title: string, extra: Partial<Reminder> = {}): Reminder => ({ id, title, notes: '', modified: OLD, ...extra });
const empty = (): CaptureLedger => ({ imported: [], pending: [], waiting: {} });

describe('mapping a reminder to a task', () => {
  it('keeps the user\'s words and takes the date from the reminder', () => {
    expect(taskFromReminder(reminder('A', 'Call Rasmus about Harborlight fri', { due: '2026-10-09', created: '2026-10-05T07:00:00Z', notes: 'Pricing first' }), NOW)).toMatchObject({
      title: 'Call Rasmus about Harborlight fri',
      notes: 'Pricing first\n\nIt stays in Apple Reminders until the end of its day so the notification can fire.\n\nCaptured in Apple Reminders on 5 Oct 2026.',
      label: null,
      dueAt: '2026-10-09',
      sourceKey: 'reminders:A',
    });
    expect(taskFromReminder(reminder('B', 'Board deck #board'))).toMatchObject({ title: 'Board deck', label: 'board' });
  });

  it('files link captures under #read, but only when the title itself is the link', () => {
    const capture = taskFromReminder(reminder('C', 'Linkedin strategy https://x.com/example/status/2085697473243226240?s=46.'));
    expect(capture.label).toBe('read');
    expect(capture.links).toEqual(['https://x.com/example/status/2085697473243226240?s=46']);
    expect(taskFromReminder(reminder('D', 'Pay the invoice', { notes: 'https://example.com/invoice/60649' })).label).toBeNull();
    expect(taskFromReminder(reminder('E', 'Read (https://example.com/a)')).links).toEqual(['https://example.com/a']);
  });

  it('keeps the whole of a long capture', () => {
    const long = `Mina Sandberg Larsson for leadership. ${'Inte tillräckligt tydligt vad vi menar. '.repeat(8)}`.trim();
    const capture = taskFromReminder(reminder('F', long));
    expect(capture.title.length).toBe(240);
    expect(capture.title.endsWith('…')).toBe(true);
    expect(capture.notes).toContain(`Full capture: ${long}`);
  });

  it('says when a reminder stays on the phone for its alert', () => {
    expect(taskFromReminder(reminder('G', 'Call Bea', { due: '2026-10-05', dueTime: '16:00', hasAlarms: true }), NOW).notes).toContain('Reminder set for 16:00');
    expect(taskFromReminder(reminder('H', 'Buy milk', { locationAlarm: true, hasAlarms: true }), NOW).notes).toContain('location alert');
    // An alert already in the past: the reminder is ticked off on import, so the note says nothing about staying.
    expect(taskFromReminder(reminder('J', 'Tweet', { due: '2026-08-31' }), NOW).notes).toBe('Captured in Apple Reminders.');
  });
});

describe('syncing a Reminders list', () => {
  it('writes the task before ticking off the reminder, once, and keeps links off the undo stack', async () => {
    const store = fakeStore();
    const source = fakeSource([reminder('A', 'Follow up on the search'), reminder('C', 'Tomorrow https://open.spotify.com/episode/5hR6', { notes: 'also https://example.com/b' })], store);
    const ledger = empty();
    let saves = 0;
    expect(await syncReminders(store, source, 'Reminders', ledger, { now: NOW, save: () => { saves++; } })).toMatchObject({ imported: 2, completed: 2, failed: 0 });
    expect(store.events).toEqual(['create reminders:A', 'complete A', 'create reminders:C', 'complete C']);
    expect(store.tasks.map((task) => task.status)).toEqual(['ready', 'ready']);
    expect(store.links).toEqual([['t2', 'https://open.spotify.com/episode/5hR6', false]]);
    expect(saves).toBeGreaterThanOrEqual(4);
    expect(await syncReminders(store, source, 'Reminders', ledger, { now: NOW })).toMatchObject({ imported: 0, completed: 0 });
    expect(ledger.pending).toEqual([]);
  });

  it('waits for a reminder to settle before taking it', async () => {
    const store = fakeStore();
    const fresh = reminder('S', 'Call Rasmus', { modified: new Date(NOW.getTime() - 30_000).toISOString() });
    const source = fakeSource([fresh], store);
    const ledger = empty();
    expect(await syncReminders(store, source, 'Reminders', ledger, { now: NOW })).toMatchObject({ imported: 0, settling: 1 });
    expect(store.events).toEqual([]);
    expect(await syncReminders(store, source, 'Reminders', ledger, { now: new Date(NOW.getTime() + SETTLE_MS) })).toMatchObject({ imported: 1, completed: 1 });
  });

  it('keeps reminders with an alert on the phone, and ticks timed ones off after the time', async () => {
    const store = fakeStore();
    const timed = reminder('T', 'Call Bea', { due: '2026-10-05', dueTime: '16:00', hasAlarms: true });
    const place = reminder('P', 'Buy milk', { hasAlarms: true, locationAlarm: true });
    const source = fakeSource([timed, place], store);
    const ledger = empty();
    expect(await syncReminders(store, source, 'Reminders', ledger, { now: NOW })).toMatchObject({ imported: 2, keptForAlert: 2, completed: 0 });
    expect(Object.keys(ledger.waiting)).toEqual(['T']);
    expect(await syncReminders(store, source, 'Reminders', ledger, { now: new Date('2026-10-05T13:59:00') })).toMatchObject({ completed: 0 });
    expect(await syncReminders(store, source, 'Reminders', ledger, { now: new Date('2026-10-05T16:06:00') })).toMatchObject({ completed: 1 });
    expect(source.completed).toEqual(['T']);
    expect(ledger.waiting).toEqual({});
    expect(store.tasks).toHaveLength(2);
  });

  it('follows a snoozed or moved alert instead of the time it had at import', async () => {
    const store = fakeStore();
    const list = [reminder('T', 'Call Bea', { due: '2026-10-05', dueTime: '16:00', hasAlarms: true })];
    const source = fakeSource(list, store);
    const ledger = empty();
    await syncReminders(store, source, 'Reminders', ledger, { now: NOW });
    list[0] = { ...list[0], due: '2026-10-06', dueTime: '09:00' };
    expect(await syncReminders(store, source, 'Reminders', ledger, { now: new Date('2026-10-05T16:06:00') })).toMatchObject({ completed: 0 });
    expect(ledger.waiting.T).toBe(new Date('2026-10-06T09:05:00').toISOString());
    expect(await syncReminders(store, source, 'Reminders', ledger, { now: new Date('2026-10-06T09:06:00') })).toMatchObject({ completed: 1 });
  });

  it('keeps a reminder for good once its time is swapped for a location alert', async () => {
    const store = fakeStore();
    const list = [reminder('T', 'Buy flowers', { due: '2026-10-05', dueTime: '16:00', hasAlarms: true })];
    const source = fakeSource(list, store);
    const ledger = empty();
    await syncReminders(store, source, 'Reminders', ledger, { now: NOW });
    list[0] = { ...list[0], dueTime: undefined, locationAlarm: true };
    expect(await syncReminders(store, source, 'Reminders', ledger, { now: new Date('2026-10-06T10:00:00') })).toMatchObject({ completed: 0 });
    expect(ledger.waiting).toEqual({});
  });

  it('lets a date-only reminder notify on its day before ticking it off', async () => {
    const store = fakeStore();
    const source = fakeSource([reminder('D', 'Tennis court', { due: '2026-10-05' })], store);
    const ledger = empty();
    expect(await syncReminders(store, source, 'Reminders', ledger, { now: NOW })).toMatchObject({ imported: 1, completed: 0, keptForAlert: 1 });
    expect(await syncReminders(store, source, 'Reminders', ledger, { now: new Date('2026-10-06T00:10:00') })).toMatchObject({ completed: 1 });
    // A backlog item whose day is long gone is ticked off on import.
    const old = fakeSource([reminder('O', 'Old capture', { due: '2026-06-12' })], store);
    expect(await syncReminders(store, old, 'Reminders', empty(), { now: NOW })).toMatchObject({ imported: 1, completed: 1 });
  });

  it('forgets pending and waiting entries for reminders the user ticked off on the phone', async () => {
    const store = fakeStore();
    const ledger: CaptureLedger = { imported: ['A', 'B'], pending: ['A'], waiting: { B: '2026-10-05T14:05:00.000Z' } };
    expect(await syncReminders(store, fakeSource([], store), 'Reminders', ledger, { now: NOW })).toMatchObject({ completed: 0 });
    expect(ledger).toEqual({ imported: ['A', 'B'], pending: [], waiting: {} });
    // A pass cut short keeps them, since it didn't see the whole list.
    const kept: CaptureLedger = { imported: ['A'], pending: ['A'], waiting: {} };
    await syncReminders(store, fakeSource([reminder('X', 'x')], store), 'Reminders', kept, { now: NOW, keepGoing: () => false });
    expect(kept.pending).toEqual(['A']);
  });

  it('retries a failed tick-off without creating a second task', async () => {
    const store = fakeStore();
    const failures: Record<string, string> = { A: 'saveFailed' };
    const source = fakeSource([reminder('A', 'Klews follow up')], store, failures);
    const ledger = empty();
    expect(await syncReminders(store, source, 'Reminders', ledger, { now: NOW })).toMatchObject({ imported: 1, completed: 0, failed: 1 });
    expect(ledger.pending).toEqual(['A']);
    delete failures.A;
    expect(await syncReminders(store, source, 'Reminders', ledger, { now: NOW })).toMatchObject({ imported: 0, completed: 1, failed: 0 });
    expect(store.tasks).toHaveLength(1);
    expect(ledger.pending).toEqual([]);
  });

  it('never re-imports a reminder whose task was deleted, and leaves reopened and repeating ones alone', async () => {
    const store = fakeStore();
    const ledger: CaptureLedger = { imported: ['R', 'ext:X1'], pending: [], waiting: {} };
    const source = fakeSource([reminder('W', 'Water the plants', { recurring: true }), reminder('R', 'Capio vd känner pappa'), reminder('NEWID', 'Same reminder after a resync', { externalId: 'X1' })], store);
    expect(await syncReminders(store, source, 'Reminders', ledger, { now: NOW })).toMatchObject({ imported: 0, completed: 0, skipped: 3 });
    expect(store.events).toEqual([]);
  });

  it('stops when told to, and forgets a reminder that no longer exists', async () => {
    const store = fakeStore();
    const source = fakeSource([reminder('G', 'Gone soon'), reminder('H', 'Not reached')], store, { G: 'notFound' });
    const ledger = empty();
    let calls = 0;
    expect(await syncReminders(store, source, 'Reminders', ledger, { now: NOW, keepGoing: () => ++calls <= 1 })).toMatchObject({ imported: 1, failed: 0 });
    expect(ledger.pending).toEqual([]);
    expect(store.tasks).toHaveLength(1);
  });

  it('reads an old or damaged ledger safely', () => {
    expect(parseLedger(null, '["A","B"]')).toEqual({ imported: [], pending: ['A', 'B'], waiting: {} });
    expect(parseLedger('{not json', null)).toEqual(empty());
    expect(parseLedger('{"imported":["x",3],"pending":["y"],"waiting":{"z":"2026-10-05T16:05:00.000Z","bad":4}}')).toEqual({ imported: ['x'], pending: ['y'], waiting: { z: '2026-10-05T16:05:00.000Z' } });
  });
});

// The compiled helper, without touching any reminders: argument errors come back as JSON.
const helper = join(__dirname, '..', 'build', 'aegir-reminders');
describe.skipIf(!existsSync(helper))('Reminders helper binary', () => {
  it('answers in JSON even on bad input', () => {
    const run = (...args: string[]) => {
      try { return JSON.parse(execFileSync(helper, args, { encoding: 'utf8' })); }
      catch (error) { return JSON.parse(String((error as { stdout: string }).stdout)); }
    };
    expect(run()).toMatchObject({ ok: false, code: 'usage' });
    expect(run('list')).toMatchObject({ ok: false, code: 'usage' });
    expect(run('complete', 'a', 'b')).toMatchObject({ ok: false, code: 'usage' });
    expect(run('status')).toMatchObject({ ok: true });
  });
});
