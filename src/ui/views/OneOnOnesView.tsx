import { useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Check, Copy, ExternalLink, Eye, EyeOff, RefreshCw, Settings2, Sparkles, Users } from 'lucide-react';
import type { OneOnOneMeeting, OneOnOneState } from '../../../shared/one-on-ones';
import { prepStatus } from '../../../shared/one-on-ones';
import { Button, Badge } from '../design-system/primitives';
import { ChatMarkdown } from '../design-system/ChatMarkdown';
import { ThreadView } from './ThreadView';
import type { Snapshot } from '../../../shared/types';
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
    <label className="one-on-one-check"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />Automatically prepare enabled meetings</label>
    <p>Check the next 21 days every 30 minutes while Aegir is open. Prepare enabled agendas within 36 hours of the meeting. New group meetings start with automatic prep off.</p>
    <Button size="sm" type="submit" disabled={saving || state.syncing || state.meetings.some(meeting => meeting.status === 'preparing') || !account.trim()}>{saving ? 'Saving…' : 'Save calendar settings'}</Button>
  </form>;
}

export function OneOnOnesView({ state, data, run }: { state: OneOnOneState; data: Snapshot; run: Run }) {
  const [conversation, setConversation] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [settings, setSettings] = useState(!state.account);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monday = new Date(today); monday.setDate(today.getDate() - (today.getDay() + 6) % 7 + weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, index) => { const date = new Date(monday); date.setDate(monday.getDate() + index); return date; });
  const sameDay = (value: string, date: Date) => new Date(value).toDateString() === date.toDateString();
  const meetings = state.meetings.filter(meeting => showHidden ? meeting.hidden : !meeting.hidden);
  const visible = meetings.filter(meeting => days.some(date => sameDay(meeting.startsAt, date)));
  const selected = visible.find(meeting => meeting.id === selectedId) || visible[0];
  const thread = data.threads.find(thread => thread.id === selected?.threadId);
  const openConversation = () => { if (!selected) return; setConversation(true); setOpeningChat(true); void run(async () => { await api.meetingConversation(selected.id); }).finally(() => setOpeningChat(false)); };
  const select = (id: string) => { setSelectedId(id); setEditing(false); setCopied(false); };
  return <div className={`one-on-ones ${conversation && selected ? 'meetings-chat-open' : ''}`}>
    <section className="one-on-one-list" aria-label="Meeting calendar">
      <header className="one-on-one-list-head">
        <div className="one-on-one-title"><CalendarDays size={19} /><h1>Meetings</h1><Button variant="ghost" size="sm" aria-label="Calendar settings" aria-expanded={settings} onClick={() => setSettings(!settings)}><Settings2 size={15} /></Button></div>
        <p>Your week, with context for every conversation.</p>
        <div className="one-on-one-actions"><span>{state.enabled ? 'Automatic prep on' : 'Automatic prep paused'}</span><Button variant="outline" size="sm" disabled={!state.account || state.syncing} onClick={() => void run(() => api.syncOneOnOnes())}><RefreshCw size={13} />{state.syncing ? 'Refreshing…' : 'Refresh'}</Button></div>
        {state.lastSyncedAt && <small>Calendar checked {day(state.lastSyncedAt)} · {time(state.lastSyncedAt)}</small>}
        {settings && <CalendarSettings key={state.account + state.enabled} state={state} run={run} onSaved={() => setSettings(false)} />}
        {state.error && <p role="alert" className="one-on-one-error">{state.error}</p>}
        <button className="one-on-one-hidden" aria-pressed={showHidden} onClick={() => { setShowHidden(!showHidden); setSelectedId(null); }}> {showHidden ? 'Show upcoming' : `Hidden meetings${state.meetings.some(meeting => meeting.hidden) ? ` · ${state.meetings.filter(meeting => meeting.hidden).length}` : ''}`}</button>
      </header>
      <div className="meetings-week-nav"><Button variant="ghost" size="sm" aria-label="Previous week" disabled={weekOffset === 0} onClick={() => { setWeekOffset(weekOffset - 1); setSelectedId(null); setEditing(false); }}><ChevronLeft size={16} /></Button><strong>{days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {days[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</strong><Button variant="ghost" size="sm" aria-label="Next week" disabled={weekOffset === 2} onClick={() => { setWeekOffset(weekOffset + 1); setSelectedId(null); setEditing(false); }}><ChevronRight size={16} /></Button><Button variant="outline" size="sm" onClick={() => { setWeekOffset(0); setSelectedId(null); setEditing(false); }}>Today</Button></div>
      <div className="meetings-week" data-keyboard-pane="list" tabIndex={-1} aria-label="Week calendar">
        {days.map(date => <section key={date.toISOString()} className={`meetings-day ${date.toDateString() === today.toDateString() ? 'is-today' : ''}`} aria-label={date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}>
          <h2>{date.toLocaleDateString(undefined, { weekday: 'short' })}<span>{date.getDate()}</span>{date.toDateString() === today.toDateString() && <small>Today</small>}</h2>
          {visible.filter(meeting => sameDay(meeting.startsAt, date)).map(meeting => <button key={meeting.id} aria-pressed={selected?.id === meeting.id} data-keyboard-item data-keyboard-current={selected?.id === meeting.id ? '' : undefined} className={`one-on-one-row meetings-event ${selected?.id === meeting.id ? 'selected' : ''}`} onClick={() => select(meeting.id)}>
            <span><small>{time(meeting.startsAt)}–{time(meeting.endsAt)}</small><strong>{meeting.title}</strong><small>{prepStatus[meeting.status]}</small></span>
          </button>)}
          {!visible.some(meeting => sameDay(meeting.startsAt, date)) && <p className="meetings-day-empty">No upcoming meetings</p>}
        </section>)}
      </div>
      {!visible.length && <p className="meetings-empty" role="status">{showHidden ? 'No hidden meetings this week.' : state.syncing ? 'Looking for upcoming meetings…' : state.account ? 'No upcoming meetings this week. Try another week or refresh your calendar.' : 'Connect your calendar to see upcoming meetings.'}</p>}

    </section>
    <main className="one-on-one-detail" data-keyboard-pane="detail" tabIndex={-1} aria-label="Meeting preparation">
      {selected ? <>
        <header className="one-on-one-meeting-head"><div className="one-on-one-eyebrow">MEETING PREPARATION</div><h2>{selected.title}</h2><p>{day(selected.startsAt)} · {time(selected.startsAt)}–{time(selected.endsAt)} <span>· {Intl.DateTimeFormat().resolvedOptions().timeZone}</span></p><p className="one-on-one-email">{selected.attendees?.map(person => `${person.name} (${person.email})`).join(', ') || selected.personEmail}</p>
          <div className="one-on-one-actions"><Badge>{prepStatus[selected.status]}</Badge><div className="one-on-one-buttons">
            {selected.sourceUrl && <Button variant="ghost" size="sm" onClick={() => void run(() => api.openExternal(selected.sourceUrl))}><ExternalLink size={13} />Calendar</Button>}
            <Button variant="ghost" size="sm" onClick={() => void run(() => api.updateOneOnOne(selected.id, { hidden: !selected.hidden }))}>{selected.hidden ? <Eye size={13} /> : <EyeOff size={13} />}{selected.hidden ? 'Restore' : 'Hide'}</Button>
            {!selected.hidden && <Button size="sm" disabled={selected.status === 'preparing' || !!thread?.busyAgentIds.length} onClick={() => { setEditing(false); setConversation(true); void run(() => api.prepareOneOnOne(selected.id)); }}><Sparkles size={13} />{selected.status === 'preparing' ? 'Preparing…' : selected.agenda ? 'Refresh agenda' : 'Prepare now'}</Button>}
          </div></div>
        </header>
        <div className="meetings-detail-tabs" role="group" aria-label="Meeting view"><Button size="sm" variant={conversation ? 'ghost' : 'outline'} aria-pressed={!conversation} onClick={() => setConversation(false)}>Agenda</Button><Button size="sm" variant={conversation ? 'outline' : 'ghost'} aria-pressed={conversation} disabled={openingChat} onClick={openConversation}>{openingChat ? 'Opening…' : selected.status === 'preparing' ? 'Conversation · Preparing…' : 'Conversation'}</Button></div>
        {conversation ? <section className="meetings-conversation" aria-label="Meeting conversation">{thread ? <ThreadView key={thread.id} data={data} thread={thread} run={run} compact header={<header className="ws-thread-head"><strong>Meeting conversation</strong></header>} /> : <p role="status">{selected.error || (selected.status === 'preparing' || openingChat ? 'Opening the preparation conversation…' : 'Open Conversation to discuss this meeting.')}</p>}</section> : <div className="one-on-one-content">
          <label className="meetings-auto"><input type="checkbox" checked={selected.autoPrepare ?? selected.kind !== 'meeting'} onChange={event => void run(() => api.updateOneOnOne(selected.id, { autoPrepare: event.target.checked }))} />Automatically prepare this meeting</label>
          {!state.enabled && <p className="meetings-auto-hint">Automatic preparation is paused in calendar settings. Prepare now is always available.</p>}
          {selected.description && <details className="meetings-description"><summary>Calendar description</summary><p>{selected.description}</p></details>}
          {selected.error && <p role="alert" className="one-on-one-error">{selected.error}</p>}
          {selected.status === 'stale' && <p className="one-on-one-callout">The meeting changed. {selected.agendaEdited ? 'Your edited agenda is kept until you choose Refresh agenda.' : 'Refresh the agenda to include the latest context.'}</p>}
          <section aria-label="Agenda" className="one-on-one-agenda"><div className="one-on-one-actions"><h3>Recap & suggested agenda</h3>{selected.agenda && <div className="one-on-one-buttons"><Button variant="ghost" size="sm" disabled={selected.status === 'preparing'} onClick={() => setEditing(!editing)}>{editing ? 'Read agenda' : 'Edit agenda'}</Button><Button variant="ghost" size="sm" onClick={() => void run(async () => { await navigator.clipboard.writeText(selected.agenda); setCopied(true); })}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy'}</Button></div>}</div>
            {editing ? <AgendaEditor key={`${selected.id}-agenda`} meeting={selected} disabled={selected.status === 'preparing'} /> : selected.agenda ? <ChatMarkdown content={selected.agenda} onOpenLink={url => void run(() => api.openExternal(url))} /> : <div className="one-on-one-agenda-empty"><Sparkles size={24} /><h3>{selected.status === 'preparing' ? 'Preparing your conversation' : 'An agenda, ready when you need it'}</h3><p>{selected.status === 'preparing' ? 'Reviewing relevant meeting notes and Slack conversations. You can keep working while this runs.' : 'Meeting context, open follow-ups and suggested topics, based on relevant Notion notes and Slack exchanges.'}</p><small>{state.enabled ? 'Prepared automatically within 36 hours of the meeting, or use Prepare now.' : 'Use Prepare now, or enable automatic preparation in calendar settings.'}</small></div>}
            {selected.preparedAt && <small className="one-on-one-prepared">Prepared {day(selected.preparedAt)} · {time(selected.preparedAt)} · Review before your meeting</small>}
          </section>
          {selected.previousAgenda && <details className="one-on-one-previous"><summary>Previous agenda</summary><ChatMarkdown content={selected.previousAgenda} onOpenLink={url => void run(() => api.openExternal(url))} /></details>}
        </div>}
      </> : <div className="one-on-one-welcome"><div><Users size={30} /><h2>Show up with context</h2><p>Choose a meeting in your calendar to review context, follow-ups and a prepared agenda.</p><small>Choose a meeting to review its recap and suggested agenda.</small></div></div>}
    </main>
  </div>;
}
