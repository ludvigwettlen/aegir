import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { OneOnOneMeeting } from '../shared/one-on-ones.js';

type Attendee = { email?: string; displayName?: string; self?: boolean; resource?: boolean; responseStatus?: string };
export type CalendarEvent = {
  id?: string; summary?: string; description?: string; status?: string; htmlLink?: string;
  attendees?: Attendee[]; attendeesOmitted?: boolean; organizer?: Attendee;
  start?: { dateTime?: string }; end?: { dateTime?: string };
};
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function calendarMeeting(event: CalendarEvent, account: string): OneOnOneMeeting | null {
  if (!event.id || event.status === 'cancelled' || event.attendeesOmitted) return null;
  const startsAt = event.start?.dateTime, endsAt = event.end?.dateTime;
  if (!startsAt || !endsAt || !Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt)) || Date.parse(endsAt) <= Date.parse(startsAt)) return null;
  // Count every human invitee, including declined guests: a group meeting does not
  // become a 1:1 merely because other attendees declined.
  const humans = (event.attendees || []).filter(person => !person.resource && !person.email?.endsWith('@resource.calendar.google.com'));
  if (humans.length !== 2 || humans.some(person => person.responseStatus === 'declined')) return null;
  const self = humans.find(person => person.self);
  const peer = humans.find(person => !person.self);
  if (!self?.email || !peer?.email) return null;
  const title = event.summary?.trim() || '';
  const namedOneOnOne = /\b(?:1\s*[:\-–/]\s*1|1\s*(?:on|to)\s*1|one[ -]on[ -]one)\b/i.test(title);
  const pair = title.split(/\s*(?:\/|<>|↔)\s*/);
  const namedPair = pair.length === 2 && pair.every(part => /^[\p{L}][\p{L}\p{M} .'-]{0,45}$/u.test(part));
  if (!namedOneOnOne && !namedPair) return null;
  const base = {
    id: digest([account, event.id]), account, eventId: event.id, title,
    personName: peer.displayName || peer.email.split('@')[0].replace(/[._]/g, ' '),
    personEmail: peer.email.toLowerCase(), userEmail: self.email.toLowerCase(),
    startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(),
    sourceUrl: /^https:\/\/(?:www\.)?google\.com\/calendar\//.test(event.htmlLink || '') ? event.htmlLink! : '',
    description: (event.description || '').slice(0, 20000),
  };
  return { ...base, revision: digest(base), active: true, hidden: false, agenda: '', preparedAt: null, status: 'pending', error: '' };
}

export type CalendarPage = { items: CalendarEvent[]; nextPageToken?: string };
export function parseCalendarPage(text: string): CalendarPage {
  let value;
  try { value = JSON.parse(text); }
  catch { throw new Error('Calendar returned an unreadable response. Existing meetings were kept. Try refreshing again.'); }
  if (!value || !Array.isArray(value.items) || (value.nextPageToken !== undefined && typeof value.nextPageToken !== 'string'))
    throw new Error('Calendar returned an incomplete response. Existing meetings were kept.');
  return value;
}
export async function readCalendarPage(account: string, from: string, until: string, pageToken?: string): Promise<CalendarPage> {
  const local = join(homedir(), '.local', 'bin', 'composio');
  if (!existsSync(local)) throw new Error('Calendar access needs the Composio CLI at ~/.local/bin/composio and a connected Google Calendar account.');
  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  for (const [key, value] of Object.entries({ timeMin: from, timeMax: until, singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
    fields: 'items(id,summary,description,status,htmlLink,start,end,attendees,attendeesOmitted),nextPageToken', ...(pageToken ? { pageToken } : {}) })) url.searchParams.set(key, value);
  const stdout = await new Promise<string>((resolve, reject) => {
    // No shell, arbitrary endpoint, or write method is exposed to agents or UI.
    const child = execFile(local, ['proxy', url.href, '--toolkit', 'googlecalendar', '--account', account],
      { timeout: 60000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
        if (error) reject(new Error('Could not read Google Calendar. Check the calendar account and Composio connection, then retry.'));
        else resolve(stdout);
      });
    // The CLI checks piped stdin for a request body. Signal EOF immediately:
    // leaving Node's default pipe open can make it exit without a response.
    child.stdin?.end();
  });
  return parseCalendarPage(stdout);
}
