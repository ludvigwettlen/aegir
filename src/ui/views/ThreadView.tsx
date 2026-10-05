import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { DocumentEditor, type DocumentEditorHandle } from './DocumentEditor';
import { withDocumentReference, type DocumentReference, type WorkspaceDocument } from '../../../shared/documents';
import { ChatMarkdown } from '../design-system/ChatMarkdown';
import { ConversationList } from '@usefragments/ui';
import { ArrowDownRight, ChevronRight, FilePenLine, FileText, FolderSearch, MessageSquare, Repeat2, Send, Square, X } from 'lucide-react';
import type { Agent, Group, Message, Routine, Snapshot, Step, Thread } from '../../../shared/types';
import { describeSchedule } from '../../../shared/routines';
import { reviewMirror, reviewRequest } from '../../../shared/review';
import { api, Avatar, time, YouAvatar, type Run } from './common';

import { useThreadMessages } from '../hooks/useThreadMessages';
import { SkillChangeCard } from './SkillChangeCard';
import { DraftCard } from './DraftCard';
import { CopyChatButton } from './CopyChatButton';
import { useSkillLibrary } from '../hooks/useSkillLibrary';
import { commandSkills, withSkillCommands } from '../../../shared/skill-commands';
import { mentionedAgents } from '../../../shared/agent-mentions';
import type { Skill } from '../../../shared/skills';

type Mention = { kind: 'agent'; agent: Agent } | { kind: 'routine'; routine: Routine } | { kind: 'skill'; skill: Skill };

export function ThreadView({
  data,
  thread,
  group,
  run,
  header,
  compact = false,
  beforeSend,
}: {
  data: Snapshot;
  thread: Thread;
  group: Group;
  run: Run;
  header?: ReactNode;
  compact?: boolean;
  // Called just before a message goes out, so the task panel can keep its task in view.
  beforeSend?: () => void;
}) {
  const { messages, hasOlder, loading, loadOlder } = useThreadMessages(thread.id, run);
  const [document, setDocument] = useState<WorkspaceDocument | null>(null);
  const [selection, setSelection] = useState<DocumentReference | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [showFiles, setShowFiles] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [opening, setOpening] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const fileAccess = useRef<HTMLDivElement>(null);
  const [chatWidth, setChatWidth] = useState(36);
  const [mobilePane, setMobilePane] = useState<'chat' | 'document'>('document');
  const documentEditor = useRef<DocumentEditorHandle>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const active = useRef(true);
  const openingRef = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!showFiles) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !fileAccess.current?.contains(event.target)) setShowFiles(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation();
      setShowFiles(false);
      fileAccess.current?.querySelector<HTMLButtonElement>('[data-document-files]')?.focus();
    };
    window.document.addEventListener('pointerdown', outside, true);
    window.document.addEventListener('focusin', outside);
    window.addEventListener('keydown', escape, true);
    return () => {
      window.document.removeEventListener('pointerdown', outside, true);
      window.document.removeEventListener('focusin', outside);
      window.removeEventListener('keydown', escape, true);
    };
  }, [showFiles]);
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
  // Asks the agent to open one file in human-review, the browser surface for editing and commenting on drafts.
  // Task conversations only: chats work in the app's own folder, read-only. Needs Claude Code for the skill, and
  // not on finished tasks, which a message would reopen.
  const threadTask = thread.kind === 'task' && data.engine === 'Claude Code' ? data.tasks.find(task => task.id === thread.taskId) : undefined;
  const reviewTask = threadTask && threadTask.status !== 'done' && threadTask.status !== 'dismissed' ? threadTask : undefined;
  const reviewDocument = (path: string) => {
    if (!reviewTask) return;
    setShowFiles(false);
    void run(async () => {
      if (documentEditor.current && !await documentEditor.current.save()) return;
      beforeSend?.();
      await api.sendMessage(thread.id, reviewRequest({ path, mirror: reviewMirror(path, reviewTask.createdAt) }));
    });
  };
  const filePicker = <div ref={fileAccess} className="ws-document-access">
    <button className="ws-btn ghost" data-document-files aria-expanded={showFiles} onClick={toggleFiles}><FileText size={14} />{opening ? 'Opening…' : 'Files'}</button>
    {showFiles && <div className="ws-document-files" aria-label="Workspace files">
      <strong>Markdown files</strong>
      {loadingFiles ? <p>Loading files…</p> : files.length ? files.map(path => <div key={path} className="ws-document-file-row">
        <button className="ws-btn ghost ws-document-file-open" disabled={opening} onClick={() => openDocument(path)}><FileText size={14} aria-hidden="true" /><span>{path}</span></button>
        {reviewTask && <button className="ws-icon-btn" aria-label={`Review ${path} in your browser`} title={busy ? 'Wait for the agent to finish, then review in your browser' : 'Review in browser: edit and comment, the agent applies your changes'}
          disabled={busy} onClick={() => reviewDocument(path)}><FilePenLine size={15} aria-hidden="true" /></button>}
        <button className="ws-icon-btn" aria-label={`Show ${path} in Finder`} title="Show in Finder" disabled={revealing} onClick={() => void run(async () => {
          setRevealing(true);
          try { await api.showDocumentInFinder(thread.id, path); if (active.current) setShowFiles(false); }
          finally { if (active.current) setRevealing(false); }
        })}><FolderSearch size={15} aria-hidden="true" /></button>
      </div>) : <p>No Markdown files in this workspace yet.</p>}
    </div>}
  </div>;
  return (
    <div ref={workspace} className={`ws-thread-workspace ${document ? 'document-open' : ''}`} data-mobile-pane={mobilePane}>
      {document ? <header className="ws-editing-head" role="banner" aria-label="Window header">
        <div className="ws-editing-context"><span title={group.title}>{group.kind === 'private' ? group.title : `# ${group.title}`}</span><ChevronRight size={13} aria-hidden="true" /><h2 title={thread.title}>{thread.title}</h2></div>
        <div className="ws-document-tabs"><button className="ws-btn" aria-pressed={mobilePane === 'chat'} onClick={() => setMobilePane('chat')}>Conversation</button><button className="ws-btn" aria-pressed={mobilePane === 'document'} onClick={() => setMobilePane('document')}>Document</button></div>
      </header> : <div className="ws-conversation-head">{header}<div className="ws-conversation-actions">{filePicker}<CopyChatButton key={thread.id} threadId={thread.id} disabled={!messages.length} /></div></div>}
      <div className="ws-thread-panes">
    <section
      style={document ? { flex: `0 0 ${chatWidth}%` } : undefined}
      className={`ws-thread ${compact ? 'compact' : ''}`}
      data-keyboard-pane="detail"
      tabIndex={-1}
      aria-label={`Thread: ${thread.title}`}
    >
      {document && <header className="ws-conversation-pane-head"><MessageSquare size={14} aria-hidden="true" /><h3>Conversation</h3><CopyChatButton key={thread.id} threadId={thread.id} disabled={!messages.length} /></header>}
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
        {foldEvents(messages).map((item) => item.kind === 'events'
          ? <EventFold key={item.messages[0].id} messages={item.messages} />
          : <MessageRow key={item.message.id} message={item.message} data={data} run={run} onOpenDocument={openDocument} />)}
      </ConversationList>
      {busy && (
        <div className="ws-chat-activity" role="status">
          <span className="ws-typing" aria-hidden="true"><i /><i /><i /></span>
          <span>Working…</span>
        </div>
      )}
      <Composer
        key={`composer-${thread.id}`}
        data={data}
        group={group}
        busy={busy}
        kind={thread.kind}
        placeholder={
          thread.kind === 'task' ? `Reply to ${data.agents.find((agent) => agent.id === group.leadAgentId)?.name || 'the agent'} on this task…` : 'Reply in thread…'
        }
        reference={selection}
        onClearReference={() => setSelection(null)}
        onSend={async (text) => {
          if (documentEditor.current && !await documentEditor.current.save()) { setMobilePane('document'); return false; }
          beforeSend?.();
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
        <DocumentEditor ref={documentEditor} key={document.path} document={document} threadId={thread.id} onClose={closeDocument} onSelection={setSelection} onOpenDocument={openDocument} headerActions={filePicker} />
      </>}
      </div>
    </div>
  );
}

// Runs of two or more plain system lines (approvals and hand-offs in older threads) fold into one toggle.
type ThreadItem = { kind: 'message'; message: Message } | { kind: 'events'; messages: Message[] };
function foldEvents(messages: Message[]): ThreadItem[] {
  const items: ThreadItem[] = [];
  for (const message of messages) {
    const last = items[items.length - 1];
    const event = message.role === 'system' && !message.meta;
    if (event && last?.kind === 'events') last.messages.push(message);
    else if (event && last?.kind === 'message' && last.message.role === 'system' && !last.message.meta) items[items.length - 1] = { kind: 'events', messages: [last.message, message] };
    else items.push({ kind: 'message', message });
  }
  return items;
}
function EventFold({ messages }: { messages: Message[] }) {
  return (
    <details className="ws-steps ws-event-fold">
      <summary><ChevronRight size={13} aria-hidden="true" />{messages.length} agent steps</summary>
      <ol>{messages.map((message) => <li key={message.id}><span>{message.content}</span><time>{time(message.createdAt)}</time></li>)}</ol>
    </details>
  );
}
// What the agent did for this reply, folded by default so the answer comes first.
function StepsFold({ steps, working }: { steps: Step[]; working: boolean }) {
  const approved = steps.filter((step) => step.kind === 'approval' && step.outcome === 'approved').length;
  const declined = steps.filter((step) => step.kind === 'approval' && step.outcome === 'declined').length;
  const summary = [`${steps.length} step${steps.length === 1 ? '' : 's'}`, approved ? `${approved} approved` : '', declined ? `${declined} declined` : ''].filter(Boolean).join(' · ');
  return (
    <details className="ws-steps">
      <summary><ChevronRight size={13} aria-hidden="true" />{working ? `Working · ${summary}` : summary}</summary>
      <ol>
        {steps.map((step, index) => (
          <li key={index} className={step.kind === 'approval' ? `approval ${step.outcome || ''}` : undefined}>
            <span>{step.kind === 'approval' ? `${step.outcome === 'declined' ? 'Declined' : 'Approved'}: ${step.label}` : step.label}</span>
            <time>{time(step.at)}</time>
          </li>
        ))}
      </ol>
    </details>
  );
}

function MessageRow({ message, data, run, onOpenDocument }: { message: Message; data: Snapshot; run: Run; onOpenDocument: (path: string) => void }) {
  if (message.meta?.type === 'skill-change')
    return <SkillChangeCard meta={message.meta} reason={message.content} />;
  if (message.meta?.type === 'routine-change')
    return <RoutineChangeCard message={message} data={data} run={run} />;
  if (message.meta?.type === 'message-draft')
    return <DraftCard message={message} draft={message.meta} agentName={data.agents.find((item) => item.id === message.agentId)?.name} run={run} />;
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
        {message.meta?.type === 'steps' && message.meta.steps.length > 0 && (
          <StepsFold steps={message.meta.steps} working={message.status === 'streaming'} />
        )}
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
  if (meta.type !== 'routine-change') return null;
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
  kind = 'chat',
}: {
  data: Snapshot;
  group: Group;
  busy: boolean;
  placeholder: string;
  onSend: (text: string) => Promise<void | boolean> | void;
  reference?: DocumentReference | null;
  onClearReference?: () => void;
  onStop?: () => void;
  kind?: 'chat' | 'task';
}) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [sendError, setSendError] = useState('');
  const [picker, setPicker] = useState<{ kind: 'mention' | 'skill'; query: string; start: number; end: number } | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<Skill[]>([]);
  const { library, error: skillError, reload } = useSkillLibrary();
  const availableSkills = commandSkills(library?.skills || [], mentionedAgents(value, data.agents, group).map(agent => agent.id), kind);
  const invalidSelection = selectedSkills.some(skill => !availableSkills.some(item => item.id === skill.id));
  const pickerId = useId();
  const [active, setActive] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const options = useMemo<Mention[]>(() => {
    if (!picker) return [];
    const q = picker.query.toLowerCase();
    if (picker.kind === 'skill') return availableSkills
      .filter(skill => !selectedSkills.some(item => item.id === skill.id)
        && `${skill.name} ${skill.description}`.toLowerCase().includes(q))
      .slice(0, 8).map(skill => ({ kind: 'skill', skill }));
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
  }, [picker, data.agents, data.routines, group.agentIds, library, value, selectedSkills, kind]);
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));
  useEffect(() => {
    if (picker) document.getElementById(`${pickerId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [picker, pickerId, activeIndex]);
  const update = (text: string, caret: number) => {
    setValue(text);
    const command = text.slice(0, caret).match(/(^|\s)\/([\w-]*)$/);
    if (command) {
      setPicker({ kind: 'skill', query: command[2], start: caret - command[2].length - 1, end: caret });
      setActive(0);
      return;
    }
    // Routine names contain spaces, so the query may too; a trailing space closes the picker.
    const match = text.slice(0, caret).match(/(^|\s)@([\w ]{0,30})$/);
    const query = match?.[2];
    if (query !== undefined && !query.endsWith(' ')) {
      setPicker({ kind: 'mention', query, start: caret - query.length - 1, end: caret });
      setActive(0);
    } else setPicker(null);
  };
  const choose = (option: Mention) => {
    if (!picker) return;
    const insertion = option.kind === 'skill' ? '' : `@${option.kind === 'agent' ? option.agent.name : option.routine.name} `;
    if (option.kind === 'skill') setSelectedSkills(previous => [...previous.filter(skill => skill.id !== option.skill.id), option.skill]);
    const next = `${value.slice(0, picker.start)}${insertion}${value.slice(picker.end)}`;
    setValue(next);
    setPicker(null);
    requestAnimationFrame(() => {
      const at = picker.start + insertion.length;
      input.current?.setSelectionRange(at, at);
      input.current?.focus();
    });
  };
  const submit = async () => {
    const draft = value;
    const skills = selectedSkills;
    const text = withSkillCommands(draft, skills);
    if (!text || busy || sendingRef.current || invalidSelection) return;
    sendingRef.current = true;
    setSending(true); setSendError('');
    setValue(''); setPicker(null); setSelectedSkills([]);
    input.current?.focus();
    // Keep any follow-up typed while saving, including when the send is rejected.
    const restoreDraft = () => {
      setValue(next => next ? `${draft}\n\n${next}` : draft);
      setSelectedSkills(next => [...skills, ...next.filter(skill => !skills.some(item => item.id === skill.id))]);
    };
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
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) setPicker(null);
    if (picker && event.key === 'Escape') {
      event.preventDefault(); setPicker(null); return;
    }
    if (picker?.kind === 'skill' && !options.length && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault(); return;
    }
    if (picker && options.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((activeIndex + 1) % options.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((activeIndex - 1 + options.length) % options.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        choose(options[activeIndex]);
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
      {picker && (options.length > 0 || picker.kind === 'skill') && (
        <div className="ws-picker" id={pickerId} role="listbox" aria-label={picker.kind === 'skill' ? 'Skills' : 'Mention'}>
          {picker.kind === 'skill' && <>
            <div className="ws-picker-label">SKILLS</div>
            {skillError ? <div className="ws-picker-state" role="alert">Could not load skills. <button onClick={() => void reload()}>Retry</button></div>
              : !library ? <p className="ws-picker-state" role="status">Loading skills…</p>
              : !options.length && <p className="ws-picker-state" role="status">No matching skills for this conversation.</p>}
            {options.map((option, index) => option.kind === 'skill' && <button
              key={option.skill.id} id={`${pickerId}-${index}`} role="option" aria-selected={index === activeIndex}
              className={`ws-skill-option ${index === activeIndex ? 'active' : ''}`}
              onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}>
              <span><strong>/{option.skill.name}</strong><small>{option.skill.description}</small></span>
              <small>{option.skill.ownerAgentId ? data.agents.find(agent => agent.id === option.skill.ownerAgentId)?.name : 'Shared'}</small>
            </button>)}
          </>}
          {routines.length > 0 && <div className="ws-picker-label">ROUTINES</div>}
          {routines.map((option) => {
            const index = options.indexOf(option);
            const routine = (option as { routine: Routine }).routine;
            return (
              <button
                key={routine.id}
                id={`${pickerId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? 'active' : ''}
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
                id={`${pickerId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? 'active' : ''}
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
        {selectedSkills.length > 0 && <div className="ws-selected-skills" aria-label="Selected skills">
          {selectedSkills.map(skill => <span key={skill.id}>/{skill.name}<button type="button" className="ws-icon-btn"
            aria-label={`Remove skill ${skill.name}`} onClick={() => setSelectedSkills(items => items.filter(item => item.id !== skill.id))}><X size={12} /></button></span>)}
        </div>}
        {invalidSelection && <p role="alert">A selected skill is unavailable for the current recipients. Remove it or change the @mention.</p>}
        {reference && <div className="ws-document-reference"><div><strong>{reference.path}</strong><blockquote>{reference.text}</blockquote></div><button className="ws-icon-btn" aria-label="Remove selected passage" onClick={onClearReference}><X size={13} /></button></div>}
        {sendError && <p role="alert">{sendError}</p>}
        <textarea
          ref={input}
          aria-label="Message"
          aria-controls={picker ? pickerId : undefined}
          aria-expanded={!!picker}
          aria-autocomplete="list"
          aria-activedescendant={picker && options.length ? `${pickerId}-${activeIndex}` : undefined}
          rows={2}
          placeholder={placeholder}
          value={value}
          onChange={(event) => update(event.target.value, event.target.selectionStart)}
          onClick={() => setPicker(null)}
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
            disabled={busy || sending || invalidSelection || (!value.trim() && !selectedSkills.length)}
            onClick={submit}
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
