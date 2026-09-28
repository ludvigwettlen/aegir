import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ComposerSkills } from './SkillBindings';
import { ConversationList } from '@usefragments/ui';
import { ArrowDownRight, Repeat2, Send, Square } from 'lucide-react';
import type { Agent, Group, Message, Routine, Snapshot, Thread } from '../../../shared/types';
import { describeSchedule } from '../../../shared/routines';
import { api, Avatar, Kbd, linkedText, time, YouAvatar, type Run } from './common';

import { useThreadMessages } from '../hooks/useThreadMessages';

type Mention = { kind: 'agent'; agent: Agent } | { kind: 'routine'; routine: Routine };

export function ThreadView({
  data,
  thread,
  group,
  run,
  header,
  compact = false,
}: {
  data: Snapshot;
  thread: Thread;
  group: Group;
  run: Run;
  header?: ReactNode;
  compact?: boolean;
}) {
  const { messages, hasOlder, loading, loadOlder } = useThreadMessages(thread.id, run);
  const busy =
    messages.some((message) => message.status === 'streaming') ||
    !!data.threads.find((item) => item.id === thread.id)?.busyAgentIds.length;
  return (
    <section
      className={`ws-thread ${compact ? 'compact' : ''}`}
      data-keyboard-pane="detail"
      tabIndex={-1}
      aria-label={`Thread: ${thread.title}`}
    >
      {header}
      <ConversationList
        key={thread.id}
        className="ws-messages"
        autoScroll="smart"
        emptyState={<p className="ws-empty-line">No messages yet.</p>}
      >
        {hasOlder && (
          <button className="ws-btn" disabled={loading} onClick={loadOlder}>
            Load earlier messages
          </button>
        )}
        {messages.map((message) => (
          <MessageRow key={message.id} message={message} data={data} run={run} />
        ))}
      </ConversationList>
      <Composer
        key={`composer-${thread.id}`}
        data={data}
        group={group}
        busy={busy}
        placeholder={
          thread.kind === 'task' ? 'Reply to the team on this task…' : 'Reply in thread…'
        }
        onSend={(text) => run(() => api.sendMessage(thread.id, text))}
        onStop={() => run(() => api.stopThread(thread.id))}
      />
    </section>
  );
}

function MessageRow({ message, data, run }: { message: Message; data: Snapshot; run: Run }) {
  if (message.meta?.type === 'routine-change')
    return <RoutineChangeCard message={message} data={data} run={run} />;
  if (message.role === 'system')
    return (
      <div className="ws-event">
        <ArrowDownRight size={13} aria-hidden="true" />
        <span>{message.content}</span>
      </div>
    );
  const agent = data.agents.find((item) => item.id === message.agentId);
  return (
    <article
      className="ws-message"
      aria-label={`${message.role === 'user' ? 'You' : agent?.name || 'Agent'}, ${time(message.createdAt)}`}
    >
      {message.role === 'user' ? <YouAvatar size={32} /> : <Avatar agent={agent} size={32} />}
      <div className="ws-message-body">
        <div className="ws-message-head">
          <strong>{message.role === 'user' ? 'You' : agent?.name || 'Agent'}</strong>
          {agent && <span className="ws-role">{agent.role}</span>}
          <time>{time(message.createdAt)}</time>
          {message.status === 'failed' && <span className="ws-failed">Failed</span>}
        </div>
        <div className="ws-message-text">
          {message.content ? (
            linkedText(message.content)
          ) : (
            <span className="ws-typing" aria-label="Working">
              <i />
              <i />
              <i />
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

function RoutineChangeCard({ message, data, run }: { message: Message; data: Snapshot; run: Run }) {
  const meta = message.meta!;
  const routine = data.routines.find((item) => item.id === meta.routineId);
  const rows: [string, string | undefined, string][] = [];
  const agentName = (id?: string) => data.agents.find((agent) => agent.id === id)?.name;
  if (meta.change.name) rows.push(['Name', routine?.name, meta.change.name]);
  if (meta.change.schedule)
    rows.push([
      'Schedule',
      routine && describeSchedule(routine.schedule),
      describeSchedule(meta.change.schedule),
    ]);
  if (meta.change.agentId)
    rows.push(['Agent', agentName(routine?.agentId), agentName(meta.change.agentId) || '']);
  if (meta.change.enabled !== undefined)
    rows.push([
      'Status',
      routine && (routine.enabled ? 'On' : 'Paused'),
      meta.change.enabled ? 'On' : 'Paused',
    ]);
  if (meta.change.instructions) rows.push(['Instructions', undefined, meta.change.instructions]);
  return (
    <div className="ws-change">
      <div className="ws-change-title">
        <Repeat2 size={14} aria-hidden="true" />
        {routine ? `Change to ${routine.name}` : 'New routine'}
      </div>
      {message.content && <p>{message.content}</p>}
      <dl>
        {rows.map(([label, before, after]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {before && before !== after && (
                <>
                  <s>{before}</s> →{' '}
                </>
              )}
              <strong>{after}</strong>
            </dd>
          </div>
        ))}
      </dl>
      {meta.state === 'pending' ? (
        <div className="ws-row-actions">
          <button
            className="ws-btn primary"
            onClick={() => void run(() => api.resolveRoutineChange(message.id, true))}
          >
            Apply
          </button>
          <button
            className="ws-btn"
            onClick={() => void run(() => api.resolveRoutineChange(message.id, false))}
          >
            Discard
          </button>
        </div>
      ) : (
        <span className="ws-change-state">
          {meta.state === 'applied' ? 'Applied' : 'Discarded'}
        </span>
      )}
    </div>
  );
}

export function Composer({
  data,
  group,
  busy,
  placeholder,
  onSend,
  onStop,
}: {
  data: Snapshot;
  group: Group;
  busy: boolean;
  placeholder: string;
  onSend: (text: string) => Promise<void> | void;
  onStop?: () => void;
}) {
  const [value, setValue] = useState('');
  const [picker, setPicker] = useState<{ query: string; start: number } | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const options = useMemo<Mention[]>(() => {
    if (!picker) return [];
    const q = picker.query.toLowerCase();
    const agents = [...data.agents].sort(
      (a, b) => Number(group.agentIds.includes(b.id)) - Number(group.agentIds.includes(a.id)),
    );
    return [
      ...data.routines
        .filter((routine) => routine.name.toLowerCase().includes(q))
        .map((routine) => ({ kind: 'routine', routine }) as Mention),
      ...agents
        .filter((agent) => agent.name.toLowerCase().startsWith(q))
        .map((agent) => ({ kind: 'agent', agent }) as Mention),
    ].slice(0, 8);
  }, [picker, data.agents, data.routines, group.agentIds]);
  const update = (text: string, caret: number) => {
    setValue(text);
    // Routine names contain spaces, so the query may too; a trailing space closes the picker.
    const match = text.slice(0, caret).match(/(^|\s)@([\w ]{0,30})$/);
    const query = match?.[2];
    if (query !== undefined && !query.endsWith(' ')) {
      setPicker({ query, start: caret - query.length - 1 });
      setActive(0);
    } else setPicker(null);
  };
  const choose = (option: Mention) => {
    if (!picker) return;
    const name = option.kind === 'agent' ? option.agent.name : option.routine.name;
    const caret = input.current?.selectionStart ?? value.length;
    const next = `${value.slice(0, picker.start)}@${name} ${value.slice(caret)}`;
    setValue(next);
    setPicker(null);
    requestAnimationFrame(() => {
      const at = picker.start + name.length + 2;
      input.current?.setSelectionRange(at, at);
      input.current?.focus();
    });
  };
  const submit = () => {
    const text = value.trim();
    if (!text || busy) return;
    setValue('');
    setPicker(null);
    void onSend(text);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (picker && options.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((active + 1) % options.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((active - 1 + options.length) % options.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        choose(options[active]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setPicker(null);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };
  const routines = options.filter((option) => option.kind === 'routine');
  const agents = options.filter((option) => option.kind === 'agent');
  return (
    <div className="ws-composer-wrap">
      {picker && options.length > 0 && (
        <div className="ws-picker" role="listbox" aria-label="Mention">
          {routines.length > 0 && <div className="ws-picker-label">ROUTINES</div>}
          {routines.map((option) => {
            const index = options.indexOf(option);
            const routine = (option as { routine: Routine }).routine;
            return (
              <button
                key={routine.id}
                role="option"
                aria-selected={index === active}
                className={index === active ? 'active' : ''}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(option);
                }}
              >
                <Repeat2 size={14} />
                <span>{routine.name}</span>
                <small>{describeSchedule(routine.schedule)}</small>
              </button>
            );
          })}
          {agents.length > 0 && <div className="ws-picker-label">AGENTS</div>}
          {agents.map((option) => {
            const index = options.indexOf(option);
            const agent = (option as { agent: Agent }).agent;
            return (
              <button
                key={agent.id}
                role="option"
                aria-selected={index === active}
                className={index === active ? 'active' : ''}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(option);
                }}
              >
                <Avatar agent={agent} size={18} />
                <span>{agent.name}</span>
                <small>{agent.role}</small>
              </button>
            );
          })}
        </div>
      )}
      <div className="ws-composer">
        <textarea
          ref={input}
          aria-label="Message"
          rows={2}
          placeholder={placeholder}
          value={value}
          onChange={(event) => update(event.target.value, event.target.selectionStart)}
          onKeyDown={onKeyDown}
        />
        <div className="ws-composer-bar">
          <span className="ws-hint">
            <Kbd>@</Kbd> agent or routine
          </span>
          <ComposerSkills data={data} agentIds={group.kind === 'private' ? [group.leadAgentId] : data.agents.filter(a => value.includes(`@${a.name}`)).map(a => a.id).length ? data.agents.filter(a => value.includes(`@${a.name}`)).map(a => a.id) : [group.leadAgentId]} value={value} onSelect={reference => { setValue(current => `${current}${current && !current.endsWith(' ') ? ' ' : ''}${reference}`); input.current?.focus(); }}/>
          {busy && onStop && (
            <button className="ws-btn ghost" onClick={onStop}>
              <Square size={12} /> Stop
            </button>
          )}
          <button
            className="ws-send"
            aria-label="Send"
            disabled={busy || !value.trim()}
            onClick={submit}
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
