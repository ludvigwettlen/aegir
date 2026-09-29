import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { DocumentEditor, type DocumentEditorHandle } from './DocumentEditor';
import { withDocumentReference, type DocumentReference, type WorkspaceDocument } from '../../../shared/documents';
import { ChatMarkdown } from '../design-system/ChatMarkdown';
import { ConversationList } from '@usefragments/ui';
import { ArrowDownRight, FileText, Repeat2, Send, Square, X } from 'lucide-react';
import type { Agent, Group, Message, Routine, Snapshot, Thread } from '../../../shared/types';
import { describeSchedule } from '../../../shared/routines';
import { api, Avatar, time, YouAvatar, type Run } from './common';

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
  const [document, setDocument] = useState<WorkspaceDocument | null>(null);
  const [selection, setSelection] = useState<DocumentReference | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [showFiles, setShowFiles] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [opening, setOpening] = useState(false);
  const [chatWidth, setChatWidth] = useState(36);
  const [mobilePane, setMobilePane] = useState<'chat' | 'document'>('document');
  const documentEditor = useRef<DocumentEditorHandle>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const active = useRef(true);
  const openingRef = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const openDocument = (path: string) => {
    if (openingRef.current) return;
    opener.current = window.document.activeElement as HTMLElement;
    openingRef.current = true; setOpening(true);
    void run(async () => {
      try {
        if (documentEditor.current && !await documentEditor.current.save()) return;
        const file = await api.readDocument(thread.id, path);
        if (!active.current) return;
        setDocument(file); setSelection(null); setShowFiles(false); setMobilePane('document');
        requestAnimationFrame(() => workspace.current?.querySelector<HTMLElement>('[data-keyboard-pane="document"]')?.focus());
      } finally { openingRef.current = false; if (active.current) setOpening(false); }
    });
  };
  const closeDocument = () => {
    setDocument(null); setSelection(null);
    requestAnimationFrame(() => {
      if (opener.current?.isConnected && opener.current.getClientRects().length) opener.current.focus();
      else workspace.current?.querySelector<HTMLElement>('[data-document-files]')?.focus();
    });
  };
  const toggleFiles = () => {
    if (showFiles) { setShowFiles(false); return; }
    setShowFiles(true); setLoadingFiles(true);
    void run(async () => {
      try { const items = await api.listDocuments(thread.id); if (active.current) setFiles(items); }
      finally { if (active.current) setLoadingFiles(false); }
    });
  };
  const busy =
    messages.some((message) => message.status === 'streaming') ||
    !!data.threads.find((item) => item.id === thread.id)?.busyAgentIds.length;
  const filePicker = <div className="ws-document-access">
    <button className="ws-btn ghost" data-document-files aria-expanded={showFiles} onClick={toggleFiles}><FileText size={14} />{opening ? 'Opening…' : 'Files'}</button>
    {showFiles && <div className="ws-document-files" aria-label="Workspace files">
      <strong>Markdown files</strong>
      {loadingFiles ? <p>Loading files…</p> : files.length ? files.map(path => <button key={path} className="ws-btn ghost" disabled={opening} onClick={() => openDocument(path)}><FileText size={14} />{path}</button>) : <p>No Markdown files in this workspace yet.</p>}
    </div>}
  </div>;
  return (
    <div ref={workspace} className={`ws-thread-workspace ${document ? 'document-open' : ''}`} data-mobile-pane={mobilePane}>
      {document ? <header className="ws-editing-head">
        <div><span>{group.kind === 'private' ? group.title : `# ${group.title}`}</span><h2>{thread.title}</h2></div>
        <div className="ws-document-tabs"><button className="ws-btn" aria-pressed={mobilePane === 'chat'} onClick={() => setMobilePane('chat')}>Conversation</button><button className="ws-btn" aria-pressed={mobilePane === 'document'} onClick={() => setMobilePane('document')}>Document</button></div>
      </header> : <div className="ws-conversation-head">{header}{filePicker}</div>}
      <div className="ws-thread-panes">
    <section
      style={document ? { flex: `0 0 ${chatWidth}%` } : undefined}
      className={`ws-thread ${compact ? 'compact' : ''}`}
      data-keyboard-pane="detail"
      tabIndex={-1}
      aria-label={`Thread: ${thread.title}`}
    >
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
          <MessageRow key={message.id} message={message} data={data} run={run} onOpenDocument={openDocument} />
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
        reference={selection}
        onClearReference={() => setSelection(null)}
        onSend={async (text) => {
          if (documentEditor.current && !await documentEditor.current.save()) { setMobilePane('document'); return false; }
          await api.sendMessage(thread.id, withDocumentReference(text, selection));
          setSelection(null);
          return true;
        }}
        onStop={() => run(() => api.stopThread(thread.id))}
      />
    </section>
      {document && <>
        <div className="ws-document-divider" role="separator" tabIndex={0} aria-label="Resize conversation" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={55} aria-valuenow={chatWidth}
          onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { const rect = event.currentTarget.parentElement!.getBoundingClientRect(); setChatWidth(Math.max(25, Math.min(55, (event.clientX - rect.left) / rect.width * 100))); } }}
          onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)}
          onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setChatWidth(value => Math.max(25, Math.min(55, value + (event.key === 'ArrowRight' ? 2 : -2)))); } }} />
        <DocumentEditor ref={documentEditor} key={document.path} document={document} threadId={thread.id} onClose={closeDocument} onSelection={setSelection} headerActions={filePicker} />
      </>}
      </div>
    </div>
  );
}

function MessageRow({ message, data, run, onOpenDocument }: { message: Message; data: Snapshot; run: Run; onOpenDocument: (path: string) => void }) {
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
            <ChatMarkdown content={message.content} onOpenDocument={onOpenDocument} onOpenLink={url => void run(() => api.openExternal(url))} />
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
  reference,
  onClearReference,
}: {
  data: Snapshot;
  group: Group;
  busy: boolean;
  placeholder: string;
  onSend: (text: string) => Promise<void | boolean> | void;
  reference?: DocumentReference | null;
  onClearReference?: () => void;
  onStop?: () => void;
}) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [sendError, setSendError] = useState('');
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
  const submit = async () => {
    const draft = value;
    const text = draft.trim();
    if (!text || busy || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true); setSendError('');
    setValue(''); setPicker(null);
    input.current?.focus();
    // Keep any follow-up typed while saving, including when the send is rejected.
    const restoreDraft = () => setValue(next => next ? `${draft}\n\n${next}` : draft);
    try {
      const sent = await onSend(text);
      if (sent === false) restoreDraft();
    } catch (cause) {
      restoreDraft();
      setSendError(String(cause));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
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
    if (event.key === 'Escape' && !event.currentTarget.closest('.ws-tasks')) {
      const list = event.currentTarget.closest('.ws-group')?.querySelector<HTMLElement>('[data-keyboard-pane="list"]');
      if (list) {
        event.preventDefault();
        (list.querySelector<HTMLElement>('[data-keyboard-current]') ||
          list.querySelector<HTMLElement>('[data-keyboard-item]') || list).focus();
      }
      return;
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
        {reference && <div className="ws-document-reference"><div><strong>{reference.path}</strong><blockquote>{reference.text}</blockquote></div><button className="ws-icon-btn" aria-label="Remove selected passage" onClick={onClearReference}><X size={13} /></button></div>}
        {sendError && <p role="alert">{sendError}</p>}
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
          {busy && onStop && (
            <button className="ws-btn ghost" onClick={onStop}>
              <Square size={12} /> Stop
            </button>
          )}
          <button
            className="ws-send"
            aria-label="Send"
            disabled={busy || sending || !value.trim()}
            onClick={submit}
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
