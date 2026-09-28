import type { ReactNode } from 'react';
import { BookOpen, CalendarDays, CheckCheck, FileText, Inbox, Plus, Repeat2, Settings2, Sun, Users } from 'lucide-react';
import type { Snapshot } from '../../../shared/types';
import { tasksFor } from '../../../shared/tasks';
import { Avatar, routineStatus, type Route } from './common';

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
  onNewGroup,
}: {
  data: Snapshot;
  route: Route;
  go: (route: Route) => void;
  onNewGroup: () => void;
}) {
  const needs = tasksFor('needs', data.tasks).length;
  const isList = (list: string) => route.view === 'tasks' && route.list === list;
  const groups = data.groups.filter((group) => group.kind === 'group');
  const privates = data.groups.filter((group) => group.kind === 'private');
  const connected = data.connectors
    .filter((connector) => connector.status === 'connected')
    .map((connector) => (connector.id === 'slack' ? 'Slack' : 'Notion'));
  return (
    <nav className="ws-sidebar" aria-label="Workspace" data-keyboard-pane="sidebar">
      <Item
        active={isList('needs')}
        onClick={() => go({ view: 'tasks', list: 'needs' })}
        icon={<Inbox size={16} />}
        label="Needs you"
        count={needs + data.approvals.length}
        tone="attention"
      />
      <div className="ws-nav-label">TASKS</div>
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
        label="With the team"
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
        <span>GROUPS</span>
        <button aria-label="New group" onClick={onNewGroup}>
          <Plus size={13} />
        </button>
      </div>
      {groups.map((group) => (
        <Item
          key={group.id}
          active={route.view === 'group' && route.groupId === group.id}
          onClick={() => go({ view: 'group', groupId: group.id })}
          icon={<span className="ws-hash">#</span>}
          label={group.title}
        />
      ))}
      <div className="ws-nav-label">AGENTS</div>
      {privates.map((group) => {
        const agent = data.agents.find((item) => item.id === group.leadAgentId);
        const thread = data.threads.find((item) => agent && item.busyAgentIds.includes(agent.id));
        const working = Boolean(thread);
        return (
          <Item
            key={group.id}
            active={route.view === 'group' && route.groupId === group.id}
            onClick={() => go({ view: 'group', groupId: group.id })}
            icon={
              <span className="ws-nav-avatar">
                <Avatar agent={agent} size={20} />
                {working && <i className="ws-live-dot" />}
              </span>
            }
            label={group.title}
            detail={thread ? `Working · ${thread.title}` : agent?.role}
            tone={thread ? 'live' : undefined}
          />
        );
      })}
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
      <div className="ws-sidebar-foot">
        <button data-nav-item aria-label="Skills" title="Skills" className={route.view === 'skills' ? 'active' : ''} onClick={() => go({ view: 'skills' })}><BookOpen size={15}/></button>
        <button
          data-nav-item
          aria-label="Memory"
          title="Memory"
          className={route.view === 'memory' ? 'active' : ''}
          onClick={() => go({ view: 'memory' })}
        >
          <FileText size={15} />
        </button>
        <button
          data-nav-item
          aria-label="Settings"
          title="Settings"
          className={route.view === 'settings' ? 'active' : ''}
          onClick={() => go({ view: 'settings' })}
        >
          <Settings2 size={15} />
        </button>
        <span className="grow" />
        <span
          className={`ws-sources ${connected.length ? 'on' : ''}`}
          title={`${connected.length} of 2 sources connected`}
        >
          <i />
          {connected.length ? connected.join(' · ') : 'No sources'}
        </span>
      </div>
    </nav>
  );
}
