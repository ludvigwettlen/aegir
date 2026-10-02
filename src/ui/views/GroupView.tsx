import { useEffect, useState } from 'react';
import { Archive, Lock, Plus } from 'lucide-react';
import type { Group, Snapshot } from '../../../shared/types';
import { api, Avatar, relative, taskStatusText, type Run } from './common';
import { ThreadView } from './ThreadView';

type Filter = 'active' | 'tasks' | 'closed';

export function GroupView({
  data,
  group,
  threadId,
  draft,
  run,
  onSelectThread,
}: {
  data: Snapshot;
  group: Group;
  threadId?: string;
  draft?: string;
  run: Run;
  onSelectThread: (threadId: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>(() => {
    const target = data.threads.find(thread => thread.id === threadId && thread.groupId === group.id);
    return target?.kind === 'task' ? 'tasks' : target?.status === 'closed' ? 'closed' : 'active';
  });
  const [first, setFirst] = useState(draft || '');
  const all = data.threads.filter((thread) => thread.groupId === group.id);
  const shown = all.filter((thread) =>
    filter === 'tasks'
      ? thread.kind === 'task'
      : filter === 'closed'
        ? thread.status === 'closed'
        : thread.status === 'active',
  );
  const selected = all.find((thread) => thread.id === threadId) || (draft ? undefined : shown[0]);
  useEffect(() => {
    if (selected && selected.id !== threadId) onSelectThread(selected.id);
  }, [selected?.id]);
  useEffect(() => {
    if (!threadId) return;
    const frame = requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>('.ws-thread-items [data-keyboard-current]');
      row?.scrollIntoView({ block: 'nearest' }); row?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [threadId]);
  const members = group.agentIds
    .map((id) => data.agents.find((agent) => agent.id === id))
    .filter(Boolean);
  const start = () => {
    const text = first.trim();
    if (!text) return;
    setFirst('');
    void run(async () => {
      const thread = await api.startThread(group.id, text);
      setFilter('active');
      onSelectThread(thread.id);
    });
  };
  const count = (value: Filter) =>
    all.filter((thread) =>
      value === 'tasks'
        ? thread.kind === 'task'
        : value === 'closed'
          ? thread.status === 'closed'
          : thread.status === 'active',
    ).length;
  return (
    <div className="ws-group">
      <section className="ws-thread-list" aria-label={`Threads in ${group.title}`}>
        <header className="ws-group-head">
          <div className="ws-group-title">
            {group.kind === 'private' ? <Avatar agent={members[0]} size={30} /> : null}
            <div>
              <h1>{group.kind === 'private' ? group.title : `# ${group.title}`}</h1>
              <p>
                {group.kind === 'private' ? (
                  <>
                    <Lock size={11} aria-hidden="true" /> Private · just you and {group.title}
                  </>
                ) : (
                  <>
                    {members.map((agent) => (
                      <Avatar key={agent!.id} agent={agent} size={16} />
                    ))}
                    <span>{members.map((agent) => agent!.name).join(', ')}</span>
                  </>
                )}
              </p>
            </div>
          </div>
          <form
            className="ws-quick-add"
            onSubmit={(event) => {
              event.preventDefault();
              start();
            }}
          >
            <Plus size={15} aria-hidden="true" />
            <input
              autoFocus={!!draft}
              data-new-thread
              aria-label="Start a thread"
              placeholder={
                group.kind === 'private'
                  ? `Start a thread with ${group.title}…`
                  : `Start a thread in #${group.title}…`
              }
              value={first}
              onChange={(event) => setFirst(event.target.value)}
            />
          </form>
          <div className="ws-filters" role="group" aria-label="Filter threads">
            {(['active', 'tasks', 'closed'] as Filter[]).map((value) => (
              <button
                key={value}
                aria-pressed={filter === value}
                className={filter === value ? 'on' : ''}
                onClick={() => setFilter(value)}
              >
                {value === 'active' ? 'Active' : value === 'tasks' ? 'Tasks' : 'Closed'} ·{' '}
                {count(value)}
              </button>
            ))}
          </div>
        </header>
        <div className="ws-thread-items" data-keyboard-pane="list" tabIndex={-1}>
          {shown.map((thread) => {
            const task = thread.taskId
              ? data.tasks.find((item) => item.id === thread.taskId)
              : undefined;
            const authors = thread.agentIds.slice(0, 3);
            const replies = thread.messageCount;
            const unreadish = thread.busyAgentIds.length > 0;
            return (
              <button
                key={thread.id}
                className={`ws-thread-item ${thread.id === selected?.id ? 'selected' : ''}`}
                data-keyboard-item
                data-keyboard-current={thread.id === selected?.id ? '' : undefined}
                onClick={() => onSelectThread(thread.id)}
              >
                <span className="ws-thread-item-top">
                  <strong>{thread.title}</strong>
                  {task && (
                    <span className={`ws-status ${task.status}`}>
                      {taskStatusText[task.status]}
                    </span>
                  )}
                  {unreadish && <span className="ws-live" aria-label="Agent working" />}
                </span>
                <span className="ws-thread-snippet">{thread.snippet}</span>
                <span className="ws-thread-meta">
                  {authors.map((id) => (
                    <Avatar
                      key={id}
                      agent={data.agents.find((agent) => agent.id === id)}
                      size={16}
                    />
                  ))}
                  <span>
                    {replies} message{replies === 1 ? '' : 's'} · {relative(thread.updatedAt)}
                  </span>
                </span>
              </button>
            );
          })}
          {!shown.length && (
            <p className="ws-empty-line">
              {filter === 'active'
                ? 'No active threads. Start one above.'
                : filter === 'tasks'
                  ? 'Tasks handed off to this group appear here.'
                  : 'Closed threads appear here.'}
            </p>
          )}
        </div>
      </section>
      {selected ? (
        <ThreadView
          key={selected.id}
          data={data}
          thread={selected}
          group={group}
          run={run}
          header={
            <header className="ws-thread-head">
              <div>
                <h2>{selected.title}</h2>
                <p>
                  {selected.kind === 'task' ? 'Task thread' : 'Thread'} in{' '}
                  {group.kind === 'private' ? `your chat with ${group.title}` : `#${group.title}`}
                </p>
              </div>
              {selected.status === 'active' && (
                <button
                  className="ws-btn"
                  onClick={() => void run(() => api.closeThread(selected.id))}
                >
                  <Archive size={13} /> Close
                </button>
              )}
            </header>
          }
        />
      ) : (
        <div className="ws-thread-empty">
          <p>
            {draft
              ? 'Finish the message on the left and press Enter to start the thread.'
              : 'Start a thread to talk with the group.'}
          </p>
        </div>
      )}
    </div>
  );
}
