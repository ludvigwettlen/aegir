import { TaskDelegation } from './TaskDelegation';
import { TaskLabelsDialog } from './TaskLabelsDialog';
import { taskLabels, parseLabels } from '../../../shared/task-labels';
import { TaskFilters, loadTaskFilters } from './TaskFilters';
import { filterTasks, compareTasks, selectedLabels, taskViewScope, taskFilterForPriorities, type TaskFilter, type TaskScope } from '../../../shared/task-filters';
import { TaskSnoozeDialog } from './TaskSnoozeDialog';
import { takeTaskFocus } from '../task-focus';
import { useCommands, type Command } from '../commands';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { CheckCheck, ChevronRight, ExternalLink, Flag, Maximize2, Minimize2, Plus, Repeat2, AlarmClock, Square, Users, X } from 'lucide-react';
import type { Snapshot, Task } from '../../../shared/types';
import { taskLinkLabel } from '../../../shared/task-links';
import { canMarkTaskReviewed, isTaskSnoozed, isoDate, customListId, taskRecurrenceLabels, parseDue, parseQuickAdd, taskCursor, tasksFor, type BuiltInTaskView, type TaskView } from '../../../shared/tasks';
import {
  api,
  Avatar,
  dueLabel,
  isOverdue,
  isTyping,
  TaskGlyph,
  taskStatusText,
  type Run,
} from './common';
import { ThreadView } from './ThreadView';
import { TaskDocuments } from './TaskDocuments';
import { Button } from '../design-system/primitives';
import { TaskRepeat } from './TaskRepeat';
import { MoveTaskDialog } from './MoveTaskDialog';
import type { TaskListAction } from './TaskListDialog';
import { useTaskDetailWidth } from '../hooks/useTaskDetailWidth';

const titles: Record<BuiltInTaskView, string> = {
  all: 'All open tasks',
  inbox: 'Inbox',
  today: 'Today',
  upcoming: 'Upcoming',
  team: 'Delegated',
  needs: 'Needs you',
  completed: 'Completed',
};
type Popover = { kind: 'handoff' | 'label' | 'due'; taskId: string } | null;
const rank: Record<Task['status'], number> = {
  review: 0,
  blocked: 1,
  proposed: 2,
  running: 3,
  ready: 4,
  done: 5,
  dismissed: 6,
};

function groupTasks(list: TaskView, tasks: Task[], sort: TaskFilter['sort'] = 'default') {
  if (sort !== 'default') return tasks.length ? [['Tasks', [...tasks].sort((a, b) => compareTasks(a, b, sort))] as [string, Task[]]] : [];
  if (list === 'completed') return tasks.length ? [['Completed', tasks] as [string, Task[]]] : [];
  const sorted = [...tasks].sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (a.dueAt || '9999').localeCompare(b.dueAt || '9999') ||
      a.createdAt.localeCompare(b.createdAt),
  );
  const groups = new Map<string, Task[]>();
  for (const task of sorted) {
    const key =
      list === 'needs' ? (task.delegation && ['Blocked', 'Ready for review', 'Done'].includes(task.delegation.status) ? task.delegation.status : taskStatusText[task.status]) : taskLabels(task).length ? taskLabels(task).map(label => `#${label}`).join(' · ') : 'No label';
    groups.set(key, [...(groups.get(key) || []), task]);
  }
  return [...groups].sort(([a], [b]) =>
    list === 'needs' ? 0 : a === 'No label' ? 1 : b === 'No label' ? -1 : a.localeCompare(b),
  );
}

export function TasksView({
  data,
  run,
  list,
  notify,
  onManageList,
  onOpenThread,
  onNavigate,
  navigationToken,
}: {
  navigationToken: object;
  onNavigate: (list: TaskView) => void;
  data: Snapshot;
  run: Run;
  list: TaskView;
  notify: (message: string) => void;
  onManageList: (action: TaskListAction) => void;
  onOpenThread: (groupId: string, threadId: string) => void;
}) {
  const savedView = list.startsWith('view:') ? data.taskViews?.find(view => view.id === list.slice(5)) : undefined;
  const [filters, setFilters] = useState<Record<string, TaskFilter>>({});
  const [scopes, setScopes] = useState<Record<string, TaskScope>>({});
  useLayoutEffect(() => {
    if (!list.startsWith('view:')) return;
    setFilters(previous => { const next = { ...previous }; delete next[list]; return next; });
    setScopes(previous => { const next = { ...previous }; delete next[list]; return next; });
  }, [list, navigationToken]);
  const scope = scopes[list] ?? taskViewScope(list, data.taskViews ?? []) ?? 'all';
  const filter = filters[list] ?? savedView?.filter ?? loadTaskFilters(list).filter;
  const baseTasks = tasksFor(scope, data.tasks);
  const [labelsTaskId, setLabelsTaskId] = useState<string | null>(null);
  const effectiveFilter = taskFilterForPriorities(filter, data.showTaskPriorities !== false);
  const listId = customListId(scope);
  const customList = data.taskLists.find(item => item.id === listId);
  const title = savedView?.name ?? (list.startsWith('view:') ? 'Filtered view unavailable' : customList?.name ?? titles[list as BuiltInTaskView]);
  const [cursors, setCursors] = useState<Partial<Record<TaskView, string>>>({});
  const [editTarget, setEditTarget] = useState<'title' | 'notes' | 'chat' | null>(null);
  const [popover, setPopover] = useState<Popover>(null);
  const [moveTaskId, setMoveTaskId] = useState<string | null>(null);
  const moveTask = data.tasks.find(task => task.id === moveTaskId);
  const [fullscreen, setFullscreen] = useState(false);
  const [draft, setDraft] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [capturePreview, setCapturePreview] = useState<Awaited<ReturnType<typeof api.captureTask>> | null>(null);
  const captureGeneration = useRef(0);
  const quickAdd = useRef<HTMLInputElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  const detailWidth = useTaskDetailWidth();
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const adding = useRef(false);
  const reviewPending = useRef(false);
  const [markingReviewed, setMarkingReviewed] = useState(false);
  const [createdTask, setCreatedTask] = useState<{ id: string; list: TaskView } | null>(null);
  const day = isoDate(new Date());
  const [snoozeTaskId, setSnoozeTaskId] = useState<string | null>(null);
  const groups = useMemo(() => groupTasks(scope, filterTasks(baseTasks, effectiveFilter), effectiveFilter.sort), [list, scope, data.tasks, day, JSON.stringify(selectedLabels(effectiveFilter)), effectiveFilter.labelMode, effectiveFilter.label, effectiveFilter.status, effectiveFilter.priority, effectiveFilter.sort]);
  const linkedTaskIds = useMemo(() => new Set(data.taskLinks.map(link => link.taskId)), [data.taskLinks]);
  const order = groups.flatMap(([, tasks]) => tasks);
  const previousLists = useRef<Partial<Record<TaskView, { order: string[]; selected?: string }>>>({});
  const previousList = previousLists.current[list];
  const selectedId = cursors[list] ?? previousList?.selected;
  const retained = useRef<{ list: TaskView; id?: string }>({ list });
  const selected = data.tasks.find(task => task.id === selectedId);
  const keepSelected = retained.current.list === list && retained.current.id === selectedId && selected && !['done', 'dismissed'].includes(selected.status);
  const currentId = keepSelected ? selectedId : taskCursor(order.map(task => task.id), previousList?.order ?? [], selectedId);
  const current = data.tasks.find(task => task.id === currentId);
  useLayoutEffect(() => {
    retained.current = { list, id: currentId };
    previousLists.current[list] = { order: order.map(task => task.id), selected: currentId };
    if (selectedId && selectedId !== currentId) {
      setCursors(previous => ({ ...previous, [list]: currentId }));
      // A removed row or detail button loses focus when React unmounts it.
      if (document.activeElement === document.body) {
        (rows.current?.querySelector<HTMLElement>('[data-keyboard-current]') || rows.current)?.focus();
      }
    }
  });
  const setCursor = (id: string) => setCursors((previous) => ({ ...previous, [list]: id }));
  useLayoutEffect(() => {
    const requested = takeTaskFocus(list, baseTasks.map(task => task.id));
    if (requested) {
      if (!order.some(task => task.id === requested)) setFilters(previous => ({ ...previous, [list]: { label: '', status: '', priority: '', sort: 'default' } }));
      setCursor(requested);
      requestAnimationFrame(() => rows.current?.querySelector<HTMLElement>('[data-keyboard-current]')?.focus());
    }
  });
  const open = current;
  const openId = open?.id;
  const returnToList = () => {
    if (current && !order.some(task => task.id === current.id)) {
      retained.current = { list };
      previousLists.current[list] = { order: order.map(task => task.id) };
      setCursors(previous => ({ ...previous, [list]: order[0]?.id }));
    }
    setFullscreen(false);
    window.requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('.ws-rows [data-keyboard-current]')?.focus(),
    );
  };
  useEffect(() => {
    captureGeneration.current++;
    setCapturePreview(null);
    setPopover(null);
    setSnoozeTaskId(null);
    setLabelsTaskId(null);
    setMoveTaskId(null);
    setFullscreen(false);
  }, [list]);
  useEffect(() => {
    if (!editTarget || !openId) return;
    const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      editTarget === 'chat'
        ? '.ws-task-detail [aria-label="Message"]'
        : editTarget === 'title'
        ? '.ws-task-detail [aria-label="Task title"]'
        : '.ws-task-detail [aria-label="Task notes"]',
    );
    const disclosure = field?.closest('details');
    if (disclosure) disclosure.open = true;
    field?.focus();
    if (editTarget === 'title') field?.select();
    setEditTarget(null);
  }, [editTarget, openId]);

  useEffect(() => {
    if (!createdTask) return;
    if (createdTask.list !== list) {
      setCreatedTask(null);
      return;
    }
    // Wait for the snapshot as well as the IPC reply before choosing a row.
    if (!data.tasks.some(task => task.id === createdTask.id)) return;
    const pane = rows.current;
    if (document.activeElement === quickAdd.current) {
      (pane?.querySelector<HTMLElement>('[data-keyboard-current]') || pane)?.focus();
    }
    setCreatedTask(null);
  }, [createdTask, data.tasks, list]);

  const update = (task: Task, change: Parameters<typeof api.updateTask>[1]) =>
    run(() => api.updateTask(task.id, change));
  const markReviewed = (task: Task) => {
    if (reviewPending.current) return;
    reviewPending.current = true;
    setMarkingReviewed(true);
    void run(async () => {
      try {
        await api.markTaskReviewed(task.id);
        notify('Marked reviewed · task stays open · ⌘Z to undo');
      } finally {
        reviewPending.current = false;
        setMarkingReviewed(false);
      }
    });
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || popover || document.querySelector('[role="dialog"], .ws-document-first')) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[role="separator"]')) return;
      if (event.key === 'Escape' && openId) {
        event.preventDefault(); returnToList(); return;
      }
      if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !target?.closest('.ws-sidebar')) {
        if (event.key.toLowerCase() === 'o') {
          const task = target?.closest('.ws-task-detail') ? open : current;
          if (!task) return;
          event.preventDefault();
          if (task.outputDir) void run(() => api.openTaskOutput(task.id));
          else {
            const link = data.taskLinks.find(item => item.taskId === task.id);
            if (link) void run(() => api.openTaskLink(link.id));
            else notify('This task has no output or attachment yet');
          }
          return;
        }
        if (event.key.toLowerCase() === 'l' && !isTyping(event) && current && !target?.closest('.ws-task-detail')) {
          event.preventDefault(); setLabelsTaskId(current.id); return;
        }
      }
      if (isTyping(event)) return;
      if (
        event.metaKey && event.key.toLowerCase() === 'v' && current &&
        !event.altKey && !event.ctrlKey &&
        !target?.closest('.ws-sidebar, .ws-task-detail')
      ) {
        event.preventDefault();
        void run(async () => {
          const value = await api.readClipboardText();
          if (!value.trim()) {
            notify('Clipboard has no link or file path to attach');
            return;
          }
          await api.addTaskLink(current.id, value);
          notify('Attachment updated · ⌘Z to undo');
        });
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (target?.closest('.ws-sidebar')) return;
      if (data.showTaskPriorities !== false && current && ['0', '1', '2', '3'].includes(event.key)) {
        event.preventDefault(); void update(current, { priority: event.key === '0' ? null : Number(event.key) as 1 | 2 | 3 }); return;
      }
      if (current && event.key === 's' && ['ready', 'review', 'blocked'].includes(current.status)) { event.preventDefault(); setSnoozeTaskId(current.id); return; }
      if (current && event.key === 'f') { event.preventDefault(); setFullscreen(value => !value); return; }
      if (target?.closest('.ws-task-detail')) return;
      const key = event.key;
      if (key === 'Escape') returnToList();
      else if (!current) return;
      else if (key === 'Enter') {
        setEditTarget('title');
      } else if (key === 'n') {
        setEditTarget('notes');
      }
      else if (key === ' ')
        void update(current, { status: current.status === 'done' ? 'ready' : 'done' });
      else if (key === 'a') {
        if (current.threadId) setEditTarget('chat');
        else if (current.status !== 'running' && current.status !== 'done') setPopover({ kind: 'handoff', taskId: current.id });
      }
      else if (key === 'A') {
        const thread = data.threads.find(item => item.id === current.threadId);
        if (thread && data.groups.some(group => group.id === thread.groupId)) onOpenThread(thread.groupId, thread.id);
        else notify('This task has no conversation yet');
      }
      else if (key === 'm') setMoveTaskId(current.id);
      else if (key === 'b') setLabelsTaskId(current.id);
      else if (key === 'B') void update(current, { labels: [] });
      else if (key === 'd') setPopover({ kind: 'due', taskId: current.id });
      else if (key === 'D') void update(current, { dueAt: null });
      else if (key === 'y' && current.status === 'proposed')
        void update(current, { status: 'ready' });
      else if (key === 'Backspace' || key === 'Delete') {
        if (current.status === 'proposed') void update(current, { status: 'dismissed' });
        else if (current.status === 'running') notify('Stop this task before deleting it');
        else void run(async () => {
          await api.deleteTask(current.id);
          if (openId === current.id) returnToList();
          notify('Task deleted · ⌘Z to undo');
        });
      }
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const add = () => {
    let parsed: ReturnType<typeof parseQuickAdd>;
    try { parsed = parseQuickAdd(draft); } catch (e) { notify((e as Error).message); return; }
    if (!parsed.title || adding.current) return;
    adding.current = true;
    void run(async () => {
      try {
        const task = await api.createTask({ ...parsed, listId });
        setDraft('');
        setEditTarget(null);
        setCursor(task.id);
        setCreatedTask({ id: task.id, list });
      } finally {
        adding.current = false;
      }
    });
  };
  useCommands('tasks', () => {
    if (!current) return { commands: [] };
    const task = current;
    const commands: Command[] = [
      { id: 'task.title', title: 'Edit task title', section: 'task', keys: '↵', run: () => setEditTarget('title') },
      { id: 'task.notes', title: 'Edit task notes', section: 'task', keys: 'N', run: () => setEditTarget('notes') },
      { id: 'task.complete', title: task.status === 'done' ? 'Reopen task' : 'Mark task done', section: 'task', keys: 'Space', run: () => void update(task, { status: task.status === 'done' ? 'ready' : 'done' }) },
      { id: 'task.move', title: 'Move task to list…', section: 'task', keys: 'M', run: () => setMoveTaskId(task.id) },
      { id: 'task.label', title: 'Set task labels…', section: 'task', keys: 'B', run: () => setLabelsTaskId(task.id) },
      { id: 'task.due', title: 'Set due date…', section: 'task', keys: 'D', run: () => setPopover({ kind: 'due', taskId: task.id }) },
    ];
    if (canMarkTaskReviewed(task) && !markingReviewed) commands.push({ id: 'task.reviewed', title: 'Mark reviewed', icon: CheckCheck, keywords: ['clear needs you', 'acknowledge', 'attention'], subtitle: 'Clear Needs you and keep this task open', section: 'task', run: () => markReviewed(task) });
    if (!['done', 'dismissed'].includes(task.status)) commands.push({ id: 'task.today', title: 'Set deadline to today', section: 'task', run: () => void update(task, { dueAt: isoDate(new Date()), snoozedUntil: null }) });
    commands.push({ id: 'task.fullscreen', title: fullscreen ? 'Exit fullscreen task' : 'Fullscreen task', section: 'task', keys: 'F', run: () => setFullscreen(value => !value) });
    if (data.showTaskPriorities !== false) {
      for (const priority of [1, 2, 3] as const) commands.push({ id: `task.priority.${priority}`, title: `Set priority P${priority}`, section: 'task', keys: String(priority), run: () => void update(task, { priority }) });
      if (task.priority) commands.push({ id: 'task.priority.clear', title: 'Clear task priority', section: 'task', keys: '0', run: () => void update(task, { priority: null }) });
    }
    if (['ready', 'review', 'blocked'].includes(task.status)) commands.push({ id: 'task.snooze', title: isTaskSnoozed(task) ? 'Change snooze…' : 'Snooze…', section: 'task', keys: 'S', run: () => setSnoozeTaskId(task.id) });
    if (taskLabels(task).length) commands.push({ id: 'task.unlabel', title: 'Remove all task labels', section: 'task', keys: '⇧ B', run: () => void update(task, { labels: [] }) });
    if (task.dueAt) commands.push({ id: 'task.undate', title: 'Remove due date', section: 'task', keys: '⇧ D', run: () => void update(task, { dueAt: null }) });
    if (task.status === 'proposed') commands.push(
      { id: 'task.accept', title: 'Accept suggestion', section: 'task', keys: 'Y', run: () => void update(task, { status: 'ready' }) },
      { id: 'task.dismiss', title: 'Dismiss suggestion', section: 'task', keys: '⌫', run: () => void update(task, { status: 'dismissed' }) },
    );
    else if (task.status !== 'running') commands.push({ id: 'task.delete', title: 'Delete task', section: 'task', keys: '⌫', run: () => void run(async () => { await api.deleteTask(task.id); notify('Task deleted · ⌘Z to undo'); }) });
    if (task.threadId) commands.push({ id: 'task.ask', title: 'Reply to agent', section: 'task', keys: 'A', run: () => setEditTarget('chat') });
    else if (task.status !== 'done' && task.status !== 'running') commands.push({ id: 'task.ask', title: 'Hand task to agent…', section: 'task', keys: 'A', run: () => setPopover({ kind: 'handoff', taskId: task.id }) });
    return { context: `Task: ${task.title}`, commands };
  });
  const count = order.length;
  const team = order.filter((task) => task.threadId).length;
  return (
    <div ref={detailWidth.container} className={`ws-tasks${resizing ? ' resizing' : ''}${fullscreen && open ? ' ws-task-fullscreen' : ''}`}
      style={{ '--ws-task-detail-width': `${detailWidth.width}px` } as CSSProperties}>
      {moveTask && <MoveTaskDialog key={`move-${moveTask.id}`} task={moveTask} lists={data.taskLists}
        onClose={() => setMoveTaskId(null)} onMoved={name => notify(`Moved to ${name} · ⌘Z to undo`)} />}
      <div className="ws-task-list-clip" onFocusCapture={() => {
        if (detailWidth.availableWidth - detailWidth.width < 280) detailWidth.resize(detailWidth.availableWidth - 281);
      }}><section className="ws-task-list" aria-label={title}>
        <header className="ws-page-head">
          <div>
            <h1>{title}</h1>
            <p>
              {count} task{count === 1 ? '' : 's'}
              {team ? ` · ${team} delegated` : ''}
            </p>
          </div>
          {customList && !savedView && <div className="ws-list-actions">
            <Button variant="ghost" size="sm" onClick={() => onManageList({ kind: 'rename', list: customList })}>Rename list</Button>
            <Button variant="ghost" size="sm" onClick={() => onManageList({ kind: 'delete', list: customList })}>Delete list</Button>
          </div>}
        </header>
        <TaskFilters key={list} list={list} tasks={data.tasks} lists={data.taskLists} value={filter} onChange={value => setFilters(previous => ({ ...previous, [list]: value }))} priorities={data.showTaskPriorities !== false}
          scope={scope} onScope={value => setScopes(previous => ({ ...previous, [list]: value }))} saved={savedView} views={data.taskViews ?? []} onOpen={id => onNavigate(`view:${id}`)} onDeleted={() => onNavigate('all')} />
        {scope !== 'completed' && (
          <form
            className="ws-quick-add"
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
          >
            <Button type="button" variant="ghost" size="sm" disabled={capturing || !draft.trim()} onClick={() => {
              if (adding.current) return;
              adding.current = true; setCapturing(true);
              const generation = captureGeneration.current;
              void run(async () => { try { const result = await api.captureTask(draft); if (generation === captureGeneration.current) setCapturePreview(result); } finally { adding.current = false; setCapturing(false); } });
            }}>{capturing ? 'Preparing…' : 'AI capture'}</Button>
            <Plus size={15} aria-hidden="true" />
            <input
              ref={quickAdd}
              data-quick-add
              data-task-view={list}
              aria-label="New task"
              placeholder="New task — try: Review inbox every day #work"
              disabled={capturing}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setCapturePreview(null);
                  setDraft('');
                  event.currentTarget.blur();
                }
              }}
            />
          </form>
        )}
        {capturePreview && <section className="ws-capture-preview" aria-label="Review captured task">
          <h2>Review captured task</h2>
          <label>Title<input disabled={capturing} value={capturePreview.title} onChange={e => setCapturePreview({ ...capturePreview, title: e.target.value })} /></label>
          <label>Notes<textarea disabled={capturing} value={capturePreview.notes} onChange={e => setCapturePreview({ ...capturePreview, notes: e.target.value })} /></label>
          <p>{taskLabels(capturePreview).map(label => `#${label} · `).join('')}{capturePreview.dueAt || 'No deadline'}{capturePreview.recurrence ? ` · ${capturePreview.recurrence}` : ''}</p>
          <Button variant="outline" size="sm" disabled={capturing || !capturePreview.title.trim()} onClick={() => {
            if (adding.current) return; adding.current = true; setCapturing(true);
            void run(async () => { try { const task = await api.createTask({ ...capturePreview, listId }); setCursor(task.id); setCreatedTask({ id: task.id, list }); setCapturePreview(null); setDraft(''); } finally { adding.current = false; setCapturing(false); } });
          }}>Add captured task</Button>
          <Button variant="ghost" size="sm" disabled={capturing} onClick={() => setCapturePreview(null)}>Cancel capture</Button>
        </section>}
        <div ref={rows} className="ws-rows" role="list" data-keyboard-pane="list" tabIndex={-1}>
          {groups.map(([name, tasks]) => (
            <div key={name} className="ws-row-group">
              <div className="ws-group-label">
                {name}
                <span>{tasks.length}</span>
              </div>
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  data={data}
                  hasAttachedLink={linkedTaskIds.has(task.id)}
                  selected={task.id === current?.id}
                  opened={task.id === openId}
                  onClick={() => {
                    setCursor(task.id);
                  }}
                  onFocus={() => {
                    setCursor(task.id);
                  }}
                  popover={popover?.taskId === task.id ? popover.kind : null}
                  onClosePopover={() => setPopover(null)}
                  run={run}
                />
              ))}
            </div>
          ))}
          {!order.length && (effectiveFilter.label || selectedLabels(effectiveFilter).length || effectiveFilter.status || effectiveFilter.priority ? <p className="ws-empty-line">No tasks match these filters.</p> : <Empty list={scope} />)}
        </div>
      </section></div>
      {open && <div className="ws-task-divider" role="separator" tabIndex={0}
        aria-label="Resize task details" aria-orientation="vertical" aria-controls="task-detail"
        aria-valuemin={detailWidth.min} aria-valuemax={detailWidth.max} aria-valuenow={detailWidth.width}
        aria-valuetext={`${detailWidth.width} pixels wide`}
        title="Drag to resize · Arrow keys to adjust · Double-click to reset"
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          resizeStart.current = { x: event.clientX, width: detailWidth.width };
          event.currentTarget.setPointerCapture(event.pointerId);
          setResizing(true);
        }}
        onPointerMove={event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId) || !resizeStart.current) return;
          detailWidth.resize(resizeStart.current.width + resizeStart.current.x - event.clientX);
        }}
        onPointerUp={event => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => { resizeStart.current = null; setResizing(false); }}
        onDoubleClick={detailWidth.reset}
        onKeyDown={event => {
          const step = event.shiftKey ? 50 : 10;
          if (event.key === 'ArrowLeft') detailWidth.resize(detailWidth.width + step);
          else if (event.key === 'ArrowRight') detailWidth.resize(detailWidth.width - step);
          else if (event.key === 'Home') detailWidth.resize(detailWidth.max);
          else if (event.key === 'End') detailWidth.resize(detailWidth.min);
          else if (event.key === 'Enter') detailWidth.reset();
          else return;
          event.preventDefault();
        }} />}
      {labelsTaskId && data.tasks.find(task => task.id === labelsTaskId) && <TaskLabelsDialog task={data.tasks.find(task => task.id === labelsTaskId)!} tasks={data.tasks} onClose={() => setLabelsTaskId(null)} />}
      {snoozeTaskId && data.tasks.find(task => task.id === snoozeTaskId) && <TaskSnoozeDialog task={data.tasks.find(task => task.id === snoozeTaskId)!} onClose={() => setSnoozeTaskId(null)} />}
      {open && (
        <div className="ws-task-detail-clip" onFocusCapture={event => {
          if (detailWidth.width < 340 && !event.currentTarget.querySelector('.document-open')) detailWidth.resize(340);
        }}>
          {!order.some(task => task.id === open.id) && <div className="ws-task-retained" role="status">This task is outside {title}. You can finish editing.<Button variant="ghost" size="sm" onClick={returnToList}>Back to list</Button></div>}
          <TaskDetail
          key={open.id}
          task={open}
          data={data}
          run={run}
          onOpenThread={onOpenThread}
          markingReviewed={markingReviewed}
          onMarkReviewed={() => markReviewed(open)}
          onLabels={() => setLabelsTaskId(open.id)}
          onSnooze={() => setSnoozeTaskId(open.id)}
          fullscreen={fullscreen}
          onToggleFullscreen={() => setFullscreen(value => !value)}
          onReturnToList={returnToList}
          onHandOff={() => setPopover({ kind: 'handoff', taskId: open.id })}
        /></div>
      )}
    </div>
  );
}

function Empty({ list }: { list: TaskView }) {
  const text = customListId(list) ? 'No tasks in this list yet. Add a task above or move one here from another view.' : {
    all: 'No open tasks. Add a task above.',
    inbox: 'Inbox is empty. Add a task above.',
    today: 'Nothing due today. Add a task above.',
    upcoming: 'Nothing scheduled yet. Add a due date with D or type “fri” in quick add.',
    team: 'Nothing delegated. Assign a person in task details, or press A to hand off to agents.',
    needs: 'All caught up. Suggestions and work ready for review show up here.',
    completed: 'No completed tasks yet.',
  }[list as BuiltInTaskView];
  return <p className="ws-empty-line">{text}</p>;
}

function TaskRow({
  task,
  data,
  hasAttachedLink,
  selected,
  opened,
  onClick,
  onFocus,
  popover,
  onClosePopover,
  run,
}: {
  task: Task;
  data: Snapshot;
  hasAttachedLink: boolean;
  selected: boolean;
  opened: boolean;
  onClick: () => void;
  onFocus: () => void;
  popover: 'handoff' | 'label' | 'due' | null;
  onClosePopover: () => void;
  run: Run;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const completing = useRef(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const authors =
    data.threads.find((thread) => thread.id === task.threadId)?.agentIds.slice(0, 3) || [];
  const state =
    task.status === 'running'
      ? 'working'
      : task.status === 'review'
        ? 'review'
        : task.status === 'blocked' && task.threadId
          ? 'blocked'
          : '';
  return (
    <div
      className={`ws-task-row ${selected ? 'selected' : ''} ${opened ? 'opened' : ''}`}
      ref={ref}
      role="listitem"
      tabIndex={selected ? 0 : -1}
      data-keyboard-item
      data-keyboard-current={selected ? '' : undefined}
      data-task-row
      data-feedback-context={`task-row:${task.id}`}
      aria-current={selected ? 'true' : undefined}
      onClick={onClick}
      onFocus={onFocus}
    >
      <Button
        type="button"
        variant="ghost"
        className="ws-task-complete"
        aria-label={`${task.status === 'done' ? 'Reopen' : 'Complete'} task: ${task.title}`}
        title={task.status === 'done' ? 'Reopen task' : 'Complete task'}
        disabled={saving}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
        }}
        onClick={event => {
          event.stopPropagation();
          if (completing.current) return;
          completing.current = true;
          setSaving(true);
          void run(() => api.updateTask(task.id, { status: task.status === 'done' ? 'ready' : 'done' }))
            .finally(() => { completing.current = false; setSaving(false); });
        }}
      >
        <TaskGlyph task={task} />
      </Button>
      <span className={`ws-task-title ${task.status === 'done' ? 'done' : ''}`}>{data.showTaskPriorities !== false && task.priority && <span className="ws-priority" aria-label={`Priority ${task.priority}`}>P{task.priority} </span>}{task.title}</span>
      {(task.sourceUrl || hasAttachedLink) && (
        <ExternalLink
          size={12}
          className="ws-muted-icon"
          aria-label={task.sourceUrl ? 'From a source' : 'Has attached links'}
        />
      )}
      {task.recurrence && <Repeat2 size={13} className="ws-muted-icon" aria-label={`Repeats ${taskRecurrenceLabels[task.recurrence].toLowerCase()}`} />}
      {taskLabels(task).length > 0 && <span className="ws-label" title={taskLabels(task).map(label => `#${label}`).join(', ')}>{taskLabels(task).map(label => `#${label}`).join(' · ')}</span>}
      {task.delegation && <span className="ws-person-label" title={`Assigned to ${task.delegation.assignee.name} · ${task.delegation.status}`}>@{task.delegation.assignee.name.split(' ')[0]} · {task.delegation.status}{task.delegation.error ? ' · Sync failed' : ''}</span>}
      {authors.length > 0 && (
        <span className="ws-agents">
          {authors.map((id) => (
            <Avatar key={id} agent={data.agents.find((agent) => agent.id === id)} size={18} />
          ))}
          {state && <span>{state}</span>}
        </span>
      )}
      {isTaskSnoozed(task) && <span className="ws-due">Snoozed until {task.snoozedUntil}</span>}
      <span
        className={`ws-due ${isOverdue(task.dueAt) && task.status !== 'done' ? 'overdue' : ''}`}
      >
        {dueLabel(task.dueAt)}
      </span>
      {popover && <TaskPopover kind={popover} task={task} onClose={onClosePopover} run={run} />}
    </div>
  );
}

function TaskPopover({
  kind,
  task,
  onClose,
  run,
}: {
  kind: 'handoff' | 'label' | 'due';
  task: Task;
  onClose: () => void;
  run: Run;
}) {
  const [value, setValue] = useState(
    kind === 'label' ? taskLabels(task).join(', ') : kind === 'due' ? task.dueAt || '' : '',
  );
  const [error, setError] = useState('');
  const cancelled = useRef(false);
  const submitted = useRef(false);
  const submit = () => {
    if (cancelled.current || submitted.current) return;
    if (kind === 'due') {
      const dueAt = value.trim() ? parseDue(value.trim(), new Date()) : null;
      if (value.trim() && !dueAt) {
        setError('Try “today”, “fri”, or YYYY-MM-DD.');
        return;
      }
      submitted.current = true;
      void run(() => api.updateTask(task.id, { dueAt }));
    } else if (kind === 'label') {
      submitted.current = true;
      let labels: string[]; try { labels = parseLabels(value); } catch (e) { setError((e as Error).message); submitted.current = false; return; }
      void run(() => api.updateTask(task.id, { labels }));
    } else {
      submitted.current = true;
      void run(() => api.handOff(task.id, value));
    }
    onClose();
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelled.current = true;
      onClose();
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };
  return (
    <div
      className={`ws-popover ${kind}`}
      role="dialog"
      aria-label={
        kind === 'handoff'
          ? 'Hand off to the team'
          : kind === 'label'
            ? 'Set label'
            : 'Set due date'
      }
      onClick={(event) => event.stopPropagation()}
    >
      {kind === 'handoff' ? (
        <>
          <div className="ws-popover-title">
            <Users size={13} aria-hidden="true" />
            HAND OFF TO THE TEAM
          </div>
          <textarea
            autoFocus
            rows={3}
            aria-label="Instruction"
            placeholder={`What should the team do? Leave empty to use “${task.title}”.`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="ws-popover-foot">
            <span className="grow">The team routes it · results saved as files</span>
            <button type="button" className="ws-btn primary" onClick={submit}>Hand off</button>
          </div>
        </>
      ) : (
        <>
          <input
            autoFocus
            aria-label={kind === 'label' ? 'Label' : 'Due date'}
            aria-invalid={!!error || undefined}
            placeholder={
              kind === 'label'
                ? 'label, e.g. growth — empty clears'
                : 'today, fri, 2026-10-02 — empty clears'
            }
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError('');
            }}
            onKeyDown={onKeyDown}
            onBlur={submit}
          />
          {error && (
            <span className="ws-field-error" role="alert">
              {error}
            </span>
          )}
        </>
      )}
    </div>
  );
}

function TaskDetail({
  markingReviewed, onMarkReviewed, onSnooze, onLabels,
  fullscreen, onToggleFullscreen,
  task,
  data,
  run,
  onReturnToList,
  onHandOff,
  onOpenThread,
}: {
  markingReviewed: boolean; onMarkReviewed: () => void; onSnooze: () => void; onLabels: () => void;
  fullscreen: boolean; onToggleFullscreen: () => void;
  task: Task;
  data: Snapshot;
  run: Run;
  onReturnToList: () => void;
  onHandOff: () => void;
  onOpenThread: (groupId: string, threadId: string) => void;
}) {
  const thread = data.threads.find((item) => item.id === task.threadId);
  const group = thread && data.groups.find((item) => item.id === thread.groupId);
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const cancelledTitle = useRef(false);
  const links = data.taskLinks.filter(link => link.taskId === task.id);
  const saveTitle = () => {
    if (cancelledTitle.current) { cancelledTitle.current = false; setTitle(task.title); return; }
    const next = title.trim();
    if (!next) {
      setTitle(task.title);
      return;
    }
    if (next !== task.title) void run(() => api.updateTask(task.id, { title: next }));
  };
  const threadLink = group && thread ? <Button variant="ghost" size="sm" className="ws-task-thread-link"
    aria-label={`Thread in ${group.kind === 'private' ? group.title : `#${group.title}`}`}
    title={`Open thread in ${group.title} (Shift+A)`}
    onClick={() => onOpenThread(group.id, thread.id)}>
    <span>{group.kind === 'private' ? group.title : `#${group.title}`}</span><ExternalLink size={14} aria-hidden="true" />
  </Button> : null;
  const fullscreenAction = <Button variant="ghost" size="sm" aria-label={fullscreen ? 'Exit fullscreen task' : 'Fullscreen task'} aria-pressed={fullscreen} onClick={onToggleFullscreen}>{fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</Button>;
  const taskProperties = <div className="ws-task-toolbar-properties">
    <Button variant="ghost" size="sm" aria-label="Edit task labels" onClick={onLabels}>{taskLabels(task).length ? taskLabels(task).map(label => `#${label}`).join(' · ') : 'Add labels'}</Button>
    {!['done', 'dismissed'].includes(task.status) && <Button variant="ghost" size="sm" aria-label="Set deadline to today" onClick={() => void run(() => api.updateTask(task.id, { dueAt: isoDate(new Date()), snoozedUntil: null }))}>Today</Button>}
    {data.showTaskPriorities !== false && <label className="ws-priority-control" title="Task priority"><Flag size={13} aria-hidden="true" /><select aria-label="Task priority" value={task.priority ?? ''} onChange={event => void run(() => api.updateTask(task.id, { priority: event.target.value ? Number(event.target.value) as 1 | 2 | 3 : null }))}><option value="">None</option><option value="1">P1</option><option value="2">P2</option><option value="3">P3</option></select></label>}
    {['ready', 'review', 'blocked'].includes(task.status) && <Button variant="ghost" size="sm" onClick={onSnooze}><AlarmClock size={14} aria-hidden="true" />{isTaskSnoozed(task) ? `Snoozed until ${task.snoozedUntil}` : 'Snooze'}</Button>}
    <TaskRepeat key={task.id} task={task} compact />
    {canMarkTaskReviewed(task) && <Button variant="ghost" size="sm" icon aria-label="Mark reviewed" title="Mark reviewed — clear Needs you and keep this task open" disabled={markingReviewed} onClick={onMarkReviewed}><CheckCheck size={15} aria-hidden="true" /></Button>}
    {task.status === 'running' && <button className="ws-btn" onClick={() => void run(() => api.stopTask(task.id))}><Square size={12} /> Stop</button>}
  </div>;
  const header = (
    <header className="ws-detail-head">
      {!(thread && group) && <div className="ws-task-plain-tools">{taskProperties}{fullscreenAction}</div>}
      <textarea
        rows={1}
        className="ws-task-title-input"
        aria-label="Task title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={saveTitle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur(); window.requestAnimationFrame(onReturnToList); }
          if (event.key === 'Escape') {
            event.preventDefault();
            cancelledTitle.current = true;
            setTitle(task.title);
            event.currentTarget.blur();
            onReturnToList();
          }
        }}
      />
      {(task.status !== 'review' || task.sourceUrl || links.length > 0) && <div className="ws-detail-meta">
        {task.status !== 'review' && <span className={`ws-status ${task.status}`}>{taskStatusText[task.status]}</span>}
        {task.sourceUrl && (
          <a
            href={task.sourceUrl}
            onClick={(event) => {
              event.preventDefault();
              void api.openExternal(task.sourceUrl!);
            }}
          >
            Source <ExternalLink size={11} />
          </a>
        )}
        {links.map(link => (
          <span className="ws-task-link" key={link.id}>
            <a href={link.url} title={link.url} onClick={event => { event.preventDefault(); void run(() => api.openTaskLink(link.id)); }}>
              {taskLinkLabel(link.url)} <ExternalLink size={11} />
            </a>
            <button type="button" aria-label={`Remove link ${link.url}`} title="Remove link" onClick={() => void run(() => api.removeTaskLink(link.id))}><X size={11} /></button>
          </span>
        ))}
      </div>}
      <TaskDelegation task={task} connected={data.connectors.some(c => c.id === 'notion' && c.status === 'connected')} />
      <details className="ws-task-notes-disclosure">
        <summary><ChevronRight size={13} aria-hidden="true" /><span>Notes</span><span className="ws-task-notes-preview">{notes.trim() || 'Add context…'}</span></summary>
      <label className="ws-field ws-task-notes">
        <span className="ws-copy-announcement">Notes</span>
        <textarea
          aria-label="Task notes"
          rows={3}
          placeholder="Add context for this task"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => {
            if (notes !== task.notes) void run(() => api.updateTask(task.id, { notes }));
          }}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.currentTarget.blur();
              onReturnToList();
            }
          }}
        />
      </label>
      </details>
    </header>
  );
  return (
    <aside id="task-detail" className="ws-task-detail" aria-label="Task detail" data-keyboard-pane="detail" data-feedback-context={`task-detail:${task.id}`} tabIndex={-1}>
      {thread && group ? (
        <ThreadView
          key={thread.id}
          data={data}
          thread={thread}
          group={group}
          run={run}
          header={header}
          leadingActions={<>{threadLink}{taskProperties}</>}
          trailingActions={fullscreenAction}
          compact
        />
      ) : (
        <TaskDocuments key={task.id} task={task} brainFilingEnabled={data.brainBridge?.filingEnabled}>
          {header}
          <div className="ws-row-actions">
            {task.status === 'proposed' ? (
              <>
                <button
                  className="ws-btn primary"
                  onClick={() => void run(() => api.updateTask(task.id, { status: 'ready' }))}
                >
                  Accept
                </button>
                <button
                  className="ws-btn"
                  onClick={() => void run(() => api.updateTask(task.id, { status: 'dismissed' }))}
                >
                  Dismiss
                </button>
              </>
            ) : (
              <>
                {task.status !== 'done' && (
                  <button className="ws-btn primary" onClick={onHandOff}>
                    <Users size={13} /> Hand off to the team
                  </button>
                )}

              </>
            )}
          </div>
        </TaskDocuments>
      )}
    </aside>
  );
}
