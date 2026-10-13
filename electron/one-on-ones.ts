import type { Store } from './db.js';
import type { OneOnOneMeeting, OneOnOneState } from '../shared/one-on-ones.js';
import { calendarMeeting, readCalendarPage } from './one-on-one-calendar.js';

type Prepare = (meeting: OneOnOneMeeting) => Promise<string>;
export class OneOnOnes {
  private syncing = false;
  private stopped = false;
  private lastAttempt = 0;
  private preparing = new Set<string>();
  constructor(private store: Store, private prepareAgenda: Prepare, private refresh: () => void, private readPage = readCalendarPage) {
    store.db.exec('CREATE TABLE IF NOT EXISTS one_on_one_meetings(id TEXT PRIMARY KEY, data TEXT NOT NULL)');
    for (const meeting of this.all()) if (meeting.status === 'preparing') this.save({ ...meeting, status: 'failed', error: 'Preparation was interrupted. Try again.' });
  }
  private all(): OneOnOneMeeting[] {
    return (this.store.db.prepare('SELECT data FROM one_on_one_meetings').all() as { data: string }[]).map(row => JSON.parse(row.data));
  }
  private save(meeting: OneOnOneMeeting) { this.store.db.prepare('INSERT OR REPLACE INTO one_on_one_meetings VALUES (?,?)').run(meeting.id, JSON.stringify(meeting)); }
  private get(id: string) {
    const row = this.store.db.prepare('SELECT data FROM one_on_one_meetings WHERE id=?').get(id) as { data: string } | undefined;
    if (!row) throw new Error('Meeting not found');
    return JSON.parse(row.data) as OneOnOneMeeting;
  }
  snapshot(): OneOnOneState {
    const account = this.store.getSetting('oneOnOneCalendarAccount') || '';
    return { account, enabled: this.store.getSetting('oneOnOneEnabled') === 'true', syncing: this.syncing,
      lastSyncedAt: this.store.getSetting('oneOnOneLastSync') || null, error: this.store.getSetting('oneOnOneSyncError') || '',
      meetings: this.all().filter(meeting => meeting.account === account && meeting.active && Date.parse(meeting.endsAt) > Date.now()).sort((a, b) => a.startsAt.localeCompare(b.startsAt)) };
  }
  configure(account: string, enabled: boolean) {
    if (typeof account !== 'string' || !/^[a-zA-Z0-9_@.+-]{1,200}$/.test(account.trim())) throw new Error('Enter your Composio Google Calendar account alias.');
    if (typeof enabled !== 'boolean') throw new Error('Invalid automatic preparation setting');
    if (this.syncing || this.preparing.size) throw new Error('Wait for the current calendar refresh or preparation to finish.');
    if (this.store.getSetting('oneOnOneCalendarAccount') !== account.trim()) this.store.deleteSetting('oneOnOneLastSync');
    this.store.setSetting('oneOnOneCalendarAccount', account.trim());
    this.store.setSetting('oneOnOneEnabled', String(enabled));
    this.store.deleteSetting('oneOnOneSyncError'); this.lastAttempt = 0; this.refresh();
  }
  async sync(now = new Date()) {
    if (this.stopped || !this.store.isOpen || this.syncing) return;
    const { account } = this.snapshot();
    if (!account) throw new Error('Choose a calendar account first.');
    this.syncing = true; this.lastAttempt = now.getTime(); this.refresh();
    const from = now.toISOString(), until = new Date(now.getTime() + 7 * 86400000).toISOString();
    try {
      const meetings: OneOnOneMeeting[] = []; const tokens = new Set<string>(); let token: string | undefined;
      for (let page = 0; ; page++) {
        if (page >= 40) throw new Error('Calendar pagination limit reached. Existing meetings were kept.');
        const result = await this.readPage(account, from, until, token);
        if (this.stopped || !this.store.isOpen) return;
        for (const event of result.items) {
          const meeting = calendarMeeting(event, account);
          if (meeting && meeting.endsAt > from && meeting.startsAt < until) meetings.push(meeting);
        }
        token = result.nextPageToken;
        if (!token) break;
        if (tokens.has(token)) throw new Error('Calendar returned a repeated page. Existing meetings were kept.');
        tokens.add(token);
      }
      // Apply only a complete calendar read: failures cannot erase saved meetings.
      this.store.db.transaction(() => {
        const old = new Map(this.all().filter(meeting => meeting.account === account).map(meeting => [meeting.id, meeting]));
        const incoming = new Set(meetings.map(meeting => meeting.id));
        for (const meeting of old.values()) if (!incoming.has(meeting.id)) this.save({ ...meeting, active: false });
        for (const meeting of meetings) {
          const previous = old.get(meeting.id);
          if (!previous) this.save(meeting);
          else this.save({ ...meeting, hidden: previous.hidden, agenda: previous.agenda, notes: previous.notes, preparedAt: previous.preparedAt, agendaEdited: previous.agendaEdited, previousAgenda: previous.previousAgenda,
            status: previous.revision === meeting.revision ? previous.status : previous.agenda ? 'stale' : 'pending',
            error: previous.revision === meeting.revision ? previous.error : '' });
        }
        this.store.setSetting('oneOnOneLastSync', now.toISOString()); this.store.deleteSetting('oneOnOneSyncError');
      })();
    } catch (error) {
      if (!this.stopped && this.store.isOpen) this.store.setSetting('oneOnOneSyncError', String(error).replace(/^Error: /, ''));
      throw error;
    } finally { this.syncing = false; if (!this.stopped && this.store.isOpen) this.refresh(); }
  }
  update(id: string, change: { agenda?: string; hidden?: boolean }, expected?: string) {
    const meeting = this.get(id);
    if (typeof change !== 'object' || !change || Object.keys(change).some(key => !['agenda', 'hidden'].includes(key))) throw new Error('Invalid meeting change');
    if (change.agenda !== undefined && (typeof change.agenda !== 'string' || change.agenda.length > 100000)) throw new Error('Meeting text is too long');
    if (change.hidden !== undefined && typeof change.hidden !== 'boolean') throw new Error('Invalid hidden state');
    if (change.agenda !== undefined && (this.preparing.has(id) || meeting.agenda !== expected)) throw new Error('The agenda changed. Reload before saving your edits.');
    this.save({ ...meeting, ...change, ...(change.agenda !== undefined ? { agendaEdited: true } : {}) }); this.refresh();
  }
  async prepare(id: string) {
    if (this.stopped || !this.store.isOpen || this.preparing.has(id)) return;
    if (this.preparing.size) throw new Error('Another agenda is being prepared. Try again when it finishes.');
    const meeting = this.get(id);
    if (!meeting.active || meeting.hidden || Date.parse(meeting.endsAt) <= Date.now()) throw new Error('This meeting is no longer upcoming.');
    this.preparing.add(id); this.save({ ...meeting, status: 'preparing', error: '' }); this.refresh();
    try {
      const agenda = await this.prepareAgenda(meeting);
      if (this.stopped || !this.store.isOpen) return;
      const current = this.get(id);
      if (!current.active || current.hidden || current.revision !== meeting.revision)
        throw new Error('The meeting changed during preparation. Prepare again with the latest context.');
      if (!agenda.trim()) throw new Error('No agenda was returned. Try again.');
      this.save({ ...current, agenda, previousAgenda: current.agenda || current.previousAgenda, agendaEdited: false, preparedAt: new Date().toISOString(), status: 'ready', error: '' });
    } catch (error) {
      if (!this.stopped && this.store.isOpen) this.save({ ...this.get(id), status: 'failed', error: String(error).replace(/^Error: /, '') });
      throw error;
    } finally { this.preparing.delete(id); if (!this.stopped && this.store.isOpen) this.refresh(); }
  }
  async tick() {
    if (this.stopped || !this.store.isOpen || !this.snapshot().enabled || this.syncing || this.preparing.size) return;
    if (Date.now() - this.lastAttempt >= 30 * 60000) {
      try { await this.sync(); } catch { return; }
    }
    if (this.stopped || !this.store.isOpen || this.snapshot().error) return;
    const next = this.snapshot().meetings.find(meeting => !meeting.hidden && !meeting.agendaEdited && ['pending', 'stale'].includes(meeting.status) && Date.parse(meeting.startsAt) < Date.now() + 36 * 3600000 && Date.parse(meeting.endsAt) > Date.now());
    if (next) await this.prepare(next.id).catch(() => {});
  }
  stop() { this.stopped = true; }
}
