import { X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { Snapshot } from '../../shared/types';
import { ApprovalDock } from './views/ApprovalDock';
import { api, isTyping, type Route, type Run } from './views/common';
import { GroupView } from './views/GroupView';
import { MemoryView } from './views/MemoryView';
import { NewGroupModal } from './views/NewGroupModal';
import { RoutineView } from './views/RoutineView';
import { SettingsView } from './views/SettingsView';
import { Sidebar } from './views/Sidebar';
import { TasksView } from './views/TasksView';

export function App() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [route, setRoute] = useState<Route>({ view: 'tasks', list: 'today' });
  const [error, setError] = useState('');
  const [showNewGroup, setShowNewGroup] = useState(false);
  useEffect(() => {
    void api.snapshot().then(setData);
    return api.onEvent((event) => {
      if (event.type === 'snapshot') setData(event.value);
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
  // g then t/u/w/n jumps between task lists, Linear/Godspeed style.
  useEffect(() => {
    let pending = false;
    let timer = 0;
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (pending) {
        pending = false;
        window.clearTimeout(timer);
        const list = ({ t: 'today', u: 'upcoming', w: 'team', n: 'needs' } as const)[
          event.key as 't' | 'u' | 'w' | 'n'
        ];
        if (list) {
          event.preventDefault();
          setRoute({ view: 'tasks', list });
        }
        return;
      }
      if (event.key === 'g') {
        pending = true;
        timer = window.setTimeout(() => {
          pending = false;
        }, 900);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!data) return <div className="loading">Loading Ägir…</div>;
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
      <Sidebar data={data} route={route} go={setRoute} onNewGroup={() => setShowNewGroup(true)} />
      <div className="ws-main">
        {route.view === 'tasks' && (
          <TasksView key={route.list} data={data} run={run} list={route.list} />
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
          />
        )}
        {route.view === 'memory' && (
          <main className="full-page">
            <MemoryView data={data} run={run} />
          </main>
        )}
        {route.view === 'settings' && (
          <main className="full-page">
            <SettingsView data={data} run={run} />
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
    </div>
  );
}
