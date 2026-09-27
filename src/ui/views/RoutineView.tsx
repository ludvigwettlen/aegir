import { useEffect, useState } from 'react';
import { Check, Copy, MessageSquare, Pause, Play, Repeat2, X } from 'lucide-react';
import type { AppEvent, Routine, RunEvent, Snapshot } from '../../../shared/types';
import { api, day, describeSchedule, routineStatus, time, type Run } from './common';

type Filter = 'all' | 'failed' | 'did';
const didSomething = (summary: string) => /suggested|saved/.test(summary);
const clock = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function RoutineView({ data, routine, run, onDiscuss }: { data: Snapshot; routine: Routine; run: Run; onDiscuss: () => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const runs = data.routineRuns.filter(item => item.routineId === routine.id);
  const shown = runs.filter(item => filter === 'failed' ? item.status === 'failed' : filter === 'did' ? didSomething(item.summary) : true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = runs.find(item => item.id === selectedId) || shown[0];
  const [events, setEvents] = useState<RunEvent[]>([]);
  useEffect(() => {
    if (!selected) { setEvents([]); return; }
    let live = true;
    void api.runEvents(selected.id).then(value => { if (live) setEvents(value); });
    const off = api.onEvent((event: AppEvent) => { if (event.type === 'run-event' && event.value.runId === selected.id) setEvents(current => current.some(item => item.id === event.value.id) ? current : [...current, event.value]); });
    return () => { live = false; off(); };
  }, [selected?.id]);
  const agent = data.agents.find(item => item.id === routine.agentId);
  const status = routineStatus(routine, data.routineRuns);
  const byDay = new Map<string, typeof shown>();
  for (const item of shown) byDay.set(day(item.startedAt), [...(byDay.get(day(item.startedAt)) || []), item]);
  const duration = (start: string, end: string | null) => { if (!end) return '…'; const seconds = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000); return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`; };
  const logText = events.map(event => `${clock(event.at)}  ${event.kind.padEnd(6)}  ${event.text}`).join('\n');
  return <div className="ws-routine">
    <section className="ws-run-list" aria-label={`${routine.name} runs`}>
      <header className="ws-group-head">
        <div className="ws-group-title"><span className="ws-routine-icon"><Repeat2 size={15}/></span><div><h1>{routine.name}</h1><p>{agent?.name || 'Unknown agent'} · {describeSchedule(routine.schedule)}</p></div><span className={`ws-pill ${status.tone}`}>{routine.enabled ? status.tone === 'running' ? 'Running' : 'On' : 'Paused'}</span></div>
        <div className="ws-row-actions">
          <button className="ws-btn primary" onClick={onDiscuss}><MessageSquare size={13}/> Discuss</button>
          <button className="ws-btn" disabled={status.tone === 'running'} onClick={() => void run(() => api.runRoutine(routine.id))}><Play size={12}/> Run now</button>
          <button className="ws-btn" onClick={() => void run(() => api.setRoutineEnabled(routine.id, !routine.enabled))}>{routine.enabled ? <><Pause size={12}/> Pause</> : <><Play size={12}/> Resume</>}</button>
        </div>
        <details className="ws-instructions"><summary>Instructions</summary><p>{routine.instructions}</p></details>
        <div className="ws-filters" role="group" aria-label="Filter runs">
          <button aria-pressed={filter === 'all'} className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All · {runs.length}</button>
          <button aria-pressed={filter === 'failed'} className={filter === 'failed' ? 'on' : ''} onClick={() => setFilter('failed')}>Failed · {runs.filter(item => item.status === 'failed').length}</button>
          <button aria-pressed={filter === 'did'} className={filter === 'did' ? 'on' : ''} onClick={() => setFilter('did')}>Did something · {runs.filter(item => didSomething(item.summary)).length}</button>
        </div>
      </header>
      <div className="ws-thread-items">
        {[...byDay].map(([label, items]) => <div key={label}>
          <div className="ws-group-label">{label.toUpperCase()}</div>
          {items.map(item => <button key={item.id} className={`ws-run-item ${item.id === selected?.id ? 'selected' : ''}`} onClick={() => setSelectedId(item.id)}>
            {item.status === 'ok' ? <Check size={14} className="ok"/> : item.status === 'failed' ? <X size={14} className="failed"/> : <span className="ws-live"/>}
            <span><strong>{time(item.startedAt)}</strong><small className={item.status === 'failed' ? 'failed' : ''}>{item.summary || (item.status === 'running' ? 'Running…' : '—')}</small></span>
            <em>{duration(item.startedAt, item.endedAt)}</em>
          </button>)}
        </div>)}
        {!shown.length && <p className="ws-empty-line">{runs.length ? 'No runs match this filter.' : 'No runs yet. Run it now or wait for the next scheduled time.'}</p>}
      </div>
    </section>
    <main className="ws-run-log" aria-label="Run log">
      {selected ? <>
        <header className="ws-thread-head"><div><h2>Run · {day(selected.startedAt)} {time(selected.startedAt)}</h2><p>{selected.id.slice(0, 8)} · {selected.trigger} · {selected.status} · {duration(selected.startedAt, selected.endedAt)}{selected.summary ? ` · ${selected.summary}` : ''}</p></div>
          <button className="ws-btn" onClick={() => void navigator.clipboard.writeText(logText)}><Copy size={13}/> Copy log</button></header>
        <pre className="ws-log">{events.map(event => <div key={event.id} className={`ws-log-line ${event.kind}`}><span className="t">{clock(event.at)}</span><span className="k">{event.kind}</span><span className="x">{event.text}</span></div>)}</pre>
      </> : <div className="ws-thread-empty"><p>Select a run to see its log.</p></div>}
    </main>
  </div>;
}
