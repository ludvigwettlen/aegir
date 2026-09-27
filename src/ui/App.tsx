import { useEffect, useState } from 'react';
import { Activity, ArrowRight, Check, ChevronDown, CircleHelp, Clock3, Compass, Cpu, ExternalLink, FileText, MemoryStick, Plus, Settings2, ShieldCheck, Sparkles, SquareArrowOutUpRight, X } from 'lucide-react';
import type { Agent, Approval, Message, Room, Snapshot, Task } from '../../shared/types';
import { modelTierForRole } from '../../shared/model-policy';
import { ChatBubble, ChatComposer, ChatConversation, ChatEvent } from './design-system/chat';
import { Badge, Button, Card, ToggleGroup } from './design-system/primitives';
import { TaskEmptyState, TaskListNav, TaskQuickAdd, TaskStatus, type TaskList } from './design-system/tasks';

type View = 'chat' | 'tasks' | 'review' | 'memory' | 'settings';
const api = window.agentDesk;
const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const date = (value: string) => new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
function avatar(agent?: Agent, size = 'normal') { return <span className={`avatar ${size}`} style={{ '--agent-color': agent?.color || '#8a8b95' } as React.CSSProperties}>{agent?.name.slice(0, 1) || '?'}</span>; }
function linkedText(value: string) { return value.split(/(https?:\/\/[^\s<>]+)/g).map((part, index) => /^https?:\/\//.test(part) ? <a key={index} href={part} onClick={event => { event.preventDefault(); void api.openExternal(part); }}>{part}</a> : part); }

export function App() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [view, setView] = useState<View>('tasks');
  const [taskTab, setTaskTab] = useState<TaskList>('active');
  const [roomId, setRoomId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showNewRoom, setShowNewRoom] = useState(false);
  useEffect(() => {
    void api.snapshot().then(value => { setData(value); setRoomId(value.rooms[0]?.id || ''); });
    return api.onEvent(event => {
      if (event.type === 'snapshot') setData(event.value);
      if (event.type === 'message-delta') setData(current => current ? { ...current, messages: current.messages.map(message => message.id === event.messageId ? { ...message, content: message.content + event.delta } : message) } : current);
    });
  }, []);
  const run = async (action: () => Promise<unknown>) => { setError(''); try { await action(); } catch (cause) { setError(String(cause)); } };
  const room = data?.rooms.find(x => x.id === roomId) || data?.rooms[0];
  const agents = data?.agents || [];
  const proposed = data?.tasks.filter(x => x.status === 'proposed').length || 0;
  if (!data) return <div className="loading"><span className="brand-mark"><Sparkles size={20}/></span> Loading Agent Desk…</div>;
  const send = async (text: string) => { if (!room) return; setBusy(true); try { await run(() => api.sendMessage(room.id, text)); } finally { setBusy(false); } };
  return <div className={`app-shell view-${view}`}>
    <header className="app-header">
      <div className="brand"><span className="brand-mark"><Sparkles size={16}/></span><strong>agent desk</strong></div>
      <ToggleGroup className="app-tabs" aria-label="Workspace" variant="soft" size="lg" value={view === 'tasks' || view === 'chat' || view === 'review' ? view : ''} onChange={next => { if (next === 'tasks' || next === 'chat' || next === 'review') setView(next); }}><ToggleGroup.Item value="tasks">Tasks</ToggleGroup.Item><ToggleGroup.Item value="chat">Chat</ToggleGroup.Item><ToggleGroup.Item value="review">Routines</ToggleGroup.Item></ToggleGroup>
      <div className="app-header-tools"><button className={view === 'memory' ? 'active' : ''} title="Memory" aria-label="Memory" onClick={() => setView('memory')}><MemoryStick size={17}/></button><button className={view === 'settings' ? 'active' : ''} title="Settings" aria-label="Settings" onClick={() => setView('settings')}><Settings2 size={17}/></button><span className={`header-connection ${data.connectors.some(x => x.status === 'connected') ? 'connected' : ''}`} title={`${data.connectors.filter(x => x.status === 'connected').length} of 2 sources connected`}/></div>
    </header>
    <div className="workspace-body">
      {view === 'tasks' && <>
        <TaskListNav selected={taskTab} proposedCount={proposed} activeCount={data.tasks.filter(x => ['ready','running','blocked'].includes(x.status)).length} onSelect={setTaskTab}/>
        <main className="task-pane"><TasksView data={data} run={run} tab={taskTab}/></main>
        {room && <aside className="context-chat"><ChatView compact data={data} room={room} busy={busy} onSend={send} onSettings={() => setView('settings')} onRoomChange={setRoomId}/></aside>}
      </>}
      {view === 'chat' && <><aside className="room-rail"><div className="rail-heading"><span>ROOMS</span><Button variant="ghost" size="sm" icon aria-label="New room" onClick={() => setShowNewRoom(true)}><Plus size={16}/></Button></div>{data.rooms.map(item => <button key={item.id} className={`room-choice ${room?.id === item.id ? 'selected' : ''}`} onClick={() => setRoomId(item.id)}><span>#</span>{item.title}</button>)}<div className="rail-divider"/><span className="rail-label">AGENTS</span>{agents.map(agent => <div className="rail-agent" key={agent.id}>{avatar(agent, 'small')}<span><strong>{agent.name}</strong><small>{agent.role}</small></span></div>)}</aside><main className="standalone-chat">{room && <ChatView data={data} room={room} busy={busy} onSend={send} onSettings={() => setView('settings')} onRoomChange={setRoomId}/>}</main><aside className="artifact-pane"><div className="artifact-title">Sources & artifacts</div><p>Links and work produced in this room will be easy to revisit here.</p>{[...new Set(data.messages.filter(x => x.roomId === room?.id).flatMap(x => x.content.match(/https?:\/\/[^\s<>]+/g) || []))].slice(-8).map(url => <button key={url} onClick={() => void run(() => api.openExternal(url))}><ExternalLink size={14}/><span>{url}</span></button>)}</aside></>}
      {view === 'review' && <><aside className="routine-rail"><span className="rail-label">MY ROUTINES</span><div className="routine-choice selected"><span className="routine-glyph"><Activity size={16}/></span><span><strong>Hourly discovery</strong><small>Slack + Notion review</small></span></div><div className="rail-divider"/><span className="rail-label">SOURCES</span>{data.connectors.map(connector => <div className="routine-source" key={connector.id}><span className={`source-health ${connector.status}`}/><span>{connector.id === 'slack' ? 'Slack' : 'Notion'}</span><small>{connector.status}</small></div>)}<div className="rail-footer"><Clock3 size={14}/><span>Runs while Mac is awake</span></div></aside><main className="routine-pane"><ReviewView data={data} run={run}/></main>{room && <aside className="context-chat"><ChatView compact data={data} room={room} busy={busy} onSend={send} onSettings={() => setView('settings')} onRoomChange={setRoomId}/></aside>}</>}
      {view === 'memory' && <main className="full-page"><MemoryView data={data} run={run}/></main>}
      {view === 'settings' && <main className="full-page"><SettingsView data={data} run={run}/></main>}
    </div>
    {data.approvals.length > 0 && <ApprovalDock approvals={data.approvals} run={run}/>}
    {error && <div className="error-toast"><span>{error}</span><button className="bare" onClick={() => setError('')}><X size={15}/></button></div>}
    {showNewRoom && <NewRoomModal agents={agents} onClose={() => setShowNewRoom(false)} onCreate={(title, lead) => run(async () => { await api.createRoom(title, lead); const updated = await api.snapshot(); setRoomId(updated.rooms[0].id); setView('chat'); setShowNewRoom(false); })}/>}
  </div>;
}

function ChatView({ data, room, busy, compact = false, onSend, onSettings, onRoomChange }: { data: Snapshot; room: Room; busy: boolean; compact?: boolean; onSend: (text: string) => Promise<void>; onSettings: () => void; onRoomChange: (roomId: string) => void }) {
  const [input, setInput] = useState('');
  const messages = data.messages.filter(x => x.roomId === room.id);
  const lead = data.agents.find(x => x.id === room.leadAgentId);
  const send = (value: string) => { const text = value.trim(); if (text) { setInput(''); void onSend(text); } };
  return <div className={`chat-view ${compact ? 'compact-chat' : ''}`}>
    <header className="topbar"><div className="topbar-title"><span className="hash-lg">#</span><div><div className="room-picker"><select className="room-select" aria-label="Active room" value={room.id} onChange={event => onRoomChange(event.target.value)}>{data.rooms.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select><ChevronDown size={13} aria-hidden="true"/></div><p>Led by {lead?.name || 'an agent'} · {data.agents.length} agents available</p></div></div><div className="topbar-actions"><div className="presence-stack">{data.agents.slice(0, 3).map(agent => <span key={agent.id} title={agent.name}>{avatar(agent, 'tiny')}</span>)}</div><button className="topbar-button" aria-label="Agent settings" onClick={onSettings}><Settings2 size={16}/> Agents</button></div></header>
    <ChatConversation roomId={room.id} emptyState={compact ? <div className="context-empty" aria-label="No messages in this room yet"><Sparkles size={33}/></div> : <div className="empty-chat"><div className="empty-orbit"><span className="brand-mark large"><Sparkles size={26}/></span></div><span className="eyebrow">A SPACE TO THINK TOGETHER</span><h2>Good things start with a conversation.</h2><p>Ask {lead?.name || 'your lead agent'} anything, or bring a specialist in with @mention. Your agents share this room and keep their work visible.</p><div className="suggestions"><button onClick={() => setInput('Help me plan my week based on my recent work')}>Plan my week <ArrowRight size={14}/></button><button onClick={() => setInput('Search Slack for decisions I may have missed')}>Find recent decisions <ArrowRight size={14}/></button><button onClick={() => setInput('/goal Summarize my latest meeting transcripts')}>Start a goal <ArrowRight size={14}/></button></div></div>}>
      {messages.map(message => <MessageCard key={message.id} message={message} agent={data.agents.find(x => x.id === message.agentId)}/>)}
    </ChatConversation>
    <ChatComposer value={input} onChange={setInput} onSubmit={send} onStop={() => void api.stopRoom(room.id)} leadName={lead?.name || 'your agents'} busy={busy}/>
  </div>;
}
function MessageCard({ message, agent }: { message: Message; agent?: Agent }) {
  if (message.role === 'system') return <ChatEvent>{message.content}</ChatEvent>;
  return <ChatBubble variant={message.role === 'user' ? 'user' : 'agent'} author={message.role === 'user' ? 'You' : agent?.name || 'Agent'} role={message.role === 'user' ? undefined : agent?.role} timestamp={time(message.createdAt)} status={message.status} avatar={avatar(agent)}>
    {message.content ? linkedText(message.content) : <span className="typing"><i/><i/><i/></span>}
  </ChatBubble>;
}

function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) { return <header className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div><div className="page-actions">{actions}</div></header>; }

function TasksView({ data, run, tab }: { data: Snapshot; run: (action: () => Promise<unknown>) => Promise<void>; tab: TaskList }) {
  const [newTask, setNewTask] = useState('');
  const groups = { proposed: data.tasks.filter(x => x.status === 'proposed'), active: data.tasks.filter(x => ['ready','running','blocked'].includes(x.status)), done: data.tasks.filter(x => x.status === 'done') };
  return <div className="page-scroll task-page"><header className="task-heading"><h1>{tab === 'active' ? 'Upcoming' : tab === 'proposed' ? 'Inbox' : 'Completed'}</h1></header>
    <div className="content-panel task-content">
      <TaskQuickAdd value={newTask} onChange={setNewTask} onSubmit={() => { void run(() => api.createTask(newTask.trim(), '')); setNewTask(''); }}/>
      {groups[tab].length ? <div className="task-list">{groups[tab].map(task => <TaskRow key={task.id} task={task} agents={data.agents} goal={data.goals.find(goal => goal.taskId === task.id)} run={run}/>)}</div> : <TaskEmptyState list={tab}/>}
    </div></div>;
}
function TaskRow({ task, agents, goal, run }: { task: Task; agents: Agent[]; goal?: Snapshot['goals'][number]; run: (action: () => Promise<unknown>) => Promise<void> }) {
  const [selected, setSelected] = useState(task.agentId || agents[0]?.id || '');
  const [editing, setEditing] = useState(false); const [title, setTitle] = useState(task.title); const [notes, setNotes] = useState(task.notes);
  return <div className="task-row">
    <TaskStatus status={task.status}/>
    <div className="task-main">
      {editing ? <div className="inline-editor">
        <input aria-label="Task title" value={title} onChange={e => setTitle(e.target.value)}/>
        <textarea aria-label="Task notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3}/>
        <Button size="sm" disabled={!title.trim()} onClick={() => void run(async () => { await api.updateTask(task.id, { title: title.trim(), notes: notes.trim() }); setEditing(false); })}>Save changes</Button>
        <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
      </div> : <>
        <div className="task-row-title"><strong>{task.title}</strong>{task.status === 'running' && <Badge size="sm" tone="info">Running</Badge>}{task.status === 'blocked' && <Badge size="sm" tone="warning">Blocked</Badge>}</div>
        {task.notes && <p>{task.notes}</p>}
      </>}
      <div className="task-meta"><span>{date(task.createdAt)}</span>{task.sourceUrl && <Button variant="link" size="sm" onClick={() => void run(() => api.openExternal(task.sourceUrl!))}><ExternalLink size={12}/> Source</Button>}{goal && <span className={`goal-label ${goal.status}`}>{goal.status.replace('_', ' ')}</span>}</div>
      {goal?.detail && <p className="goal-detail">{goal.detail.slice(-600)}</p>}
    </div>
    {!editing && <div className="task-actions">
      {['proposed','ready','blocked'].includes(task.status) && <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit</Button>}
      {task.status === 'proposed' ? <>
        <Button size="sm" onClick={() => void run(() => api.updateTask(task.id,{status:'ready'}))}>Accept</Button>
        <Button variant="ghost" size="sm" icon aria-label="Dismiss task" title="Dismiss" onClick={() => void run(() => api.updateTask(task.id,{status:'dismissed'}))}><X size={15}/></Button>
      </> : task.status === 'ready' || task.status === 'blocked' ? <>
        <select aria-label="Assign agent" value={selected} onChange={e => setSelected(e.target.value)}>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>
        <Button size="sm" onClick={() => void run(() => api.startGoal(task.id, selected))}>Start goal <ArrowRight size={13}/></Button>
      </> : task.status === 'running' ? <Button variant="outline" size="sm" onClick={() => void run(() => api.stopGoal(task.id))}>Stop</Button> : null}
    </div>}
  </div>;
}

function ReviewView({ data, run }: { data: Snapshot; run: (action: () => Promise<unknown>) => Promise<void> }) {
  const scans = data.scans;
  const proposed = data.tasks.filter(x => x.status === 'proposed');
  return <div className="page-scroll routine-page"><PageHeader eyebrow="MY ROUTINES" title="Hourly discovery" description="A best-effort search for decisions, commitments, and follow-ups." actions={<Button size="sm" onClick={() => void run(() => api.runReview())}><Sparkles size={15}/> Review now</Button>}/>
    <div className="callout"><Compass size={19}/><div><strong>A discovery feed, not a complete record.</strong><p>Searches surface likely decisions, commitments, and follow-ups. Each finding links to its source so you can check the context.</p></div></div>
    <div className="section-heading"><h2>Needs your attention <span>{proposed.length}</span></h2></div>
    {proposed.length ? <div className="review-cards">{proposed.map(task => <Card className="review-card" variant="outline" padding="md" key={task.id}><span className="review-spark"><Sparkles size={18}/></span><div><small>PROPOSED TASK · {date(task.createdAt)}</small><h3>{task.title}</h3><p>{task.notes}</p><div className="review-card-actions"><Button size="sm" onClick={() => void run(() => api.updateTask(task.id,{status:'ready'}))}>Add to tasks <ArrowRight size={13}/></Button><Button variant="ghost" size="sm" onClick={() => void run(() => api.updateTask(task.id,{status:'dismissed'}))}>Dismiss</Button>{task.sourceUrl && <Button variant="link" size="sm" onClick={() => void run(() => api.openExternal(task.sourceUrl!))}>View source <ExternalLink size={12}/></Button>}</div></div></Card>)}</div> : <div className="panel-empty wide"><span className="empty-icon"><Check size={23}/></span><h3>All caught up for now</h3><p>New suggestions from scheduled reviews will appear here.</p></div>}
    <div className="section-heading spaced"><h2>Search history</h2><span>Latest 60 scans</span></div>
    <div className="history-list">{scans.length ? scans.map(scan => <div className="history-row" key={scan.id}><span className={`source-badge ${scan.provider}`}>{scan.provider === 'slack' ? '#' : <FileText size={14}/>}</span><div><strong>{scan.query}</strong><small>{scan.provider} · {date(scan.startedAt)} at {time(scan.startedAt)}{scan.error ? ` · ${scan.error}` : ''}</small></div><Badge size="sm" tone={scan.status === 'complete' ? 'success' : scan.status === 'failed' ? 'danger' : 'info'}>{scan.status === 'complete' ? `${scan.created} tasks` : scan.status}</Badge></div>) : <div className="panel-empty compact">No scans yet. Connect a source or run a review.</div>}</div>
  </div>;
}

function MemoryView({ data, run }: { data: Snapshot; run: (action: () => Promise<unknown>) => Promise<void> }) {
  const [instructions, setInstructions] = useState(data.memoryInstructions);
  useEffect(() => setInstructions(data.memoryInstructions), [data.memoryInstructions]);
  return <div className="page-scroll supporting-page"><PageHeader eyebrow="WORKSPACE / MEMORY" title="Memory" description="The durable context your agents carry forward." actions={<Badge tone="info">{data.memories.length} memories</Badge>}/>
    <div className="memory-layout"><Card className="content-panel" variant="outline" padding="none" as="section"><div className="panel-heading"><div><h2>Saved memories</h2><p>Automatically selected from review and agent work.</p></div><MemoryStick size={19}/></div>{data.memories.length ? <div className="memory-list">{data.memories.map(item => <MemoryRow key={item.id} item={item} run={run}/>)}</div> : <div className="panel-empty"><span className="empty-icon"><MemoryStick size={22}/></span><h3>Memories will collect here</h3><p>As your agents review work, they’ll keep useful facts and decisions.</p></div>}</Card>
    <Card className="instruction-card" variant="outline" padding="md" as="section"><span className="eyebrow">MEMORY GUIDANCE</span><h3>What should agents keep?</h3><p>These instructions guide automatic memory writing. You can refine them as you learn what works.</p><textarea aria-label="Memory instructions" value={instructions} onChange={e => setInstructions(e.target.value)} rows={10}/><Button fullWidth disabled={instructions === data.memoryInstructions} onClick={() => void run(() => api.setMemoryInstructions(instructions))}>Save instructions</Button><div className="subtle-note"><CircleHelp size={14}/> Mnemosyne is used when available; memories also stay in the local app database.</div></Card></div>
  </div>;
}

function MemoryRow({ item, run }: { item: Snapshot['memories'][number]; run: (action: () => Promise<unknown>) => Promise<void> }) {
  const [editing, setEditing] = useState(false); const [content, setContent] = useState(item.content);
  return <div className="memory-row"><span className="memory-orb"><Sparkles size={15}/></span><div>{editing ? <div className="inline-editor"><textarea aria-label="Correct memory" value={content} onChange={e => setContent(e.target.value)} rows={3}/><Button size="sm" disabled={!content.trim()} onClick={() => void run(async () => { await api.correctMemory(item.id, content); setEditing(false); })}>Save correction</Button><Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button></div> : <p>{item.content}</p>}<small>{item.scope} · {date(item.createdAt)} {item.sourceUrl && <button onClick={() => void run(() => api.openExternal(item.sourceUrl!))}>Source <ExternalLink size={11}/></button>}</small></div><Button variant="outline" size="sm" onClick={() => setEditing(true)}>Correct</Button><Button variant="ghost" size="sm" icon aria-label="Forget memory" onClick={() => void run(() => api.forgetMemory(item.id))}><X size={15}/></Button></div>;
}

function SettingsView({ data, run }: { data: Snapshot; run: (action: () => Promise<unknown>) => Promise<void> }) {
  const [clientId, setClientId] = useState(data.mcpSettings.slackClientId); const [clientSecret, setClientSecret] = useState('');
  const [editing, setEditing] = useState<string | null>(null); const [draft, setDraft] = useState<Agent | null>(null);
  const [newName, setNewName] = useState(''); const [newRole, setNewRole] = useState('');
  const slack = data.connectors.find(x => x.id === 'slack')!; const notion = data.connectors.find(x => x.id === 'notion')!;
  return <div className="page-scroll supporting-page"><PageHeader eyebrow="WORKSPACE / SETTINGS" title="Your workspace" description="Shape your agents, connect your sources, and choose how the app runs."/>
    <div className="settings-grid"><div className="settings-main"><Card className="content-panel settings-panel" variant="outline" padding="none" as="section"><div className="panel-heading"><div><h2>Connections</h2><p>The same MCP connections serve chat and scheduled review.</p></div><SquareArrowOutUpRight size={18}/></div>
      <div className="connector-row"><span className="connector-icon slack">#</span><div><strong>Slack</strong><Badge size="sm" tone={slack.status === 'connected' ? 'success' : slack.status === 'error' ? 'danger' : 'neutral'} dot>{slack.status}</Badge><small className="connector-detail">{slack.detail}</small></div><Button variant="outline" size="sm" onClick={() => void run(() => api.connect('slack', clientId, clientSecret))}>{slack.status === 'connected' ? 'Reconnect' : 'Connect'}</Button></div>
      {slack.status !== 'connected' && <div className="connector-setup"><p>Use an internal Slack app with MCP enabled. Set its OAuth redirect URL to <code>http://127.0.0.1:8765/callback/slack</code>.</p><div className="form-row"><input placeholder="Slack Client ID" value={clientId} onChange={e => setClientId(e.target.value)}/><input type="password" placeholder="Client Secret" value={clientSecret} onChange={e => setClientSecret(e.target.value)}/></div><button className="link-button" onClick={() => void run(() => api.openExternal('https://api.slack.com/apps'))}>Open Slack app settings <ExternalLink size={12}/></button></div>}
      <div className="connector-row"><span className="connector-icon notion">N</span><div><strong>Notion</strong><Badge size="sm" tone={notion.status === 'connected' ? 'success' : notion.status === 'error' ? 'danger' : 'neutral'} dot>{notion.status}</Badge><small className="connector-detail">{notion.detail}</small></div><Button variant="outline" size="sm" onClick={() => void run(() => api.connect('notion'))}>{notion.status === 'connected' ? 'Reconnect' : 'Connect'}</Button></div>
      <div className="connector-note"><ShieldCheck size={15}/> OAuth tokens and secrets are encrypted with macOS Keychain-backed storage.</div>
    </Card>
    <Card className="content-panel settings-panel" variant="outline" padding="none" as="section"><div className="panel-heading"><div><h2>Agent personalities</h2><p>Each agent has a role and its own instructions.</p></div><Button variant="ghost" size="sm" icon aria-label="New agent" onClick={() => { setDraft(null); setEditing('new'); }}><Plus size={17}/></Button></div>
      {data.agents.map(agent => <div className="settings-agent" key={agent.id}>{avatar(agent)}<div><strong>{agent.name}</strong><small>{agent.role} · {modelTierForRole(agent.role) === 'default' ? 'Codex default model' : 'Lightweight model'}</small></div><Button variant="outline" size="sm" onClick={() => { setEditing(agent.id); setDraft({ ...agent }); }}>Edit</Button></div>)}
      {editing && <div className="agent-editor"><div className="row-between"><strong>{editing === 'new' ? 'New agent' : `Edit ${draft?.name}`}</strong><Button variant="ghost" size="sm" icon aria-label="Close agent editor" onClick={() => setEditing(null)}><X size={15}/></Button></div>{editing === 'new' ? <><input aria-label="Agent name" placeholder="Name" value={newName} onChange={e => setNewName(e.target.value)}/><input aria-label="Agent role" placeholder="Role" value={newRole} onChange={e => setNewRole(e.target.value)}/><textarea aria-label="Agent instructions" placeholder="Personality and instructions" value={draft?.instructions || ''} onChange={e => setDraft(current => ({ ...(current || { id:'', name:newName, role:newRole, color:'#8f79dd', createdAt:'' }), instructions:e.target.value }))} rows={4}/><Button size="sm" disabled={!newName.trim() || !newRole.trim()} onClick={() => void run(async () => { await api.createAgent({ name:newName.trim(), role:newRole.trim(), color:'#8f79dd', instructions:draft?.instructions || '' }); setEditing(null); setNewName(''); setNewRole(''); setDraft(null); })}>Create agent</Button></> : draft && <><input aria-label="Agent name" value={draft.name} onChange={e => setDraft({ ...draft, name:e.target.value })}/><input aria-label="Agent role" value={draft.role} onChange={e => setDraft({ ...draft, role:e.target.value })}/><textarea aria-label="Agent instructions" value={draft.instructions} onChange={e => setDraft({ ...draft, instructions:e.target.value })} rows={5}/><Button size="sm" disabled={!draft.name.trim() || !draft.role.trim()} onClick={() => void run(async () => { await api.updateAgent(draft); setEditing(null); })}>Save agent</Button></>}</div>}
    </Card></div><div className="settings-aside"><Card className="info-card" variant="outline" padding="md"><span className="eyebrow">RUNTIME</span><h3>Codex</h3><div className="status-line"><Cpu size={17}/><span>{data.codexStatus}</span></div><p>Lead agents use your Codex default. Specialists and hourly discovery use an available Luna model at low effort. If none is available, those runs stop rather than silently use a larger model.</p></Card><Card className="info-card" variant="outline" padding="md"><span className="eyebrow">BACKGROUND</span><h3>Always ready</h3><p>Closing the window keeps Agent Desk in the menu bar. Reviews run hourly while your Mac is awake.</p><Button variant="outline" size="sm" onClick={() => void run(() => api.setLaunchAtLogin(!data.launchAtLogin))}>{data.launchAtLogin ? 'Disable start at login' : 'Start at login'}</Button></Card><Card className="info-card" variant="outline" padding="md"><span className="eyebrow">DESIGN PRINCIPLE</span><h3>Everything visible</h3><p>Agent runs, sources, proposed tasks, and approvals have a place you can return to.</p></Card></div></div>
  </div>;
}

function ApprovalDock({ approvals, run }: { approvals: Approval[]; run: (action: () => Promise<unknown>) => Promise<void> }) { const item = approvals[0]; return <div className="approval-dock"><div className="approval-icon"><ShieldCheck size={19}/></div><div><small>AGENT NEEDS YOUR APPROVAL</small><strong>{item.title}</strong><p>{item.detail.slice(0, 220)}</p></div><button className="small-button" onClick={() => void run(() => api.resolveApproval(item.id, false))}>Deny</button><button className="primary-button" onClick={() => void run(() => api.resolveApproval(item.id, true))}>Approve</button></div>; }
function NewRoomModal({ agents, onClose, onCreate }: { agents: Agent[]; onClose: () => void; onCreate: (title: string, lead: string) => void }) { const [title, setTitle] = useState(''); const [lead, setLead] = useState(agents[0]?.id || ''); return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={e => e.stopPropagation()}><div className="row-between"><h2>New room</h2><button className="icon-button" onClick={onClose}><X size={17}/></button></div><p>Create a space for a project, topic, or ongoing thread.</p><label>ROOM NAME<input autoFocus placeholder="e.g. Product strategy" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && title.trim() && onCreate(title, lead)}/></label><label>LEAD AGENT<select value={lead} onChange={e => setLead(e.target.value)}>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name} · {agent.role}</option>)}</select></label><button className="primary-button full" disabled={!title.trim()} onClick={() => onCreate(title.trim(), lead)}>Create room <ArrowRight size={15}/></button></div></div>; }
