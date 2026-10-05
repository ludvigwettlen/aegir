import { X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { Snapshot } from '../../shared/types';
import { ApprovalDock } from './views/ApprovalDock';
import { CommandPalette } from './views/CommandPalette';
import { api, type Route, type Run } from './views/common';
import { useWorkspaceKeyboard } from './hooks/useWorkspaceKeyboard';
import { useClaudeRoutines } from './hooks/useClaudeRoutines';
import { ClaudeRoutineView } from './views/ClaudeRoutineView';
import { GroupView } from './views/GroupView';
import { MemoryView } from './views/MemoryView';
import { NewGroupModal } from './views/NewGroupModal';
import { RoutineView } from './views/RoutineView';
import { SkillsView } from './views/SkillsView';
import { SettingsView } from './views/SettingsView';
import { ShortcutHints } from './views/ShortcutHints';
import { Sidebar } from './views/Sidebar';
import { TasksView } from './views/TasksView';

export function App() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [route, setRoute] = useState<Route>({ view: 'tasks', list: 'today' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showNewGroup, setShowNewGroup] = useState(false);
  useEffect(() => {
    void api.snapshot().then(setData);
    return api.onEvent((event) => {
      if (event.type === 'snapshot') setData(event.value);
      if (event.type === 'open-settings') {
        setShowNewGroup(false);
        setRoute({ view: 'settings' });
      }
    });
  }, []);
  const run: Run = useCallback(async (action) => {
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(
        String(cause).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''),
      );
    }
  }, []);
  useWorkspaceKeyboard(run, setRoute, setNotice);
  const claude = useClaudeRoutines();
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  if (!data) return <div className="loading">Loading Legolas…</div>;
  const group =
    route.view === 'group' ? data.groups.find((item) => item.id === route.groupId) : undefined;
  const routine =
    route.view === 'routine'
      ? data.routines.find((item) => item.id === route.routineId)
      : undefined;
  const discuss = (name: string) => {
    const home = data.groups.find((item) => item.kind === 'group') || data.groups[0];
    setRoute({ view: 'group', groupId: home.id, draft: `@${name} ` });
  };
  return (
    <div className="ws-shell">
      <ShortcutHints route={route} />
      <Sidebar data={data} route={route} go={setRoute} onNewGroup={() => setShowNewGroup(true)} claude={claude} />
      <div className="ws-main">
        {route.view === 'tasks' && (
          <TasksView data={data} run={run} list={route.list} notify={setNotice}
            onOpenThread={(groupId, threadId) => setRoute({ view: 'group', groupId, threadId })} />
        )}
        {route.view === 'group' && group && (
          <GroupView
            key={`${group.id}:${route.draft || ''}`}
            data={data}
            group={group}
            threadId={route.threadId}
            draft={route.draft}
            run={run}
            onSelectThread={(threadId) => setRoute({ view: 'group', groupId: group.id, threadId })}
          />
        )}
        {route.view === 'routine' && routine && (
          <RoutineView
            key={routine.id}
            data={data}
            routine={routine}
            run={run}
            onDiscuss={() => discuss(routine.name)}
            onDeleted={() => setRoute({ view: 'tasks', list: 'today' })}
          />
        )}
        {route.view === 'claude-routine' && (() => {
          const task = claude.tasks.find((item) => item.id === route.id);
          return task ? <ClaudeRoutineView key={task.id} task={task} /> : null;
        })()}
        {route.view === 'memory' && (
          <main className="full-page" data-keyboard-pane="page" tabIndex={-1}>
            <MemoryView data={data} run={run} />
          </main>
        )}
        {route.view === 'skills' && <SkillsView key={route.agentId || 'all'} initialAgent={route.agentId} data={data} run={run} />}
        {route.view === 'settings' && (
          <main className="full-page" data-keyboard-pane="page" tabIndex={-1}>
            <SettingsView data={data} run={run} onSkills={agentId => setRoute({ view: 'skills', agentId })} />
          </main>
        )}
      </div>
      {data.approvals.length > 0 && <ApprovalDock approvals={data.approvals} run={run} />}
      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button className="bare" aria-label="Dismiss error" onClick={() => setError('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {notice && <div className="ws-notice" role="status">{notice}</div>}
      {showNewGroup && (
        <NewGroupModal
          agents={data.agents}
          onClose={() => setShowNewGroup(false)}
          onCreate={(title, agentIds) =>
            run(async () => {
              const created = await api.createGroup(title, agentIds);
              setRoute({ view: 'group', groupId: created.id });
              setShowNewGroup(false);
            })
          }
        />
      )}
      {/* Last, so the views have registered their current commands before the palette reads them. */}
      <CommandPalette data={data} route={route} go={setRoute} run={run} notify={setNotice} onNewGroup={() => setShowNewGroup(true)} />
    </div>
  );
}
