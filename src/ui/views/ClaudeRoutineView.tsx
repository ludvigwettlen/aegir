import { useState } from 'react';
import { AlertCircle, Check, CircleHelp, Repeat2, X } from 'lucide-react';
import type { ClaudeRoutine, ClaudeRun } from '../../../shared/types';
import { claudeRoutineName } from '../../../shared/cron';
import { day, time } from './common';

type Filter = 'all' | 'failed' | 'needs';
const statusText: Record<ClaudeRun['status'], string> = { completed: 'Completed', failed: 'Failed', needs_action: 'Needs you', unknown: 'No summary' };
const duration = (start: string, end: string | null) => { if (!end) return ''; const seconds = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000)); return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`; };
function StatusIcon({ status }: { status: ClaudeRun['status'] }) {
  if (status === 'completed') return <Check size={14} className="ok"/>;
  if (status === 'failed') return <X size={14} className="failed"/>;
  if (status === 'needs_action') return <AlertCircle size={14} className="needs"/>;
  return <CircleHelp size={14} className="unknown"/>;
}

export function ClaudeRoutineView({ task }: { task: ClaudeRoutine }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const name = claudeRoutineName(task.name);
  const shown = task.runs.filter(item => filter === 'failed' ? item.status === 'failed' : filter === 'needs' ? item.status === 'needs_action' : true);
  const selected = task.runs.find(item => item.startedAt === selectedKey) || shown[0];
  const byDay = new Map<string, ClaudeRun[]>();
  for (const item of shown) byDay.set(day(item.startedAt), [...(byDay.get(day(item.startedAt)) || []), item]);
  return <div className="ws-routine">
    <section className="ws-run-list" aria-label={`${name} runs`}>
      <header className="ws-group-head">
        <div className="ws-group-title"><span className="ws-routine-icon"><Repeat2 size={15}/></span><div><h1>{name}</h1><p>Claude Code · {task.schedule}</p></div><span className={`ws-pill ${task.enabled ? '' : 'paused'}`}>{task.enabled ? 'On' : 'Paused'}</span></div>
        <p className="ws-claude-note">Runs in Claude Code. Change it there; Legolas only shows it.</p>
        {task.description && <details className="ws-instructions"><summary>Description</summary><p>{task.description}</p></details>}
        <div className="ws-filters" role="group" aria-label="Filter runs">
          <button aria-pressed={filter === 'all'} className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All · {task.runs.length}</button>
          <button aria-pressed={filter === 'failed'} className={filter === 'failed' ? 'on' : ''} onClick={() => setFilter('failed')}>Failed · {task.runs.filter(item => item.status === 'failed').length}</button>
          <button aria-pressed={filter === 'needs'} className={filter === 'needs' ? 'on' : ''} onClick={() => setFilter('needs')}>Needs you · {task.runs.filter(item => item.status === 'needs_action').length}</button>
        </div>
      </header>
      <div className="ws-thread-items" data-keyboard-pane="list" tabIndex={-1}>
        {[...byDay].map(([label, items]) => <div key={label}>
          <div className="ws-group-label">{label.toUpperCase()}</div>
          {items.map(item => <button key={item.startedAt} data-keyboard-item data-keyboard-current={item === selected ? '' : undefined} className={`ws-run-item ${item === selected ? 'selected' : ''}`} onClick={() => setSelectedKey(item.startedAt)}>
            <StatusIcon status={item.status}/>
            <span><strong>{time(item.startedAt)}</strong><small className={item.status === 'failed' ? 'failed' : ''}>{item.detail || statusText[item.status]}</small></span>
            <em>{duration(item.startedAt, item.endedAt)}</em>
          </button>)}
        </div>)}
        {!shown.length && <p className="ws-empty-line">{task.runs.length ? 'No runs match this filter.' : 'No runs in the last 14 days.'}</p>}
      </div>
    </section>
    <main className="ws-run-log" aria-label="Run detail" data-keyboard-pane="detail" tabIndex={-1}>
      {selected ? <>
        <header className="ws-thread-head"><div><h2>Run · {day(selected.startedAt)} {time(selected.startedAt)}</h2><p>{statusText[selected.status]}{selected.endedAt ? ` · ${duration(selected.startedAt, selected.endedAt)}` : ''}</p></div></header>
        <div className="ws-claude-run">
          <p>{selected.detail || 'Claude Code left no summary for this run.'}</p>
          {selected.needsAction && <div className="ws-claude-needs"><strong>Needs you</strong><p>{selected.needsAction}</p></div>}
        </div>
      </> : <div className="ws-thread-empty"><p>Select a run to see what it did.</p></div>}
    </main>
  </div>;
}
