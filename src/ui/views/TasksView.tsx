import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { ExternalLink, FolderOpen, Plus, Square, Trash2, Users, X } from 'lucide-react';
import type { Snapshot, Task } from '../../../shared/types';
import { normalizeTaskLink } from '../../../shared/task-links';
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
}: {
  data: Snapshot;
  run: Run;
  list: TaskView;
  notify: (message: string) => void;
}) {
  const [cursors, setCursors] = useState<Partial<Record<TaskView, string>>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<'title' | 'notes' | null>(null);
  const [popover, setPopover] = useState<Popover>(null);
  const [draft, setDraft] = useState('');
  const quickAdd = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => groupTasks(list, tasksFor(list, data.tasks)), [list, data.tasks]);
  const linkedTaskIds = useMemo(() => new Set(data.taskLinks.map(link => link.taskId)), [data.taskLinks]);
  const order = groups.flatMap(([, tasks]) => tasks);
  const current = order.find((task) => task.id === cursors[list]) || order[0];
  const setCursor = (id: string) => setCursors((previous) => ({ ...previous, [list]: id }));
  const open = data.tasks.find((task) => task.id === openId);
  const closeDetail = () => {
    setOpenId(null);
    window.requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('.ws-rows [data-keyboard-current]')?.focus(),
    );
  };
  useEffect(() => {
    setPopover(null);
    setOpenId(null);
  }, [list]);
  useEffect(() => {
    if (openId && !order.some((task) => task.id === openId)) setOpenId(null);
  }, [openId, order]);
  useEffect(() => {
    if (!editTarget || !openId) return;
    const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      editTarget === 'title'
        ? '.ws-task-detail [aria-label="Task title"]'
        : '.ws-task-detail [aria-label="Task notes"]',
    );
    field?.focus();
    if (editTarget === 'title' && field instanceof HTMLInputElement) field.select();
    setEditTarget(null);
  }, [editTarget, openId]);

  const update = (task: Task, change: Parameters<typeof api.updateTask>[1]) =>
    run(() => api.updateTask(task.id, change));
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTyping(event) || popover) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        event.metaKey && event.key.toLowerCase() === 'v' && current &&
        !event.altKey && !event.ctrlKey &&
        !target?.closest('.ws-sidebar, .ws-task-detail')
      ) {
        event.preventDefault();
        void run(async () => {
          const url = normalizeTaskLink(await api.readClipboardText());
          if (!url) {
            notify('Clipboard has no link to attach');
            return;
          }
          await api.addTaskLink(current.id, url);
          notify('Link added · ⌘Z to undo');
        });
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (target?.closest('.ws-sidebar, .ws-task-detail')) {
        if (event.key === 'Escape' && openId) {
          closeDetail();
          event.preventDefault();
        }
        return;
      }
      const key = event.key;
      if (key === 'Escape') closeDetail();
      else if (!current) return;
      else if (key === 'Enter') {
        setOpenId(current.id);
        setEditTarget('title');
      } else if (key === 'n') {
        setOpenId(current.id);
        setEditTarget('notes');
      }
      else if (key === ' ')
        void update(current, { status: current.status === 'done' ? 'ready' : 'done' });
      else if (key === 'a' && current.status !== 'running' && current.status !== 'done')
        setPopover({ kind: 'handoff', taskId: current.id });
      else if (key === 'b') setPopover({ kind: 'label', taskId: current.id });
      else if (key === 'B') void update(current, { label: null });
      else if (key === 'd') setPopover({ kind: 'due', taskId: current.id });
      else if (key === 'D') void update(current, { dueAt: null });
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
            <Kbd>⌘N</Kbd>
          </form>
        )}
        <div className="ws-rows" role="list" data-keyboard-pane="list" tabIndex={-1}>
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
                    setOpenId(task.id);
                  }}
                  onFocus={() => {
                    setCursor(task.id);
                    if (openId) setOpenId(task.id);
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
          <span><Kbd>Space</Kbd> {list === 'completed' ? 'reopen' : 'done'}</span>
          {list !== 'completed' && <span><Kbd>A</Kbd> hand off</span>}
          <span>
            <Kbd>B</Kbd> label
          </span>
          <span>
            <Kbd>D</Kbd> due · <Kbd>⇧D</Kbd> clear
          </span>
          <span>
            <Kbd>↵</Kbd> edit title
          </span>
          {list === 'needs' && (
            <span>
              <Kbd>Y</Kbd> accept
            </span>
          )}
          <span className="grow" />
          <span><Kbd>N</Kbd> note</span>
          <span><Kbd>⌘V</Kbd> link</span>
          <span><Kbd>⌘N</Kbd> new</span>
          <span><Kbd>⌘Z</Kbd> undo</span>
        </footer>
      </section>
      {open && (
        <TaskDetail
          key={open.id}
          task={open}
          data={data}
          run={run}
          notify={notify}
          onClose={closeDetail}
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
    today: 'Nothing due today. Add a task above.',
    upcoming: 'Nothing scheduled yet. Add a due date with D or type “fri” in quick add.',
    team: 'Nothing handed off. Press A on a task to give it to the agent team.',
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
      <TaskGlyph task={task} />
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
  notify,
  onClose,
  onReturnToList,
  onHandOff,
}: {
  task: Task;
  data: Snapshot;
  run: Run;
  notify: (message: string) => void;
  onClose: () => void;
  onReturnToList: () => void;
  onHandOff: () => void;
}) {
  const thread = data.threads.find((item) => item.id === task.threadId);
  const group = thread && data.groups.find((item) => item.id === thread.groupId);
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [label, setLabel] = useState(task.label || '');
  const cancelledTitle = useRef(false);
  const cancelledNotes = useRef(false);
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
          className="ws-btn ghost"
          disabled={task.status === 'running'}
          aria-label="Delete task"
          title={task.status === 'running' ? 'Stop this task before deleting it' : undefined}
          onClick={() => {
            void run(async () => {
              await api.deleteTask(task.id);
              onClose();
              notify('Task deleted · ⌘Z to undo');
            });
          }}
        >
          <Trash2 size={13} />
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
          if (event.key === 'Enter') { event.currentTarget.blur(); window.requestAnimationFrame(onReturnToList); }
          if (event.key === 'Escape') {
            cancelledTitle.current = true;
            setTitle(task.title);
            event.currentTarget.blur();
            window.requestAnimationFrame(onReturnToList);
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
            <a href={link.url} title={link.url} onClick={event => { event.preventDefault(); void run(() => api.openExternal(link.url)); }}>
              {new URL(link.url).hostname || new URL(link.url).protocol.replace(':', '')} <ExternalLink size={11} />
            </a>
            <button type="button" aria-label={`Remove link ${link.url}`} title="Remove link" onClick={() => void run(() => api.removeTaskLink(link.id))}><X size={11} /></button>
          </span>
        ))}
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
          aria-label="Task notes"
          rows={3}
          placeholder="Add context for this task"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => {
            if (cancelledNotes.current) { cancelledNotes.current = false; setNotes(task.notes); return; }
            if (notes !== task.notes) void run(() => api.updateTask(task.id, { notes }));
          }}
          onKeyDown={event => {
            if (event.key === 'Escape') { cancelledNotes.current = true; setNotes(task.notes); event.currentTarget.blur(); window.requestAnimationFrame(onReturnToList); }
          }}
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
    <aside className="ws-task-detail" aria-label="Task detail" data-keyboard-pane="detail" tabIndex={-1}>
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
                {task.status !== 'done' && (
                  <button className="ws-btn primary" onClick={onHandOff}>
                    <Users size={13} /> Hand off to the team <Kbd>A</Kbd>
                  </button>
                )}
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
                  {task.status === 'done' ? 'Reopen' : 'Mark done'} <Kbd>Space</Kbd>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
