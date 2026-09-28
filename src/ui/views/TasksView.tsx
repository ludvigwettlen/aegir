import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { ExternalLink, FolderOpen, Plus, Square, Trash2, Users, X } from 'lucide-react';
import type { Snapshot, Task } from '../../../shared/types';
import { parseDue, parseQuickAdd, tasksFor, type TaskView } from '../../../shared/tasks';
import {
  api,
  Avatar,
  dueLabel,
  isOverdue,
  isTyping,
  Kbd,
  TaskGlyph,
  taskStatusText,
  type Run,
} from './common';
import { ThreadView } from './ThreadView';

const titles: Record<TaskView, string> = {
  today: 'Today',
  upcoming: 'Upcoming',
  team: 'With the team',
  needs: 'Needs you',
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

function groupTasks(list: TaskView, tasks: Task[]) {
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

export function TasksView({ data, run, list }: { data: Snapshot; run: Run; list: TaskView }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [popover, setPopover] = useState<Popover>(null);
  const [draft, setDraft] = useState('');
  const quickAdd = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => groupTasks(list, tasksFor(list, data.tasks)), [list, data.tasks]);
  const order = groups.flatMap(([, tasks]) => tasks);
  const current = order.find((task) => task.id === cursor) || order[0];
  const open = data.tasks.find((task) => task.id === openId);
  useEffect(() => {
    setPopover(null);
  }, [list]);

  const update = (task: Task, change: Parameters<typeof api.updateTask>[1]) =>
    run(() => api.updateTask(task.id, change));
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event) || event.metaKey || event.ctrlKey || event.altKey || popover) return;
      const index = current ? order.indexOf(current) : -1;
      const move = (delta: number) => {
        const next = order[Math.min(order.length - 1, Math.max(0, index + delta))];
        if (next) {
          setCursor(next.id);
          if (openId) setOpenId(next.id);
        }
      };
      const key = event.key;
      if (key === 'j' || key === 'ArrowDown') move(1);
      else if (key === 'k' || key === 'ArrowUp') move(-1);
      else if (key === 'n') quickAdd.current?.focus();
      else if (key === 'Escape') setOpenId(null);
      else if (!current) return;
      else if (key === 'Enter') setOpenId(current.id);
      else if (key === 'x')
        void update(current, { status: current.status === 'done' ? 'ready' : 'done' });
      else if (key === 'h' && current.status !== 'running')
        setPopover({ kind: 'handoff', taskId: current.id });
      else if (key === 'l') setPopover({ kind: 'label', taskId: current.id });
      else if (key === 'd') setPopover({ kind: 'due', taskId: current.id });
      else if (key === 'y' && current.status === 'proposed')
        void update(current, { status: 'ready' });
      else if ((key === 'Backspace' || key === 'Delete') && current.status === 'proposed')
        void update(current, { status: 'dismissed' });
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const add = () => {
    const parsed = parseQuickAdd(draft);
    if (!parsed.title) return;
    setDraft('');
    void run(async () => {
      const task = await api.createTask(parsed);
      setCursor(task.id);
    });
  };
  const count = order.length;
  const team = order.filter((task) => task.threadId).length;
  return (
    <div className="ws-tasks">
      <section className="ws-task-list" aria-label={titles[list]}>
        <header className="ws-page-head">
          <div>
            <h1>{titles[list]}</h1>
            <p>
              {count} task{count === 1 ? '' : 's'}
              {team ? ` · ${team} with the team` : ''}
            </p>
          </div>
        </header>
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
          <Kbd>N</Kbd>
        </form>
        <div className="ws-rows" role="list">
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
                  selected={task.id === current?.id}
                  opened={task.id === openId}
                  onClick={() => {
                    setCursor(task.id);
                    setOpenId(task.id);
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
        <footer className="ws-shortcuts" aria-label="Keyboard shortcuts">
          <span>
            <Kbd>J</Kbd>
            <Kbd>K</Kbd> move
          </span>
          <span>
            <Kbd>X</Kbd> done
          </span>
          <span>
            <Kbd>H</Kbd> hand off
          </span>
          <span>
            <Kbd>L</Kbd> label
          </span>
          <span>
            <Kbd>D</Kbd> due
          </span>
          <span>
            <Kbd>↵</Kbd> open
          </span>
          {list === 'needs' && (
            <span>
              <Kbd>Y</Kbd> accept
            </span>
          )}
          <span className="grow" />
          <span>
            <Kbd>N</Kbd> new
          </span>
        </footer>
      </section>
      {open && (
        <TaskDetail
          key={open.id}
          task={open}
          data={data}
          run={run}
          onClose={() => setOpenId(null)}
          onHandOff={() => setPopover({ kind: 'handoff', taskId: open.id })}
        />
      )}
    </div>
  );
}

function Empty({ list }: { list: TaskView }) {
  const text = {
    today: 'Nothing due today. Add a task above.',
    upcoming: 'Nothing scheduled yet. Add a due date with D or type “fri” in quick add.',
    team: 'Nothing handed off. Press H on a task to give it to the agent team.',
    needs: 'All caught up. Suggestions and work ready for review show up here.',
  }[list];
  return <p className="ws-empty-line">{text}</p>;
}

function TaskRow({
  task,
  data,
  showLabel,
  selected,
  opened,
  onClick,
  popover,
  onClosePopover,
  run,
}: {
  task: Task;
  data: Snapshot;
  showLabel: boolean;
  selected: boolean;
  opened: boolean;
  onClick: () => void;
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
      aria-current={selected ? 'true' : undefined}
      onClick={onClick}
    >
      <TaskGlyph task={task} />
      <span className={`ws-task-title ${task.status === 'done' ? 'done' : ''}`}>{task.title}</span>
      {task.sourceUrl && (
        <ExternalLink size={12} className="ws-muted-icon" aria-label="From a source" />
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
    kind === 'label' ? task.label || '' : kind === 'due' ? task.dueAt || '' : '',
  );
  const [error, setError] = useState('');
  const cancelled = useRef(false);
  const submit = () => {
    if (cancelled.current) return;
    if (kind === 'handoff') void run(() => api.handOff(task.id, value));
    if (kind === 'label')
      void run(() =>
        api.updateTask(task.id, { label: value.replace(/^#/, '').trim().toLowerCase() || null }),
      );
    if (kind === 'due') {
      const dueAt = value.trim() ? parseDue(value.trim(), new Date()) : null;
      if (value.trim() && !dueAt) {
        setError('Try “today”, “fri”, or YYYY-MM-DD.');
        return;
      }
      void run(() => api.updateTask(task.id, { dueAt }));
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
            <span className="grow">Atlas routes it · results saved as files</span>
            <span>
              <Kbd>Esc</Kbd> cancel
            </span>
            <strong>
              <Kbd>↵</Kbd> hand off
            </strong>
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
  onClose,
  onHandOff,
}: {
  task: Task;
  data: Snapshot;
  run: Run;
  onClose: () => void;
  onHandOff: () => void;
}) {
  const thread = data.threads.find((item) => item.id === task.threadId);
  const group = thread && data.groups.find((item) => item.id === thread.groupId);
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [label, setLabel] = useState(task.label || '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saveTitle = () => {
    const next = title.trim();
    if (!next) {
      setTitle(task.title);
      return;
    }
    if (next !== task.title) void run(() => api.updateTask(task.id, { title: next }));
  };
  const saveLabel = () => {
    const next = label.replace(/^#/, '').trim().toLowerCase() || null;
    setLabel(next || '');
    if (next !== task.label) void run(() => api.updateTask(task.id, { label: next }));
  };
  const header = (
    <header className="ws-detail-head">
      <div className="ws-detail-top">
        <span className="ws-crumb">
          {group
            ? `Thread in ${group.kind === 'private' ? group.title : `#${group.title}`}`
            : task.sourceUrl
              ? 'From a source'
              : 'Your task'}
        </span>
        {task.outputDir && (
          <button className="ws-btn" onClick={() => void run(() => api.openTaskOutput(task.id))}>
            <FolderOpen size={13} /> Output
          </button>
        )}
        {task.status === 'running' && (
          <button className="ws-btn" onClick={() => void run(() => api.stopTask(task.id))}>
            <Square size={12} /> Stop
          </button>
        )}
        <button
          className={`ws-btn ${confirmDelete ? 'danger' : 'ghost'}`}
          disabled={task.status === 'running'}
          aria-label={confirmDelete ? 'Confirm delete task' : 'Delete task'}
          title={task.status === 'running' ? 'Stop this task before deleting it' : undefined}
          onBlur={() => setConfirmDelete(false)}
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              return;
            }
            void run(async () => {
              await api.deleteTask(task.id);
              onClose();
            });
          }}
        >
          {confirmDelete ? 'Delete task?' : <Trash2 size={13} />}
        </button>
        <button className="ws-icon-btn" aria-label="Close task" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <input
        className="ws-task-title-input"
        aria-label="Task title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={saveTitle}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setTitle(task.title);
            event.currentTarget.blur();
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
      </div>
      <div className="ws-task-properties">
        <label>
          <span>Label</span>
          <span className="ws-input-with-clear">
            <input
              aria-label="Task label"
              placeholder="No label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              onBlur={saveLabel}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') {
                  setLabel(task.label || '');
                  event.currentTarget.blur();
                }
              }}
            />
            {label && (
              <button
                type="button"
                aria-label="Remove label"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setLabel('');
                  void run(() => api.updateTask(task.id, { label: null }));
                }}
              >
                <X size={12} />
              </button>
            )}
          </span>
        </label>
        <label>
          <span>Due date</span>
          <span className="ws-input-with-clear">
            <input
              type="date"
              aria-label="Task due date"
              value={task.dueAt || ''}
              onChange={(event) =>
                void run(() => api.updateTask(task.id, { dueAt: event.target.value || null }))
              }
            />
            {task.dueAt && (
              <button
                type="button"
                aria-label="Remove due date"
                onClick={() => void run(() => api.updateTask(task.id, { dueAt: null }))}
              >
                <X size={12} />
              </button>
            )}
          </span>
        </label>
      </div>
      <label className="ws-field">
        <span>Notes</span>
        <textarea
          rows={3}
          placeholder="Add context for this task"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => notes !== task.notes && void run(() => api.updateTask(task.id, { notes }))}
        />
      </label>
      {task.status === 'review' && (
        <div className="ws-row-actions">
          <button
            className="ws-btn primary"
            onClick={() => void run(() => api.updateTask(task.id, { status: 'done' }))}
          >
            Mark done
          </button>
          <span className="ws-hint">or reply below to ask for changes</span>
        </div>
      )}
    </header>
  );
  return (
    <aside className="ws-task-detail" aria-label="Task detail">
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
              <>
                <button className="ws-btn primary" onClick={onHandOff}>
                  <Users size={13} /> Hand off to the team <Kbd>H</Kbd>
                </button>
                <button
                  className="ws-btn"
                  onClick={() =>
                    void run(() =>
                      api.updateTask(task.id, {
                        status: task.status === 'done' ? 'ready' : 'done',
                      }),
                    )
                  }
                >
                  {task.status === 'done' ? 'Reopen' : 'Mark done'} <Kbd>X</Kbd>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
