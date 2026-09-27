import { Check, Inbox, LayoutGrid, Plus, ArrowRight } from 'lucide-react';
import type { Task } from '../../../shared/types';
import { Button } from './primitives';

export type TaskList = 'proposed' | 'active' | 'done';

export function TaskListNav({ selected, proposedCount, activeCount, onSelect }: {
  selected: TaskList;
  proposedCount: number;
  activeCount: number;
  onSelect: (list: TaskList) => void;
}) {
  return <aside className="task-rail" aria-label="Task lists">
    <button type="button" className={selected === 'proposed' ? 'selected' : ''} aria-current={selected === 'proposed' ? 'page' : undefined} onClick={() => onSelect('proposed')}><Inbox size={16} aria-hidden="true"/><span>Inbox</span><small>{proposedCount}</small></button>
    <button type="button" className={selected === 'active' ? 'selected' : ''} aria-current={selected === 'active' ? 'page' : undefined} onClick={() => onSelect('active')}><LayoutGrid size={16} aria-hidden="true"/><span>Upcoming</span><small>{activeCount}</small></button>
    <button type="button" className={selected === 'done' ? 'selected' : ''} aria-current={selected === 'done' ? 'page' : undefined} onClick={() => onSelect('done')}><Check size={16} aria-hidden="true"/><span>Completed</span></button>
  </aside>;
}

export function TaskQuickAdd({ value, onChange, onSubmit }: { value: string; onChange: (value: string) => void; onSubmit: () => void }) {
  return <form className="quick-add" onSubmit={event => { event.preventDefault(); if (value.trim()) onSubmit(); }}>
    <Plus size={20} aria-hidden="true"/>
    <input id="new-task" aria-label="Add a task" placeholder="Add a task…" value={value} onChange={event => onChange(event.target.value)}/>
    <Button type="submit" size="sm" icon aria-label="Create task" disabled={!value.trim()}><ArrowRight size={16}/></Button>
  </form>;
}

const statusLabels: Record<Task['status'], string> = {
  proposed: 'Proposed', ready: 'Ready', running: 'Running', blocked: 'Blocked', done: 'Completed', dismissed: 'Dismissed',
};

export function TaskStatus({ status }: { status: Task['status'] }) {
  return <span className={`task-status ${status}`} role="img" aria-label={`Task status: ${statusLabels[status]}`}>
    {status === 'done' ? <Check size={14} aria-hidden="true"/> : status === 'running' ? <span className="spinner"/> : <span/>}
  </span>;
}

export function TaskEmptyState({ list }: { list: TaskList }) {
  const content = {
    proposed: { icon: <Inbox size={22}/>, title: 'No proposed work yet', detail: 'Hourly reviews will suggest follow-ups here.' },
    active: { icon: <LayoutGrid size={22}/>, title: 'A clear desk.', detail: 'Add a task above or accept one from your review inbox.' },
    done: { icon: <Check size={22}/>, title: 'Nothing completed yet', detail: 'Finished goals will appear here.' },
  }[list];
  return <div className="panel-empty task-empty"><span className="empty-icon" aria-hidden="true">{content.icon}</span><h3>{content.title}</h3><p>{content.detail}</p></div>;
}
