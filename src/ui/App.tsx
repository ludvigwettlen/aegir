import { validTaskScope } from '../../shared/task-filters';
import { loadTaskFilters } from './views/TaskFilters';
import { CommandPalette } from './views/CommandPalette';
import { OneOnOnesView } from './views/OneOnOnesView';
import { emptyOneOnOnes } from '../../shared/one-on-ones';
import { defaultTypography } from '../../shared/typography';
import { applyTypography } from './typography';
import { X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Snapshot } from '../../shared/types';
import { ApprovalDock } from './views/ApprovalDock';
import { api, type Route, type Run } from './views/common';
import { useWorkspaceKeyboard } from './hooks/useWorkspaceKeyboard';
import { ThreadsView } from './views/ThreadsView';
import { newThread } from './command-navigation';
import { MemoryView } from './views/MemoryView';
import { RoutineView } from './views/RoutineView';
import { SkillsView } from './views/SkillsView';
import { SettingsView } from './views/SettingsView';
import { ShortcutHints } from './views/ShortcutHints';
import { Sidebar } from './views/Sidebar';
import { TaskListDialog, type TaskListAction } from './views/TaskListDialog';
import { TasksView } from './views/TasksView';
import { SplashScreen } from './views/SplashScreen';
import { UiFeedback } from './views/UiFeedback';
import { OnboardingView } from './views/OnboardingView';

export function App() {
  const [, refreshDate] = useState(0);
  useEffect(() => {
    const refresh = () => refreshDate(value => value + 1);
    const timer = setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);

  const [showSplash, setShowSplash] = useState(true);
  const dismissSplash = useCallback(() => setShowSplash(false), []);
  const [data, setData] = useState<Snapshot | null>(null);
  const [route, setRoute] = useState<Route>({ view: 'tasks', list: 'today' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [listAction, setListAction] = useState<TaskListAction | null>(null);
  const [feedbackActive, setFeedbackActive] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const onboardingVisible = setupOpen || data?.onboarding?.showOnLaunch === true;
  useEffect(() => {
    void api.snapshot().then(setData);
    return api.onEvent((event) => {
      if (event.type === 'snapshot') setData(event.value);
      if (event.type === 'open-settings') {
        setListAction(null);
        setRoute({ view: 'settings' });
      }
    });
  }, []);
  const migratedViews = useRef(false);
  useEffect(() => {
    if (!data || migratedViews.current) return;
    migratedViews.current = true;
    // Move the previous local presets into durable sidebar views. Stable IDs make retries idempotent.
    void (async () => {
      for (const key of Object.keys(localStorage).filter(key => key.startsWith('aegir.task-filters.'))) {
        const scope = key.slice('aegir.task-filters.'.length);
        if (!validTaskScope(scope) || scope.startsWith('list:') && !data.taskLists.some(list => list.id === scope.slice(5))) continue;
        const previous = loadTaskFilters(scope);
        for (const preset of previous.saved) {
          const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${scope}:${preset.name}`));
          const id = `legacy-${Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
          if (!data.taskViews?.some(view => view.id === id)) await api.saveTaskView({ id, name: preset.name, scope, filter: preset.filter });
        }
        if (previous.saved.length) localStorage.setItem(key, JSON.stringify({ filter: previous.filter, saved: [] }));
      }
    })().catch(() => setError('Could not migrate some saved views. Original presets are preserved; reopen the app to retry.'));
  }, [data]);
  const typography = data?.typography ?? defaultTypography;
  useLayoutEffect(() => {
    applyTypography(typography);
  }, [typography]);
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
  useWorkspaceKeyboard(run, setRoute, setNotice, !showSplash && !onboardingVisible);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  if (showSplash) return <SplashScreen onComplete={dismissSplash} />;
  if (!data) return <div className="loading">Loading Aegir…</div>;
  if (onboardingVisible && data.onboarding) return <OnboardingView data={data} onClose={() => setSetupOpen(false)} onSettings={() => { setSetupOpen(false); setRoute({ view: 'settings' }); }} />;
  const routine =
    route.view === 'routine'
      ? data.routines.find((item) => item.id === route.routineId)
      : undefined;
  const discuss = (name: string) => {
    setRoute({ view: 'chats', draft: `@${name} ` });
  };
  return (
    <div className="ws-shell">
      <ShortcutHints route={route} showTaskPriorities={data.showTaskPriorities !== false} />
      <CommandPalette data={data} route={route} go={setRoute} run={run} notify={setNotice}
        onNewList={() => setListAction({ kind: 'create' })} />
      <UiFeedback route={route} active={feedbackActive} onActiveChange={setFeedbackActive} />
      <Sidebar data={data} route={route} go={setRoute} onNewThread={() => { setRoute({ view: 'chats' }); requestAnimationFrame(() => requestAnimationFrame(() => newThread(setNotice))); }} onNewList={() => setListAction({ kind: 'create' })} />
      <div className="ws-main">
        {route.view === 'tasks' && (
          <TasksView navigationToken={route} onNavigate={list => setRoute({ view: 'tasks', list })} data={data} run={run} list={route.list} notify={setNotice} onManageList={setListAction}
            onOpenThread={threadId => setRoute({ view: 'chats', threadId })} />
        )}
        {route.view === 'chats' && (
          <ThreadsView
            key={route.draft ?? 'threads'}
            data={data}
            threadId={route.threadId}
            draft={route.draft}
            run={run}
            onSelectThread={threadId => setRoute({ view: 'chats', threadId })}
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
        {route.view === 'one-on-ones' && <OneOnOnesView data={data} state={data.oneOnOnes || emptyOneOnOnes} run={run} />}
        {route.view === 'memory' && (
          <main className="full-page" data-keyboard-pane="page" tabIndex={-1}>
            <MemoryView data={data} run={run} />
          </main>
        )}
        {route.view === 'skills' && <SkillsView key={route.agentId || 'all'} initialAgent={route.agentId} data={data} run={run} />}
        {route.view === 'settings' && (
          <main className="full-page" data-keyboard-pane="page" tabIndex={-1}>
            <SettingsView data={data} run={run} onSetup={() => setSetupOpen(true)} onSkills={agentId => setRoute({ view: 'skills', agentId })} />
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
      {listAction && <TaskListDialog action={listAction} onClose={() => setListAction(null)}
        onSaved={id => setRoute({ view: 'tasks', list: id ? `list:${id}` : 'inbox' })} />}

    </div>
  );
}
