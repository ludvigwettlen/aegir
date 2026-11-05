import { conversationThreads } from '../../../shared/conversations';
import { tasksForSavedView } from '../../../shared/task-filters';
import { openCommandPalette } from '../commands';
import type { ReactNode } from 'react';
import { CalendarDays, CheckCheck, Inbox, List, Plus, Repeat2, Search, Sun, Users, MessageSquare } from 'lucide-react';
import type { Snapshot } from '../../../shared/types';
import { tasksFor } from '../../../shared/tasks';
import { routineStatus, type Route } from './common';

function Item({
  active,
  onClick,
  icon,
  label,
  count,
  detail,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  count?: number | string;
  detail?: string;
  tone?: string;
}) {
  return (
    <button
      data-nav-item
      aria-label={label}
      title={label}
      className={`ws-nav-item ${active ? 'active' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      <span className="ws-nav-icon">{icon}</span>
      <span className="ws-nav-text">
        <span>{label}</span>
        {detail && <small className={tone}>{detail}</small>}
      </span>
      {count !== undefined && count !== 0 && (
        <span className={`ws-nav-count ${tone || ''}`}>{count}</span>
      )}
    </button>
  );
}

export function Sidebar({
  data,
  route,
  go,
  onNewThread,
  onNewList,
}: {
  data: Snapshot;
  route: Route;
  go: (route: Route) => void;
  onNewThread: () => void;
  onNewList: () => void;
}) {
  const needs = tasksFor('needs', data.tasks).length;
  const isList = (list: string) => route.view === 'tasks' && route.list === list;
  const chats = conversationThreads(data.threads, data.groups, data.agents).filter(thread => thread.kind === 'chat' && thread.status === 'active');
  return (
    <nav className="ws-sidebar" aria-label="Workspace" data-keyboard-pane="sidebar">
      <Item active={false} onClick={() => openCommandPalette()} icon={<Search size={16} />} label="Search tasks and commands" />
      <div className="ws-nav-label">TASKS</div>
      <Item active={isList('inbox')} onClick={() => go({ view: 'tasks', list: 'inbox' })}
        icon={<Inbox size={16} />} label="Inbox" count={tasksFor('inbox', data.tasks).length} />
      <Item
        active={isList('needs')}
        onClick={() => go({ view: 'tasks', list: 'needs' })}
        icon={<Inbox size={16} />}
        label="Needs you"
        count={needs + data.approvals.length}
        tone="attention"
      />
      <Item
        active={isList('today')}
        onClick={() => go({ view: 'tasks', list: 'today' })}
        icon={<Sun size={16} />}
        label="Today"
        count={tasksFor('today', data.tasks).length}
      />
      <Item
        active={isList('upcoming')}
        onClick={() => go({ view: 'tasks', list: 'upcoming' })}
        icon={<CalendarDays size={16} />}
        label="Upcoming"
        count={tasksFor('upcoming', data.tasks).length}
      />
      <Item
        active={isList('team')}
        onClick={() => go({ view: 'tasks', list: 'team' })}
        icon={<Users size={16} />}
        label="Delegated"
        count={tasksFor('team', data.tasks).length}
      />
      <Item
        active={isList('completed')}
        onClick={() => go({ view: 'tasks', list: 'completed' })}
        icon={<CheckCheck size={16} />}
        label="Completed"
        count={tasksFor('completed', data.tasks).length}
      />
      <div className="ws-nav-label">
        <span>MY LISTS</span>
        <button aria-label="New list" title="New list" onClick={onNewList}><Plus size={13} /></button>
      </div>
      {data.taskLists.map(list => <Item key={list.id} active={isList(`list:${list.id}`)}
        onClick={() => go({ view: 'tasks', list: `list:${list.id}` })}
        icon={<List size={16} />} label={list.name} count={tasksFor(`list:${list.id}`, data.tasks).length} />)}
      <div className="ws-nav-label"><span>FILTERED VIEWS</span><button aria-label="New filtered view" title="New filtered view" onClick={() => go({ view: 'tasks', list: 'all' })}><Plus size={13} /></button></div>
      {(data.taskViews ?? []).map(view => <Item key={view.id} active={isList(`view:${view.id}`)} onClick={() => go({ view: 'tasks', list: `view:${view.id}` })} icon={<List size={16} />} label={view.name} count={tasksForSavedView(view, data.tasks, new Date(), data.showTaskPriorities !== false).length} />)}
      <div className="ws-nav-label">MEETINGS</div>
      <Item active={route.view === 'one-on-ones'} onClick={() => go({ view: 'one-on-ones' })} icon={<Users size={16} />} label="Meetings" />
      <div className="ws-nav-label"><span>CHATS</span><button aria-label="New thread" title="New thread" onClick={onNewThread}><Plus size={13} /></button></div>
      <Item active={route.view === 'chats'} onClick={() => go({ view: 'chats' })} icon={<MessageSquare size={16} />} label="All threads" count={chats.length} />
      <div className="ws-nav-label">ROUTINES</div>
      {data.routines.map((routine) => {
        const status = routineStatus(routine, data.routineRuns);
        return (
          <Item
            key={routine.id}
            active={route.view === 'routine' && route.routineId === routine.id}
            onClick={() => go({ view: 'routine', routineId: routine.id })}
            icon={<Repeat2 size={15} />}
            label={routine.name}
            count={status.text}
            tone={`routine ${status.tone}`}
          />
        );
      })}
    </nav>
  );
}
