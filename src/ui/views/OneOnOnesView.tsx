import { useRef, useState } from 'react';
import { CalendarDays, Check, Copy, ExternalLink, Eye, EyeOff, RefreshCw, Settings2, Sparkles, Users } from 'lucide-react';
import type { OneOnOneMeeting, OneOnOneState } from '../../../shared/one-on-ones';
import { prepStatus } from '../../../shared/one-on-ones';
import { Button, Badge } from '../design-system/primitives';
import { ChatMarkdown } from '../design-system/ChatMarkdown';
import { api, day, time, type Run } from './common';

// Keep unsaved text across meeting switches and app restarts. Clear only after
// the backend confirms the exact draft was saved.
function AgendaEditor({ meeting, disabled }: { meeting: OneOnOneMeeting; disabled?: boolean }) {
  const key = `aegir:one-on-one:${meeting.id}:agenda`;
  const [text, setText] = useState(() => localStorage.getItem(key) ?? meeting.agenda);
  const base = useRef(meeting.agenda);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = text !== meeting.agenda;
  const save = async () => {
    setSaving(true); setError('');
    try { await api.updateOneOnOne(meeting.id, { agenda: text }, base.current); base.current = text; localStorage.removeItem(key); }
    catch (cause) { setError(String(cause).replace(/^Error: /, '')); }
    finally { setSaving(false); }
  };
  return <div className="one-on-one-editor">
    <label htmlFor={`${meeting.id}-agenda`}>Edit agenda</label>
    <textarea id={`${meeting.id}-agenda`} value={text} disabled={saving || disabled} placeholder="Write your agenda…" onChange={event => { setText(event.target.value); localStorage.setItem(key, event.target.value); }} />
    <div className="one-on-one-actions"><span role="status">{saving ? 'Saving…' : dirty ? 'Unsaved draft · kept on this device' : 'Saved'}</span><Button variant="outline" size="sm" disabled={saving || disabled || !dirty} onClick={() => void save()}>Save agenda</Button></div>
    {error && <p role="alert" className="one-on-one-error">{error}</p>}
  </div>;
}

function CalendarSettings({ state, run, onSaved }: { state: OneOnOneState; run: Run; onSaved: () => void }) {
  const [account, setAccount] = useState(state.account);
  const [enabled, setEnabled] = useState(state.enabled || !state.account);
  const [saving, setSaving] = useState(false);
  return <form className="one-on-one-settings" onSubmit={event => { event.preventDefault(); setSaving(true); void run(async () => { await api.configureOneOnOnes(account, enabled); onSaved(); }).finally(() => setSaving(false)); }}>
    <label>Calendar account<input aria-label="Calendar account" value={account} onChange={event => setAccount(event.target.value)} placeholder="Composio Google Calendar account alias" required /></label>
    <p>Use your connected Google Calendar account in Composio. Aegir reads the primary calendar; it doesn’t change your events.</p>
    <label className="one-on-one-check"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />Automatically prepare upcoming 1:1s</label>
    <p>Check the next 7 days every 30 minutes while Aegir is open. Prepare agendas within 36 hours of the meeting.</p>
    <Button size="sm" type="submit" disabled={saving || state.syncing || state.meetings.some(meeting => meeting.status === 'preparing') || !account.trim()}>{saving ? 'Saving…' : 'Save calendar settings'}</Button>
  </form>;
}

export function OneOnOnesView({ state, run }: { state: OneOnOneState; run: Run }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [settings, setSettings] = useState(!state.account);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const meetings = state.meetings.filter(meeting => showHidden ? meeting.hidden : !meeting.hidden);
  const selected = meetings.find(meeting => meeting.id === selectedId) || meetings[0];
  const preparing = state.meetings.some(meeting => meeting.status === 'preparing');
  const select = (id: string) => { setSelectedId(id); setEditing(false); setCopied(false); };
  const byDay = new Map<string, OneOnOneMeeting[]>();
  for (const meeting of meetings) byDay.set(day(meeting.startsAt), [...(byDay.get(day(meeting.startsAt)) || []), meeting]);
  return <div className="one-on-ones">
    <section className="one-on-one-list" aria-label="Upcoming 1:1s">
      <header className="one-on-one-list-head">
        <div className="one-on-one-title"><Users size={19} /><h1>1:1 prep</h1><Button variant="ghost" size="sm" aria-label="Calendar settings" aria-expanded={settings} onClick={() => setSettings(!settings)}><Settings2 size={15} /></Button></div>
        <p>Make space for a better conversation.</p>
        <div className="one-on-one-actions"><span>{state.enabled ? 'Automatic prep on' : 'Automatic prep paused'}</span><Button variant="outline" size="sm" disabled={!state.account || state.syncing} onClick={() => void run(() => api.syncOneOnOnes())}><RefreshCw size={13} />{state.syncing ? 'Refreshing…' : 'Refresh'}</Button></div>
        {state.lastSyncedAt && <small>Calendar checked {day(state.lastSyncedAt)} · {time(state.lastSyncedAt)}</small>}
        {settings && <CalendarSettings key={state.account + state.enabled} state={state} run={run} onSaved={() => setSettings(false)} />}
        {state.error && <p role="alert" className="one-on-one-error">{state.error}</p>}
        <button className="one-on-one-hidden" aria-pressed={showHidden} onClick={() => { setShowHidden(!showHidden); setSelectedId(null); }}> {showHidden ? 'Show upcoming' : `Hidden meetings${state.meetings.some(meeting => meeting.hidden) ? ` · ${state.meetings.filter(meeting => meeting.hidden).length}` : ''}`}</button>
      </header>
      <div className="one-on-one-items" data-keyboard-pane="list" tabIndex={-1}>
        {[...byDay].map(([date, items]) => <div key={date}><h2>{date}</h2>{items.map(meeting => <button key={meeting.id} data-keyboard-item data-keyboard-current={selected?.id === meeting.id ? '' : undefined} className={`one-on-one-row ${selected?.id === meeting.id ? 'selected' : ''}`} onClick={() => select(meeting.id)}>
          <span className="one-on-one-person" aria-hidden="true">{meeting.personName.slice(0, 1).toUpperCase()}</span>
          <span><strong>{meeting.personName}</strong><small>{time(meeting.startsAt)} · {Math.round((Date.parse(meeting.endsAt) - Date.parse(meeting.startsAt)) / 60000)} min</small><small>{prepStatus[meeting.status]}</small></span>
          {meeting.status === 'ready' && <Check size={14} aria-label="Agenda ready" />}
        </button>)}</div>)}
        {!meetings.length && <div className="one-on-one-list-empty"><CalendarDays size={22} /><p>{showHidden ? 'No hidden meetings.' : state.syncing ? 'Looking for your upcoming 1:1s…' : state.account ? 'No 1:1s found in the next seven days.' : 'Connect your calendar to find upcoming 1:1s.'}</p><small>Recognizes 1:1 titles and pairs of names with exactly two people.</small></div>}
      </div>
    </section>
    <main className="one-on-one-detail" data-keyboard-pane="detail" tabIndex={-1} aria-label="Meeting preparation">
      {selected ? <>
        <header className="one-on-one-meeting-head"><div className="one-on-one-eyebrow">YOUR NEXT CONVERSATION</div><h2>{selected.personName}</h2><p>{day(selected.startsAt)} · {time(selected.startsAt)}–{time(selected.endsAt)} <span>· {Intl.DateTimeFormat().resolvedOptions().timeZone}</span></p><p className="one-on-one-email">{selected.personEmail}</p>
          <div className="one-on-one-actions"><Badge>{prepStatus[selected.status]}</Badge><div className="one-on-one-buttons">
            {selected.sourceUrl && <Button variant="ghost" size="sm" onClick={() => void run(() => api.openExternal(selected.sourceUrl))}><ExternalLink size={13} />Calendar</Button>}
            <Button variant="ghost" size="sm" onClick={() => void run(() => api.updateOneOnOne(selected.id, { hidden: !selected.hidden }))}>{selected.hidden ? <Eye size={13} /> : <EyeOff size={13} />}{selected.hidden ? 'Restore' : 'Hide'}</Button>
            {!selected.hidden && <Button size="sm" disabled={preparing} onClick={() => { setEditing(false); void run(() => api.prepareOneOnOne(selected.id)); }}><Sparkles size={13} />{selected.status === 'preparing' ? 'Preparing…' : selected.agenda ? 'Refresh agenda' : 'Prepare now'}</Button>}
          </div></div>
        </header>
        <div className="one-on-one-content">
          {selected.error && <p role="alert" className="one-on-one-error">{selected.error}</p>}
          {selected.status === 'stale' && <p className="one-on-one-callout">The meeting changed. {selected.agendaEdited ? 'Your edited agenda is kept until you choose Refresh agenda.' : 'Refresh the agenda to include the latest context.'}</p>}
          <section aria-label="Agenda" className="one-on-one-agenda"><div className="one-on-one-actions"><h3>Recap & suggested agenda</h3>{selected.agenda && <div className="one-on-one-buttons"><Button variant="ghost" size="sm" disabled={selected.status === 'preparing'} onClick={() => setEditing(!editing)}>{editing ? 'Read agenda' : 'Edit agenda'}</Button><Button variant="ghost" size="sm" onClick={() => void run(async () => { await navigator.clipboard.writeText(selected.agenda); setCopied(true); })}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy'}</Button></div>}</div>
            {editing ? <AgendaEditor key={`${selected.id}-agenda`} meeting={selected} disabled={selected.status === 'preparing'} /> : selected.agenda ? <ChatMarkdown content={selected.agenda} onOpenLink={url => void run(() => api.openExternal(url))} /> : <div className="one-on-one-agenda-empty"><Sparkles size={24} /><h3>{selected.status === 'preparing' ? 'Preparing your conversation' : 'An agenda, ready when you need it'}</h3><p>{selected.status === 'preparing' ? 'Reviewing your previous conversations in Notion and Slack. You can keep working while this runs.' : 'A recap of your previous conversations and suggested topics, based on your Notion notes and relevant Slack exchanges.'}</p><small>{state.enabled ? 'Prepared automatically within 36 hours of the meeting, or use Prepare now.' : 'Use Prepare now, or enable automatic preparation in calendar settings.'}</small></div>}
            {selected.preparedAt && <small className="one-on-one-prepared">Prepared {day(selected.preparedAt)} · {time(selected.preparedAt)} · Review before your meeting</small>}
          </section>
          {selected.previousAgenda && <details className="one-on-one-previous"><summary>Previous agenda</summary><ChatMarkdown content={selected.previousAgenda} onOpenLink={url => void run(() => api.openExternal(url))} /></details>}
        </div>
      </> : <div className="one-on-one-welcome"><div><Users size={30} /><h2>Show up with context</h2><p>Catch up on what you discussed in Notion and Slack, then review suggested topics for your next 1:1.</p><small>Choose a meeting to review its recap and suggested agenda.</small></div></div>}
    </main>
  </div>;
}
