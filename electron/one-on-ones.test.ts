import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from './db.js';
import { OneOnOnes } from './one-on-ones.js';
import { calendarMeeting, parseCalendarPage, type CalendarEvent } from './one-on-one-calendar.js';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));
const event = (id = 'instance-1'): CalendarEvent => ({ id, summary: 'Alex / Sam', status: 'confirmed',
  start: { dateTime: new Date(Date.now() + 3600000).toISOString() }, end: { dateTime: new Date(Date.now() + 5400000).toISOString() },
  attendees: [{ self: true, email: 'alex@example.com', responseStatus: 'accepted' }, { email: 'sam@example.com', displayName: 'Sam Lee', responseStatus: 'accepted' }], htmlLink: 'https://www.google.com/calendar/event?eid=sample' });
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); });
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'aegir-one-on-ones-'));
  const store = new Store(join(root, 'store.sqlite'));
  const page = vi.fn(async (_account: string, _from: string, _until: string, _token?: string) => ({ items: [event()] }));
  const prepare = vi.fn(async () => '# Focus\nDiscuss launch.');
  const service = new OneOnOnes(store, prepare, () => {}, page);
  service.configure('calendar-account', true);
  cleanup.push(() => { service.stop(); store.close(); rmSync(root, { recursive: true, force: true }); });
  return { store, page, prepare, service };
}
describe('calendar 1:1 detection', () => {
  it('recognizes named pairs and explicit 1:1s, ignoring rooms', () => {
    expect(calendarMeeting(event(), 'work')).toMatchObject({ personName: 'Sam Lee', personEmail: 'sam@example.com', userEmail: 'alex@example.com' });
    expect(calendarMeeting({ ...event(), summary: 'Weekly 1-1', attendees: [...event().attendees!, { email: 'room@example.com', resource: true }] }, 'work')).not.toBeNull();
    expect(calendarMeeting(event(), 'other')?.id).not.toBe(calendarMeeting(event(), 'work')?.id);
    expect(calendarMeeting(event('instance-2'), 'work')?.id).not.toBe(calendarMeeting(event(), 'work')?.id);
  });
  it('excludes groups, declined invites, all-day events, cancellations and ambiguous titles', () => {
    const source = event();
    for (const changed of [
      { status: 'cancelled' }, { attendeesOmitted: true }, { summary: 'Sales demo' }, { start: {} },
      { attendees: [...source.attendees!, { email: 'third@example.com', responseStatus: 'declined' }] },
      { attendees: source.attendees!.map(person => ({ ...person, responseStatus: 'declined' })) },
      { attendees: source.attendees!.map(person => ({ ...person, self: false })) },
    ]) expect(calendarMeeting({ ...source, ...changed }, 'work')).toBeNull();
  });
  it('rejects failed or incomplete provider responses', () => {
    expect(() => parseCalendarPage('{"error":"expired"}')).toThrow('incomplete');
    expect(() => parseCalendarPage('{"items":[],"nextPageToken":123}')).toThrow('incomplete');
    expect(parseCalendarPage('{"items":[]}')).toEqual({ items: [] });
  });
});
describe('meeting preparation lifecycle', () => {
  it('imports idempotently, preserves notes and drafts, and marks changed events stale', async () => {
    const { service, page, store } = setup(); const source = event(); page.mockResolvedValue({ items: [source] });
    await service.sync(); const id = service.snapshot().meetings[0].id;
    store.db.prepare('UPDATE one_on_one_meetings SET data=? WHERE id=?').run(JSON.stringify({ ...service.snapshot().meetings[0], notes: 'Discuss feedback' }), id); await service.prepare(id);
    await service.sync();
    expect(service.snapshot().meetings).toHaveLength(1);
    expect(service.snapshot().meetings[0]).toMatchObject({ notes: 'Discuss feedback', agenda: '# Focus\nDiscuss launch.', status: 'ready' });
    page.mockResolvedValue({ items: [{ ...source, description: 'New topic' }] }); await service.sync();
    expect(service.snapshot().meetings[0]).toMatchObject({ status: 'stale', notes: 'Discuss feedback', agenda: '# Focus\nDiscuss launch.' });
    const reopened = new OneOnOnes(store, async () => '', () => {}, page);
    expect(reopened.snapshot().meetings[0].notes).toBe('Discuss feedback'); reopened.stop();
  });
  it('does not drop meetings on a failed or partially paginated refresh', async () => {
    const { service, page } = setup(); await service.sync();
    page.mockResolvedValueOnce({ items: [event('another')], nextPageToken: 'next' } as any).mockRejectedValueOnce(new Error('Access expired'));
    await expect(service.sync()).rejects.toThrow('Access expired');
    expect(service.snapshot().meetings.map(meeting => meeting.eventId)).toEqual(['instance-1']);
    expect(service.snapshot().error).toBe('Access expired');
  });
  it('follows pages, removes cancelled/missing events and restores hidden meetings', async () => {
    const { service, page } = setup();
    page.mockResolvedValueOnce({ items: [event()], nextPageToken: 'next' } as any).mockResolvedValueOnce({ items: [event('second')] });
    await service.sync(); expect(page.mock.calls[1][3]).toBe('next'); expect(service.snapshot().meetings).toHaveLength(2);
    const id = service.snapshot().meetings[0].id; service.update(id, { hidden: true });
    await expect(service.prepare(id)).rejects.toThrow('no longer upcoming');
    service.update(id, { hidden: false }); expect(service.snapshot().meetings.find(meeting => meeting.id === id)?.hidden).toBe(false);
    page.mockResolvedValue({ items: [] }); await service.sync(); expect(service.snapshot().meetings).toHaveLength(0);
  });
  it('prepares automatically only in the time window, without repeated runs', async () => {
    const { service, page, prepare } = setup(); const near = event(), far = event('far');
    far.start!.dateTime = new Date(Date.now() + 3 * 86400000).toISOString(); far.end!.dateTime = new Date(Date.now() + 3 * 86400000 + 1800000).toISOString();
    page.mockResolvedValue({ items: [near, far] });
    await service.tick(); await service.tick();
    expect(prepare).toHaveBeenCalledOnce(); expect(page).toHaveBeenCalledOnce();
    expect(service.snapshot().meetings.find(meeting => meeting.eventId === 'far')?.status).toBe('pending');
  });
  it('preserves existing agenda on failure and prevents stale editor writes', async () => {
    const { service, prepare } = setup(); await service.sync(); const id = service.snapshot().meetings[0].id;
    await service.prepare(id); const agenda = service.snapshot().meetings[0].agenda;
    service.update(id, { agenda: 'My edited agenda' }, agenda);
    expect(() => service.update(id, { agenda: 'Old edit' }, agenda)).toThrow('changed');
    prepare.mockRejectedValue(new Error('Source unavailable')); await expect(service.prepare(id)).rejects.toThrow('Source unavailable');
    expect(service.snapshot().meetings[0]).toMatchObject({ agenda: 'My edited agenda', status: 'failed', error: 'Source unavailable' });
  });
  it('keeps user-edited agendas during automatic updates and retains the prior version on explicit refresh', async () => {
    const { service, page, prepare } = setup(); const source = event(); page.mockResolvedValue({ items: [source] });
    await service.sync(); const id = service.snapshot().meetings[0].id; await service.prepare(id);
    service.update(id, { agenda: 'My edited agenda' }, service.snapshot().meetings[0].agenda);
    page.mockResolvedValue({ items: [{ ...source, description: 'A new topic' }] }); await service.sync(); await service.tick();
    expect(prepare).toHaveBeenCalledOnce(); expect(service.snapshot().meetings[0]).toMatchObject({ agenda: 'My edited agenda', agendaEdited: true, status: 'stale' });
    await service.prepare(id);
    expect(service.snapshot().meetings[0]).toMatchObject({ previousAgenda: 'My edited agenda', agendaEdited: false, status: 'ready' });
  });
  it('rejects late generation after the meeting changes or shutdown', async () => {
    const { service, prepare, store, page } = setup(); await service.sync(); const id = service.snapshot().meetings[0].id;
    let finish!: (text: string) => void; prepare.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const run = service.prepare(id); page.mockResolvedValue({ items: [{ ...event(), description: 'Changed meeting' }] }); await service.sync(); finish('Outdated draft');
    await expect(run).rejects.toThrow('changed during preparation'); expect(service.snapshot().meetings[0].agenda).toBe('');
    const late = service.prepare(id); service.stop(); finish('Late result'); await late;
    const reopened = new OneOnOnes(store, async () => '', () => {});
    expect(reopened.snapshot().meetings[0]).toMatchObject({ status: 'failed', agenda: '' }); reopened.stop();
  });
});
