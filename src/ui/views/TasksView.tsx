import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Check, ChevronRight, ExternalLink, Maximize2, Minimize2, Plus, RotateCcw, Square, Users, X } from 'lucide-react';
import type { Snapshot, Task } from '../../../shared/types';
import { taskLinkLabel } from '../../../shared/task-links';
import { isoDate, parseDue, parseQuickAdd, taskCursor, tasksFor, type TaskView } from '../../../shared/tasks';
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
import { Button } from '../design-system/primitives';

const titles: Record<TaskView, string> = {
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
  for (const task of sorted) {
    const key =
      list === 'needs' ? taskStatusText[task.status] : task.label ? `#${task.label}` : 'No label';
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
          if (task.outputDir) void run(() => api.openTaskOutput(task.id));
          else {
            const link = data.taskLinks.find(item => item.taskId === task.id);
            if (link) void run(() => api.openTaskLink(link.id));
            else notify('This task has no output or attachment yet');
          }
          return;
        }
        if (event.key.toLowerCase() === 'l' && !isTyping(event) && current && !target?.closest('.ws-task-detail')) {
          event.preventDefault(); setPopover({ kind: 'label', taskId: current.id }); return;
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
      else if (key === 'A') {
        const thread = data.threads.find(item => item.id === current.threadId);
        if (thread && data.groups.some(group => group.id === thread.groupId)) onOpenThread(thread.groupId, thread.id);
        else notify('This task has no conversation yet');
      }
      else if (key === 'f') setFocus((value) => !value);
      else if (key === 'b') setPopover({ kind: 'label', taskId: current.id });
      else if (key === 'B') void update(current, { label: null });
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
                  showLabel={list === 'needs'}
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
          onOpenThread={onOpenThread}
          onReturnToList={() =>
            document.querySelector<HTMLElement>('.ws-rows [data-keyboard-current]')?.focus()
          }
          onHandOff={() => setPopover({ kind: 'handoff', taskId: open.id })}
        />
      )}
    </div>
  );
}

function Empty({ list }: { list: TaskView }) {
  const text = {
    today: 'Nothing due today. Give a task a date to see it here.',
    upcoming: 'Nothing scheduled yet. Add a due date with D or type “fri” in quick add.',
    inbox: 'Inbox zero. Undated tasks and phone captures land here.',
    team: 'Nothing handed off. Press A on a task, or use the hand-off button, to give it to the agent.',
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
  popover: 'handoff' | 'label' | 'due' | null;
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
      {popover && <TaskPopover kind={popover} task={task} agent={leadName(data)} onClose={onClosePopover} run={run} />}
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
      className={`ws-popover ${kind}`}
      role="dialog"
      aria-label={
        kind === 'handoff'
          ? `Hand off to ${agent}`
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
            HAND OFF TO {agent.toUpperCase()}
          </div>
          <textarea
            autoFocus
            rows={3}
            aria-label="Instruction"
            placeholder={`What should ${agent} do? Leave empty to use “${task.title}”.`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="ws-popover-foot">
            <span className="grow">Results are saved as files in the task folder</span>
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
  task,
  data,
  run,
  width,
  focused,
  onToggleFocus,
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
  // The date field saves only complete dates: picking from the calendar, Enter, or leaving the field.
  const [due, setDue] = useState(task.dueAt || '');
  useEffect(() => setDue(task.dueAt || ''), [task.dueAt]);
  const typingDue = useRef(false);
  const validDue = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 2000 && Number(value.slice(0, 4)) <= 2100;
  const commitDue = (value: string) => {
    typingDue.current = false;
    if (!validDue(value)) { setDue(task.dueAt || ''); return; }
    if (value !== task.dueAt) void run(() => api.updateTask(task.id, { dueAt: value }));
  };
  const labels = useMemo(() => [...new Set(data.tasks.map((item) => item.label).filter((value): value is string => !!value))].sort(), [data.tasks]);
  const agent = leadName(data);
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
      <div className="ws-detail-controls">
        {task.status !== 'running' && (
          <button type="button" className={`ws-btn ${task.status === 'done' || task.status === 'proposed' ? '' : 'primary'}`}
            onClick={() => void run(() => api.updateTask(task.id, { status: task.status === 'done' ? 'ready' : 'done' }))}>
            {task.status === 'done' ? <><RotateCcw size={13} /> Reopen</> : <><Check size={13} /> Mark done</>}
          </button>
        )}
        <label className="ws-inline-field">
          <span>Due</span>
          <input type="date" aria-label="Due date" min="2000-01-01" max="2100-12-31" value={due}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); commitDue(due); return; }
              if (event.key === 'Escape') { event.preventDefault(); typingDue.current = false; setDue(task.dueAt || ''); event.currentTarget.blur(); onReturnToList(); return; }
              typingDue.current = true;
            }}
            onChange={(event) => {
              setDue(event.target.value);
              // A change that didn't come from typing is the calendar picker: save it straight away.
              if (!typingDue.current && validDue(event.target.value)) commitDue(event.target.value);
            }}
            onBlur={() => { if (typingDue.current) commitDue(due); }} />
          {task.dueAt && (
            <button type="button" aria-label="Clear due date" title="Clear due date"
              onClick={() => void run(() => api.updateTask(task.id, { dueAt: null }))}><X size={11} /></button>
          )}
        </label>
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
        {task.status !== 'done' && task.status !== 'running' && !thread && (
          <button type="button" className="ws-btn" onClick={onHandOff}>
            <Users size={13} /> Hand off to {agent}
          </button>
        )}
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
              null
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
