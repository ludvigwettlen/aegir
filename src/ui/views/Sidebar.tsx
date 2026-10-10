import type { ReactNode } from 'react';
import { Bot, CalendarDays, CheckCheck, Inbox, Plus, Repeat2, Search, Sun, Archive as Tray } from 'lucide-react';
import type { ClaudeRoutines, Snapshot } from '../../../shared/types';
import { claudeRoutineName } from '../../../shared/cron';
import { tasksFor } from '../../../shared/tasks';
import { Avatar, Kbd, routineStatus, type Route } from './common';
import { openCommandPalette } from '../commands';

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
  onNewGroup,
  claude,
}: {
  data: Snapshot;
  claude?: ClaudeRoutines;
  route: Route;
  go: (route: Route) => void;
  onNewGroup: () => void;
}) {
  const needs = tasksFor('needs', data.tasks).length;
  const isList = (list: string) => route.view === 'tasks' && route.list === list;
  const groups = data.groups.filter((group) => group.kind === 'group');
  const privates = data.groups.filter((group) => group.kind === 'private');
  return (
    <nav className="ws-sidebar" aria-label="Workspace" data-keyboard-pane="sidebar">
      {/* Finds any task on any list, the same box as ⌘F. */}
      <button type="button" className="ws-sidebar-search" title="Find any task (⌘F)" onClick={() => openCommandPalette('go.find')}>
        <Search size={14} aria-hidden="true" />
        <span>Search tasks</span>
        <Kbd>⌘F</Kbd>
      </button>
      <div className="ws-nav-label">TASKS</div>
      <Item
        active={isList('needs')}
        onClick={() => go({ view: 'tasks', list: 'needs' })}
        icon={<Inbox size={16} />}
        label="Needs you"
        count={needs + data.approvals.length}
        tone="attention"
      />
      <Item
        active={isList('inbox')}
        onClick={() => go({ view: 'tasks', list: 'inbox' })}
        icon={<Tray size={16} />}
        label="Inbox"
        count={tasksFor('inbox', data.tasks).length}
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
        icon={<Bot size={16} />}
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
      {!!claude?.tasks.length && <div className="ws-nav-sublabel">Claude Code</div>}
      {claude?.tasks.map((task) => (
        <Item
          key={`claude:${task.id}`}
          active={route.view === 'claude-routine' && route.id === task.id}
          onClick={() => go({ view: 'claude-routine', id: task.id })}
          icon={<Repeat2 size={15} />}
          label={claudeRoutineName(task.name)}
          count={task.enabled ? 'On' : 'Paused'}
          tone={`routine ${task.enabled ? 'ok' : 'paused'}`}
        />
      ))}
    </nav>
  );
}
