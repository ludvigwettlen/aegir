import { mainAgent } from '../../../shared/agent-mentions';
import { conversationThreads } from '../../../shared/conversations';
import { useEffect, useRef, useState } from 'react';
import { Archive, Plus } from 'lucide-react';
import type { Snapshot, Thread } from '../../../shared/types';
import { api, relative, taskStatusText, type Run } from './common';
import { ThreadView } from './ThreadView';

type Filter = 'active' | 'tasks' | 'closed';
const matches = (thread: Thread, filter: Filter) => filter === 'tasks'
  ? thread.kind === 'task' : filter === 'closed'
    ? thread.status === 'closed' : thread.kind === 'chat' && thread.status === 'active';
const filterFor = (thread: Thread): Filter => thread.kind === 'task' ? 'tasks' : thread.status === 'closed' ? 'closed' : 'active';

export function ThreadsView({ data, threadId, draft, run, onSelectThread }: {
  data: Snapshot; threadId?: string; draft?: string; run: Run; onSelectThread: (threadId?: string) => void;
}) {
  const all = conversationThreads(data.threads, data.groups, data.agents);
  const [filter, setFilter] = useState<Filter>(() => {
    const target = all.find(thread => thread.id === threadId);
    return target ? filterFor(target) : 'active';
  });
  const [first, setFirst] = useState(draft || '');
  const [creating, setCreating] = useState(false);
  const submitting = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const shown = all.filter(thread => matches(thread, filter));
  const selected = threadId ? all.find(thread => thread.id === threadId) : draft !== undefined ? undefined : shown[0];
  const assistant = mainAgent(data.agents);
  // An external task link or palette selection may target a different tab.
  useEffect(() => {
    const target = all.find(thread => thread.id === threadId);
    if (target) setFilter(filterFor(target));
  }, [threadId]);
  useEffect(() => {
    if (selected && selected.id !== threadId) onSelectThread(selected.id);
  }, [selected?.id]);
  useEffect(() => {
    if (!threadId) return;
    const frame = requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>('.ws-thread-items [data-keyboard-current]');
      row?.scrollIntoView({ block: 'nearest' });
      // Keep a draft in progress focused when titles or snapshots update.
      if (document.activeElement !== input.current) row?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [threadId]);
  const start = () => {
    const text = first.trim();
    if (!text || submitting.current) return;
    submitting.current = true;
    setCreating(true);
    void run(async () => {
      try {
        const thread = await api.startThread(text);
        setFirst('');
        setFilter('active');
        onSelectThread(thread.id);
      } finally { submitting.current = false; setCreating(false); }
    });
  };
  return <div className="ws-group ws-chats">
    <section className="ws-thread-list" aria-label="All threads">
      <header className="ws-group-head">
        <div className="ws-group-title"><div><h1>Chats</h1><p>With {assistant?.name || 'your assistant'}</p></div></div>
        <form className="ws-quick-add" onSubmit={event => { event.preventDefault(); start(); }}>
          <Plus size={15} aria-hidden="true" />
          <input ref={input} autoFocus={draft !== undefined} data-new-thread aria-label="Start a thread" placeholder="Start a thread…"
            disabled={creating} value={first} onChange={event => setFirst(event.target.value)} />
          {creating && <span role="status">Starting…</span>}
        </form>
        <div className="ws-filters" role="group" aria-label="Filter threads">
          {(['active', 'tasks', 'closed'] as Filter[]).map(value => <button key={value} aria-pressed={filter === value}
            className={filter === value ? 'on' : ''} onClick={() => { setFilter(value); onSelectThread(all.find(thread => matches(thread, value))?.id); }}>
            {value === 'active' ? 'Active' : value === 'tasks' ? 'Tasks' : 'Closed'} · {all.filter(thread => matches(thread, value)).length}
          </button>)}
        </div>
      </header>
      <div className="ws-thread-items" data-keyboard-pane="list" tabIndex={-1}>
        {shown.map(thread => {
          const task = data.tasks.find(item => item.id === thread.taskId);
          return <button key={thread.id} className={`ws-thread-item ${thread.id === selected?.id ? 'selected' : ''}`}
            data-keyboard-item data-keyboard-current={thread.id === selected?.id ? '' : undefined} onClick={() => onSelectThread(thread.id)}>
            <span className="ws-thread-item-top"><strong>{thread.title}</strong>
              {task && <span className={`ws-status ${task.status}`}>{taskStatusText[task.status]}</span>}
              {thread.busyAgentIds.length > 0 && <span className="ws-live" aria-label="Assistant working" />}
            </span>
            <span className="ws-thread-snippet">{thread.snippet}</span>
            <span className="ws-thread-meta">{thread.messageCount} message{thread.messageCount === 1 ? '' : 's'} · {relative(thread.updatedAt)}</span>
          </button>;
        })}
        {!shown.length && <p className="ws-empty-line">{filter === 'active' ? 'No active threads. Start one above.' : filter === 'tasks' ? 'Task conversations appear here.' : 'Closed threads appear here.'}</p>}
      </div>
    </section>
    {selected ? <ThreadView key={selected.id} data={data} thread={selected} run={run} header={
      <header className="ws-thread-head"><div><h2>{selected.title}</h2><p>{selected.kind === 'task' ? 'Task conversation' : `With ${assistant?.name || 'your assistant'}`}</p></div>
        {selected.status === 'active' && <button className="ws-btn" onClick={() => void run(async () => { await api.closeThread(selected.id); setFilter('closed'); })}><Archive size={13} /> Close</button>}
      </header>
    } /> : <div className="ws-thread-empty"><p>{draft !== undefined ? 'Finish your message and press Enter to start the thread.' : 'Start a thread with your assistant.'}</p></div>}
  </div>;
}
