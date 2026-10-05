import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AlarmClock, CalendarDays, Check, ChevronRight, ExternalLink, Maximize2, Minimize2, Plus, RotateCcw, Sparkles, Square, X } from 'lucide-react';
import type { Snapshot, Task } from '../../../shared/types';
import { taskLinkLabel } from '../../../shared/task-links';
import { isoDate, parseDue, parseQuickAdd, parseWhen, taskCursor, tasksFor, type TaskView } from '../../../shared/tasks';
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
import { dateCommands, taskCommands, type TaskActions } from './taskCommands';
import { Button } from '../design-system/primitives';
import { openCommandPalette, useCommands } from '../commands';

const titles: Record<TaskView, string> = {
  inbox: 'Inbox',
  today: 'Today',
  upcoming: 'Upcoming',
  team: 'Delegated',
  needs: 'Needs you',
  completed: 'Completed',
};
type Popover = { kind: 'handoff' | 'label' | 'due' | 'snooze'; taskId: string } | null;
const rank: Record<Task['status'], number> = {
  review: 0,
  blocked: 1,
  proposed: 2,
  running: 3,
  ready: 4,
  done: 5,
  dismissed: 6,
};

// The agent that takes hand-offs: the lead of the default group (Claude on the Claude Code engine).
export function leadName(data: Snapshot) {
  return data.agents.find((agent) => agent.role.trim().toLowerCase() === 'lead')?.name || 'the agent';
}

function groupTasks(list: TaskView, tasks: Task[]) {
  if (list === 'completed') return tasks.length ? [['Completed', tasks] as [string, Task[]]] : [];
  const sorted = [...tasks].sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (a.dueAt || '9999').localeCompare(b.dueAt || '9999') ||
      a.createdAt.localeCompare(b.createdAt),
  );
  const groups = new Map<string, Task[]>();
  const today = isoDate(new Date());
  for (const task of sorted) {
    const key =
      list === 'needs' ? taskStatusText[task.status]
        : list === 'inbox' && task.status === 'proposed' ? 'Suggested'
          : list === 'today' && task.dueAt && task.dueAt < today ? 'Overdue'
          : task.label ? `#${task.label}` : 'No label';
    groups.set(key, [...(groups.get(key) || []), task]);
  }
  return [...groups].sort(([a], [b]) =>
    list === 'needs' ? 0 : a === 'Overdue' || a === 'Suggested' ? -1 : b === 'Overdue' || b === 'Suggested' ? 1 : a === 'No label' ? 1 : b === 'No label' ? -1 : a.localeCompare(b),
  );
}

export function TasksView({
  data,
  run,
  list,
  notify,
  onOpenThread,
}: {
  data: Snapshot;
  run: Run;
  list: TaskView;
  notify: (message: string) => void;
  onOpenThread: (groupId: string, threadId: string) => void;
}) {
  const [cursors, setCursors] = useState<Partial<Record<TaskView, string>>>({});
  const [editTarget, setEditTarget] = useState<'title' | 'notes' | 'chat' | null>(null);
  const [popover, setPopover] = useState<Popover>(null);
  const [draft, setDraft] = useState('');
  // Full screen: one task fills the window. Panel width: dragged by the user, kept between launches.
  const [focus, setFocus] = useState(false);
  const [detailWidth, setDetailWidth] = useState(() => {
    try { return Number(localStorage.getItem('legolas.detailWidth')) || 440; } catch { return 440; }
  });
  const clampWidth = (width: number) => Math.round(Math.max(360, Math.min(width, window.innerWidth - 560)));
  const saveWidth = (width: number) => {
    setDetailWidth(width);
    try { localStorage.setItem('legolas.detailWidth', String(width)); } catch { /* the width just isn't remembered */ }
  };
  const quickAdd = useRef<HTMLInputElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  const adding = useRef(false);
  const [createdTask, setCreatedTask] = useState<{ id: string; list: TaskView } | null>(null);
  const groups = useMemo(() => groupTasks(list, tasksFor(list, data.tasks)), [list, data.tasks]);
  const linkedTaskIds = useMemo(() => new Set(data.taskLinks.map(link => link.taskId)), [data.taskLinks]);
  const order = groups.flatMap(([, tasks]) => tasks);
  const previousLists = useRef<Partial<Record<TaskView, { order: string[]; selected?: string }>>>({});
  const previousList = previousLists.current[list];
  const selectedId = cursors[list] ?? previousList?.selected;
  const currentId = taskCursor(order.map(task => task.id), previousList?.order ?? [], selectedId);
  const current = order.find(task => task.id === currentId);
  useLayoutEffect(() => {
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
  const modalTask = popover && popover.kind !== 'label' ? data.tasks.find((item) => item.id === popover.taskId) : undefined;
  const closePopover = () => {
    setPopover(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.ws-rows [data-keyboard-current]')?.focus());
  };
  const open = current;
  const openId = open?.id;
  const focused = focus && !!open;
  useEffect(() => {
    document.body.classList.toggle('ws-focus-mode', focused);
    return () => document.body.classList.remove('ws-focus-mode');
  }, [focused]);
  const returnToList = () => {
    window.requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('.ws-rows [data-keyboard-current]')?.focus(),
    );
  };
  useEffect(() => {
    setPopover(null);
  }, [list]);
  useEffect(() => {
    if (!editTarget || !openId) return;
    const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      editTarget === 'chat'
        ? '.ws-task-detail [aria-label="Message"]'
        : editTarget === 'title'
        ? '.ws-task-detail [aria-label="Task title"]'
        : '.ws-task-detail [aria-label="Task context"]',
    );
    // N opens a folded context field before editing it.
    field?.closest('details')?.setAttribute('open', '');
    field?.focus();
    if (editTarget === 'title' && field) field.select();
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
  // Shared by the keys below and the command palette.
  const openOutput = (task: Task) => {
    if (task.outputDir) void run(() => api.openTaskOutput(task.id));
    else {
      const link = data.taskLinks.find(item => item.taskId === task.id);
      if (link) void run(() => api.openTaskLink(link.id));
      else notify('This task has no output or attachment yet');
    }
  };
  const attachClipboard = (task: Task) => void run(async () => {
    const value = await api.readClipboardText();
    if (!value.trim()) {
      notify('Clipboard has no link or file path to attach');
      return;
    }
    await api.addTaskLink(task.id, value);
    notify('Attachment updated · ⌘Z to undo');
  });
  const openConversation = (task: Task) => {
    const thread = data.threads.find(item => item.id === task.threadId);
    if (thread && data.groups.some(group => group.id === thread.groupId)) onOpenThread(thread.groupId, thread.id);
    else notify('This task has no conversation yet');
  };
  const removeTask = (task: Task) => {
    if (task.status === 'proposed') void update(task, { status: 'dismissed' });
    else if (task.status === 'running') notify('Stop this task before deleting it');
    else void run(async () => {
      await api.deleteTask(task.id);
      if (openId === task.id) returnToList();
      notify('Task deleted · ⌘Z to undo');
    });
  };
  useCommands('tasks', () => {
    if (!current) return { commands: [] };
    const actions: TaskActions = {
      data,
      agent: leadName(data),
      focused,
      update: (change) => void update(current, change),
      openBox: (kind) => setPopover({ kind, taskId: current.id }),
      edit: setEditTarget,
      toggleFocus: () => setFocus((value) => !value),
      openOutput: () => openOutput(current),
      attachClipboard: () => attachClipboard(current),
      openConversation: () => openConversation(current),
      dismiss: () => void run(async () => {
        await api.updateTask(current.id, { status: 'dismissed' });
        notify('Dismissed · ⌘Z to undo');
      }),
      stop: () => void run(() => api.stopTask(current.id)),
      remove: () => removeTask(current),
    };
    return { context: `Task: ${current.title}`, commands: taskCommands(current, actions), forQuery: (query) => dateCommands(query, actions) };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || popover || document.querySelector('[role="dialog"]')) return;
      const target = event.target instanceof Element ? event.target : null;
      if (event.key === 'Escape' && focused) {
        event.preventDefault(); setFocus(false); return;
      }
      if (event.key === 'Escape' && openId) {
        event.preventDefault(); returnToList(); return;
      }
      if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !target?.closest('.ws-sidebar')) {
        if (event.key.toLowerCase() === 'o') {
          const task = target?.closest('.ws-task-detail') ? open : current;
          if (!task) return;
          event.preventDefault();
          openOutput(task);
          return;
        }
        if (event.key.toLowerCase() === 'l' && !isTyping(event) && current && !target?.closest('.ws-task-detail')) {
          // One label picker for the key and the palette: ⌘L opens the palette at Set label.
          event.preventDefault(); openCommandPalette('task.label'); return;
        }
      }
      if (isTyping(event)) return;
      if (
        event.metaKey && event.key.toLowerCase() === 'v' && current &&
        !event.altKey && !event.ctrlKey &&
        !target?.closest('.ws-sidebar, .ws-task-detail')
      ) {
        event.preventDefault();
        attachClipboard(current);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (target?.closest('.ws-sidebar, .ws-task-detail')) return;
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
      else if (key === 'A') openConversation(current);
      else if (key === 'f') setFocus((value) => !value);
      else if (key === 'b') openCommandPalette('task.label');
      else if (key === 'B') void update(current, { label: null });
      else if (key === 'd') setPopover({ kind: 'due', taskId: current.id });
      else if (key === 'D') void update(current, { dueAt: null });
      else if (key === 's' && current.status === 'ready') setPopover({ kind: 'snooze', taskId: current.id });
      else if (key === 'y' && current.status === 'proposed')
        void update(current, { status: 'ready' });
      else if (key === 'Backspace' || key === 'Delete') removeTask(current);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const add = () => {
    const quick = parseQuickAdd(draft);
    if (!quick.title || adding.current) return;
    // Adding from Today means today; elsewhere an undated task goes to the Inbox.
    const parsed = list === 'today' && !quick.dueAt ? { ...quick, dueAt: isoDate(new Date()) } : quick;
    adding.current = true;
    void run(async () => {
      try {
        const task = await api.createTask(parsed);
        if (!tasksFor(list, [task]).length) notify(`Added to ${tasksFor('inbox', [task]).length ? 'Inbox' : 'Upcoming'}`);
        setDraft('');
        setEditTarget(null);
        setCursor(task.id);
        setCreatedTask({ id: task.id, list });
      } finally {
        adding.current = false;
      }
    });
  };
  const count = order.length;
  const team = order.filter((task) => task.threadId).length;
  return (
    <div className={`ws-tasks ${focused ? 'ws-tasks-focus' : ''}`}>
      <section className="ws-task-list" aria-label={titles[list]}>
        <header className="ws-page-head">
          <div>
            <h1>{titles[list]}</h1>
            <p>
              {count} task{count === 1 ? '' : 's'}
              {team ? ` · ${team} delegated` : ''}
            </p>
          </div>
        </header>
        {list !== 'completed' && (
          <form
            className="ws-quick-add"
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
          >
            <Plus size={15} aria-hidden="true" />
            <input
              ref={quickAdd}
              data-quick-add
              aria-label="New task"
              placeholder="New task — try: Summarise calls #customers fri"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setDraft('');
                  event.currentTarget.blur();
                }
              }}
            />
          </form>
        )}
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
                  showLabel={list === 'needs' || name === 'Overdue'}
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
          {!order.length && <Empty list={list} />}
        </div>
      </section>
      {open && !focused && (
        <div className="ws-detail-resizer" role="separator" tabIndex={0} aria-label="Resize task panel" aria-orientation="vertical"
          aria-valuemin={360} aria-valuemax={Math.max(360, window.innerWidth - 560)} aria-valuenow={detailWidth}
          title="Drag to resize · double-click to reset"
          onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            setDetailWidth(clampWidth(event.currentTarget.parentElement!.getBoundingClientRect().right - event.clientX));
          }}
          onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId); saveWidth(detailWidth); }}
          onDoubleClick={() => saveWidth(440)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            event.stopPropagation();
            saveWidth(clampWidth(detailWidth + (event.key === 'ArrowLeft' ? 32 : -32)));
          }} />
      )}
      {open && (
        <TaskDetail
          key={open.id}
          task={open}
          data={data}
          run={run}
          width={focused ? undefined : clampWidth(detailWidth)}
          focused={focused}
          onToggleFocus={() => setFocus((value) => !value)}
          notify={notify}
          onOpenThread={onOpenThread}
          onReturnToList={() =>
            document.querySelector<HTMLElement>('.ws-rows [data-keyboard-current]')?.focus()
          }
          onHandOff={() => setPopover({ kind: 'handoff', taskId: open.id })}
          onSnooze={() => setPopover({ kind: 'snooze', taskId: open.id })}
          onSetDue={() => setPopover({ kind: 'due', taskId: open.id })}
        />
      )}
      {modalTask && popover && popover.kind !== 'label' && (
        <Modal onClose={closePopover}>
          {popover.kind === 'handoff'
            ? <TaskPopover kind="handoff" task={modalTask} agent={leadName(data)} onClose={closePopover} run={run} />
            : <WhenPicker kind={popover.kind} task={modalTask} onClose={closePopover} run={run} />}
        </Modal>
      )}
    </div>
  );
}

function Empty({ list }: { list: TaskView }) {
  const text = {
    today: 'Nothing due today. Give a task a date to see it here.',
    upcoming: 'Nothing scheduled yet. Add a due date with D or type “fri” in quick add.',
    inbox: 'Inbox zero. Undated tasks and phone captures land here.',
    team: 'The agent has nothing right now. Press A on a task to give it one.',
    needs: 'All caught up. Suggestions and work ready for review show up here.',
    completed: 'No completed tasks yet.',
  }[list];
  return <p className="ws-empty-line">{text}</p>;
}

function TaskRow({
  task,
  data,
  showLabel,
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
  showLabel: boolean;
  hasAttachedLink: boolean;
  selected: boolean;
  opened: boolean;
  onClick: () => void;
  onFocus: () => void;
  popover: 'handoff' | 'label' | 'due' | 'snooze' | null;
  onClosePopover: () => void;
  run: Run;
}) {
  const ref = useRef<HTMLDivElement>(null);
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
      aria-current={selected ? 'true' : undefined}
      onClick={onClick}
      onFocus={onFocus}
    >
      {task.status === 'ready' || task.status === 'done' ? (
        <button type="button" className="ws-glyph-button" aria-label={task.status === 'done' ? 'Mark not done' : 'Mark done'}
          title={task.status === 'done' ? 'Mark not done (Space)' : 'Mark done (Space)'}
          onClick={(event) => { event.stopPropagation(); void run(() => api.updateTask(task.id, { status: task.status === 'done' ? 'ready' : 'done' })); }}>
          <TaskGlyph task={task} />
        </button>
      ) : <TaskGlyph task={task} />}
      <span className={`ws-task-title ${task.status === 'done' ? 'done' : ''}`}>{task.title}</span>
      {(task.sourceUrl || hasAttachedLink) && (
        <ExternalLink
          size={12}
          className="ws-muted-icon"
          aria-label={task.sourceUrl ? 'From a source' : 'Has attached links'}
        />
      )}
      {showLabel && task.label && <span className="ws-label">#{task.label}</span>}
      {authors.length > 0 && (
        <span className="ws-agents">
          {authors.map((id) => (
            <Avatar key={id} agent={data.agents.find((agent) => agent.id === id)} size={18} />
          ))}
          {state && <span>{state}</span>}
        </span>
      )}
      <span
        className={`ws-due ${isOverdue(task.dueAt) && task.status !== 'done' ? 'overdue' : ''}`}
      >
        {dueLabel(task.dueAt)}
      </span>
      {popover === 'label' && <TaskPopover kind="label" task={task} agent={leadName(data)} onClose={onClosePopover} run={run} />}
    </div>
  );
}

const shortDate = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', ...(year !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });
};
function whenText(iso: string, today: Date) {
  const [year, month, day] = iso.split('-').map(Number);
  const days = Math.round((new Date(year, month - 1, day).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000);
  const relative = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days === -1 ? 'yesterday' : days > 0 ? `in ${days} days` : `${-days} days ago`;
  return `${shortDate(iso)} · ${relative}`;
}

// Centred on top of everything, so neither the list nor the task panel can cover it.
function Modal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return createPortal(
    <div className="ws-modal-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
      <div className="ws-modal">{children}</div>
    </div>,
    document.body,
  );
}

const quickDates: Array<[string, string]> = [['Tomorrow', 'tomorrow'], ['This weekend', 'weekend'], ['Next week', 'next week'], ['Next month', 'next month']];

// Snooze and the due date share one box: type a phrase (3 days, 2 weeks, fri, 20 oct) or pick a quick date.
function WhenPicker({ kind, task, onClose, run }: { kind: 'due' | 'snooze'; task: Task; onClose: () => void; run: Run }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const today = new Date();
  const typed = value.trim();
  const parsed = typed ? parseWhen(typed, today) : null;
  const save = (dueAt: string | null) => { void run(() => api.updateTask(task.id, { dueAt })); onClose(); };
  const submit = () => {
    if (parsed) save(parsed);
    else setError('Try “3 days”, “2 weeks”, “fri”, “next month” or “20 oct”.');
  };
  return (
    <div className="ws-popover ws-popover-when" role="dialog" aria-label={kind === 'snooze' ? 'Snooze' : 'Set due date'}>
      <div className="ws-popover-title">
        {kind === 'snooze' ? <AlarmClock size={13} aria-hidden="true" /> : <CalendarDays size={13} aria-hidden="true" />}
        {kind === 'snooze' ? 'SNOOZE UNTIL' : 'DUE DATE'}
      </div>
      <input autoFocus aria-label="When" aria-invalid={!!error || undefined} value={value}
        placeholder="tomorrow, fri, 3 days, 2 weeks, 1 month, 20 oct"
        onChange={(event) => { setValue(event.target.value); setError(''); }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') { event.preventDefault(); onClose(); }
          if (event.key === 'Enter') { event.preventDefault(); submit(); }
        }} />
      <p className={error ? 'ws-field-error' : 'ws-when-preview'} role={error ? 'alert' : undefined}>
        {error || (parsed ? whenText(parsed, today) : typed ? 'Keep typing…' : task.dueAt ? `Due now: ${whenText(task.dueAt, today)}` : 'No date yet.')}
      </p>
      <div className="ws-when-quick">
        {quickDates.map(([label, phrase]) => {
          const date = parseWhen(phrase, today) as string;
          return <button key={phrase} type="button" className="ws-btn" onClick={() => save(date)}>{label}<span>{shortDate(date)}</span></button>;
        })}
      </div>
      <div className="ws-popover-foot">
        <span className="grow">Enter saves · Esc cancels</span>
        {kind === 'due' && task.dueAt && <button type="button" className="ws-btn" onClick={() => save(null)}>Clear date</button>}
        <button type="button" className="ws-btn primary" disabled={!parsed} onClick={submit}>{kind === 'snooze' ? 'Snooze' : 'Save'}</button>
      </div>
    </div>
  );
}

function TaskPopover({
  kind,
  task,
  agent,
  onClose,
  run,
}: {
  kind: 'handoff' | 'label' | 'due';
  task: Task;
  agent: string;
  onClose: () => void;
  run: Run;
}) {
  const [value, setValue] = useState(
    kind === 'label' ? task.label || '' : kind === 'due' ? task.dueAt || '' : '',
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
      void run(() => api.updateTask(task.id, { label: value.replace(/^#/, '').trim().toLowerCase() || null }));
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
      className={`ws-popover ws-popover-${kind}`}
      role="dialog"
      aria-label={
        kind === 'handoff'
          ? `Ask ${agent}`
          : kind === 'label'
            ? 'Set label'
            : 'Set due date'
      }
      onClick={(event) => event.stopPropagation()}
    >
      {kind === 'handoff' ? (
        <>
          <div className="ws-popover-title">
            <Sparkles size={13} aria-hidden="true" />
            ASK {agent.toUpperCase()}
          </div>
          <textarea
            autoFocus
            rows={3}
            aria-label="Instruction"
            placeholder={`What should ${agent} do? Leave empty and ${agent} works from the title and context.`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="ws-popover-foot">
            <span className="grow">{agent} starts now. The answer comes back here for your review.</span>
            <button type="button" className="ws-btn primary" onClick={submit}>Start</button>
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
  task,
  data,
  run,
  width,
  focused,
  onToggleFocus,
  notify,
  onSnooze,
  onSetDue,
  onReturnToList,
  onHandOff,
  onOpenThread,
}: {
  task: Task;
  data: Snapshot;
  run: Run;
  width?: number;
  focused: boolean;
  onToggleFocus: () => void;
  notify: (message: string) => void;
  onSnooze: () => void;
  onSetDue: () => void;
  onReturnToList: () => void;
  onHandOff: () => void;
  onOpenThread: (groupId: string, threadId: string) => void;
}) {
  const thread = data.threads.find((item) => item.id === task.threadId);
  const group = thread && data.groups.find((item) => item.id === thread.groupId);
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [label, setLabel] = useState(task.label || '');
  // Context folds away once there is a conversation, so the conversation gets the room.
  const [contextOpen, setContextOpen] = useState(!thread);
  const contextPreview = notes.split('\n').map((line) => line.replace(/^[#>*\-\s_]+/, '').trim()).find(Boolean) || '';
  const cancelledTitle = useRef(false);
  const cancelledLabel = useRef(false);
  useEffect(() => setLabel(task.label || ''), [task.label]);
  const labels = useMemo(() => [...new Set(data.tasks.map((item) => item.label).filter((value): value is string => !!value))].sort(), [data.tasks]);
  const agent = leadName(data);
  const setStatus = (status: Task['status']) => void run(() => api.updateTask(task.id, { status }));
  const dismiss = () => void run(async () => {
    await api.updateTask(task.id, { status: 'dismissed' });
    notify('Dismissed · ⌘Z to undo');
  });
  const saveLabel = () => {
    if (cancelledLabel.current) { cancelledLabel.current = false; setLabel(task.label || ''); return; }
    const next = label.replace(/^#/, '').trim().toLowerCase() || null;
    if (next !== task.label) void run(() => api.updateTask(task.id, { label: next }));
  };
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
  const header = (
    <header className="ws-detail-head">
      <div className="ws-detail-top">
        {group && thread ? <Button variant="ghost" size="sm" className="ws-task-thread-link"
          title="Open conversation in channel (Shift+A)"
          onClick={() => onOpenThread(group.id, thread.id)}>
          <span>Thread in {group.kind === 'private' ? group.title : `#${group.title}`}</span><ExternalLink size={12} />
        </Button> : task.sourceUrl && <span className="ws-crumb">From a source</span>}
        {task.status === 'running' && (
          <button className="ws-btn" onClick={() => void run(() => api.stopTask(task.id))}>
            <Square size={12} /> Stop
          </button>
        )}
        <button type="button" className="ws-btn ws-focus-toggle" onClick={onToggleFocus}
          title={focused ? 'Exit full screen (F or Esc)' : 'Full screen (F)'} aria-pressed={focused}>
          {focused ? <><Minimize2 size={12} /> Exit full screen</> : <><Maximize2 size={12} /> Full screen</>}
        </button>
      </div>
      <textarea
        rows={1}
        className="ws-task-title-input"
        aria-label="Task title"
        value={title}
        onChange={(event) => setTitle(event.target.value.replace(/\n/g, ' '))}
        onBlur={saveTitle}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); window.requestAnimationFrame(onReturnToList); }
          if (event.key === 'Escape') {
            event.preventDefault();
            cancelledTitle.current = true;
            setTitle(task.title);
            event.currentTarget.blur();
            onReturnToList();
          }
        }}
      />
      <div className="ws-detail-meta">
        <span className={`ws-status ${task.status}`}>{taskStatusText[task.status]}</span>
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
      </div>
      {task.status === 'review' && (
        <p className="ws-detail-hint">{agent} has finished. Its answer is the last message below; files are in the task folder (⌘O). Mark done, or reply to ask for changes.</p>
      )}
      {task.status === 'blocked' && (
        <p className="ws-detail-hint">{agent} stopped before finishing. Reply below to have it carry on.</p>
      )}
      {/* What you can do with this task, by status. Running tasks have Stop in the top row. */}
      <div className="ws-detail-actions">
        {task.status === 'proposed' && (
          <button type="button" className="ws-btn primary" onClick={() => setStatus('ready')}><Check size={13} /> Accept</button>
        )}
        {(task.status === 'ready' || task.status === 'review' || task.status === 'blocked') && (
          <button type="button" className="ws-btn primary" onClick={() => setStatus('done')}><Check size={13} /> Mark done</button>
        )}
        {task.status === 'ready' && (
          <button type="button" className="ws-btn" onClick={onSnooze} title="Move it to a later date (S)"><AlarmClock size={13} /> Snooze</button>
        )}
        {(task.status === 'ready' || task.status === 'proposed') && !thread && (
          <button type="button" className="ws-btn" onClick={onHandOff} title={`${agent} starts working on it now`}>
            <Sparkles size={13} /> Ask {agent}
          </button>
        )}
        {task.status !== 'done' && task.status !== 'dismissed' && task.status !== 'running' && (
          <button type="button" className="ws-btn" onClick={dismiss} title="Take it off your lists without marking it done (⌘Z to undo)">
            <X size={13} /> Dismiss
          </button>
        )}
        {(task.status === 'done' || task.status === 'dismissed') && (
          <button type="button" className="ws-btn" onClick={() => setStatus('ready')}><RotateCcw size={13} /> {task.status === 'done' ? 'Reopen' : 'Restore'}</button>
        )}
      </div>
      <div className="ws-detail-controls">
        <div className="ws-inline-field">
          <span>Due</span>
          <button type="button" className={`ws-due-button ${task.dueAt && task.dueAt < isoDate(new Date()) ? 'overdue' : ''}`}
            onClick={onSetDue} title="Set the due date (D)">
            {task.dueAt ? shortDate(task.dueAt) : 'No date'}
          </button>
          {task.dueAt && (
            <button type="button" aria-label="Clear due date" title="Clear due date"
              onClick={() => void run(() => api.updateTask(task.id, { dueAt: null }))}><X size={11} /></button>
          )}
        </div>
        <label className="ws-inline-field">
          <span>Label</span>
          <input aria-label="Label" list="ws-label-options" placeholder="none" value={label}
            onChange={(event) => setLabel(event.target.value)}
            onBlur={saveLabel}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
              if (event.key === 'Escape') { event.preventDefault(); cancelledLabel.current = true; event.currentTarget.blur(); onReturnToList(); }
            }} />
          <datalist id="ws-label-options">{labels.map((value) => <option key={value} value={value} />)}</datalist>
        </label>
      </div>
      <details className="ws-context" open={contextOpen} onToggle={(event) => setContextOpen(event.currentTarget.open)}>
        <summary>
          <ChevronRight size={13} aria-hidden="true" />
          <span>Context</span>
          {!contextOpen && <small>{contextPreview || 'Add context'}</small>}
        </summary>
        <p className="ws-context-help">What {agent} reads about this task every time it works on it. Edit it to steer the next run.</p>
        <textarea
          aria-label="Task context"
          rows={3}
          placeholder={`Background, links and what good looks like. ${agent} reads this every run.`}
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
      </details>
    </header>
  );
  return (
    <aside className="ws-task-detail" aria-label="Task detail" data-keyboard-pane="detail" tabIndex={-1} style={width ? { width } : undefined}>
      {thread && group ? (
        <ThreadView
          key={thread.id}
          data={data}
          thread={thread}
          group={group}
          run={run}
          header={header}
          compact
        />
      ) : (
        <div className="ws-detail-plain">
          {header}
        </div>
      )}
    </aside>
  );
}
