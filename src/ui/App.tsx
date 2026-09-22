import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownRight, ArrowRight, AtSign, Bell, BookOpen, Check, ChevronDown, CircleHelp, Clock3, Command, Compass, Cpu, ExternalLink, FileText, Inbox, LayoutGrid, MemoryStick, MessageCircle, MoreHorizontal, Plus, Search, Send, Settings2, ShieldCheck, Sparkles, SquareArrowOutUpRight, X } from 'lucide-react';
import type { Agent, Approval, Message, Room, Snapshot, Task } from '../../shared/types';

type View = 'chat' | 'tasks' | 'review' | 'memory' | 'settings';
const api = window.agentDesk;
const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const date = (value: string) => new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
function avatar(agent?: Agent, size = 'normal') { return <span className={`avatar ${size}`} style={{ '--agent-color': agent?.color || '#8a8b95' } as React.CSSProperties}>{agent?.name.slice(0, 1) || '?'}</span>; }
function linkedText(value: string) { return value.split(/(https?:\/\/[^\s<>]+)/g).map((part, index) => /^https?:\/\//.test(part) ? <a key={index} href={part} onClick={event => { event.preventDefault(); void api.openExternal(part); }}>{part}</a> : part); }

export function App() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [view, setView] = useState<View>('chat');
  const [roomId, setRoomId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
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
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="sidebar-top"><div className="brand"><span className="brand-mark"><Sparkles size={17}/></span><div><strong>agent desk</strong><small>PERSONAL WORKSPACE</small></div></div><button className="icon-button subtle" title="Settings" onClick={() => setView('settings')}><Settings2 size={17}/></button></div>
      <div className="sidebar-search"><Search size={15}/><input placeholder="Search your workspace" value={search} onChange={e => setSearch(e.target.value)}/><span>⌘ K</span></div>
      <div className="side-section"><div className="side-label">WORKSPACE</div>
        <Nav icon={<MessageCircle size={17}/>} active={view === 'chat'} label="Conversations" onClick={() => setView('chat')}/>
        <Nav icon={<LayoutGrid size={17}/>} active={view === 'tasks'} label="Tasks & goals" onClick={() => setView('tasks')}/>
        <Nav icon={<Activity size={17}/>} active={view === 'review'} label="Review activity" badge={proposed || undefined} onClick={() => setView('review')}/>
        <Nav icon={<MemoryStick size={17}/>} active={view === 'memory'} label="Memory" onClick={() => setView('memory')}/>
      </div>
      <div className="side-section room-section"><div className="side-label row-between">ROOMS <button className="bare" title="New room" onClick={() => setShowNewRoom(true)}><Plus size={16}/></button></div>
        {data.rooms.filter(x => !search || x.title.toLowerCase().includes(search.toLowerCase())).map(item => <button key={item.id} className={`room-item ${view === 'chat' && room?.id === item.id ? 'selected' : ''}`} onClick={() => { setRoomId(item.id); setView('chat'); }}><span className="room-glyph">#</span><span>{item.title}</span></button>)}
      </div>
      <div className="side-section agents-section"><div className="side-label row-between">YOUR AGENTS <button className="bare" title="Manage agents" onClick={() => setView('settings')}><Plus size={16}/></button></div>
        {agents.map(agent => <button className="agent-item" key={agent.id} onClick={() => setView('settings')}>{avatar(agent, 'small')}<span><strong>{agent.name}</strong><small>{agent.role}</small></span><span className="agent-online"/></button>)}
      </div>
      <div className="sidebar-bottom"><div className="connection-mini"><span className={`connection-dot ${data.connectors.some(x => x.status === 'connected') ? 'green' : ''}`}/><span>{data.connectors.filter(x => x.status === 'connected').length} of 2 sources connected</span><button className="bare" onClick={() => setView('settings')}><ArrowRight size={14}/></button></div><button className="profile"><span className="profile-avatar">ME</span><span><strong>Your workspace</strong><small>Local on this Mac</small></span><MoreHorizontal size={16}/></button></div>
    </aside>
    <main className="main-area">
      {view === 'chat' && room && <ChatView data={data} room={room} busy={busy} onSend={async text => { setBusy(true); await run(() => api.sendMessage(room.id, text)); setBusy(false); }} onSettings={() => setView('settings')}/>}
      {view === 'tasks' && <TasksView data={data} run={run}/>}
      {view === 'review' && <ReviewView data={data} run={run}/>}
      {view === 'memory' && <MemoryView data={data} run={run}/>}
      {view === 'settings' && <SettingsView data={data} run={run}/>}
    </main>
    {data.approvals.length > 0 && <ApprovalDock approvals={data.approvals} run={run}/>}
    {error && <div className="error-toast"><span>{error}</span><button className="bare" onClick={() => setError('')}><X size={15}/></button></div>}
    {showNewRoom && <NewRoomModal agents={agents} onClose={() => setShowNewRoom(false)} onCreate={(title, lead) => run(async () => { await api.createRoom(title, lead); const updated = await api.snapshot(); setRoomId(updated.rooms[0].id); setView('chat'); setShowNewRoom(false); })}/>}
  </div>;
}

function Nav({ icon, label, active, badge, onClick }: { icon: React.ReactNode; label: string; active?: boolean; badge?: number; onClick: () => void }) { return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span>{badge ? <em>{badge}</em> : null}</button>; }

function ChatView({ data, room, busy, onSend, onSettings }: { data: Snapshot; room: Room; busy: boolean; onSend: (text: string) => Promise<void>; onSettings: () => void }) {
  const [input, setInput] = useState(''); const bottom = useRef<HTMLDivElement>(null);
  const messages = data.messages.filter(x => x.roomId === room.id);
  const lead = data.agents.find(x => x.id === room.leadAgentId);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), [messages.length, messages.at(-1)?.content]);
  const send = () => { const text = input.trim(); if (text) { setInput(''); void onSend(text); } };
  return <div className="chat-view">
    <header className="topbar"><div className="topbar-title"><span className="hash-lg">#</span><div><h1>{room.title}</h1><p>Led by {lead?.name || 'an agent'} · {data.agents.length} agents available</p></div></div><div className="topbar-actions"><div className="presence-stack">{data.agents.slice(0, 3).map(agent => <span key={agent.id} title={agent.name}>{avatar(agent, 'tiny')}</span>)}</div><button className="topbar-button" onClick={onSettings}><Settings2 size={16}/> Agents</button></div></header>
    <div className="chat-scroll">
      {messages.length === 0 ? <div className="empty-chat"><div className="empty-orbit"><span className="brand-mark large"><Sparkles size={26}/></span></div><span className="eyebrow">A SPACE TO THINK TOGETHER</span><h2>Good things start with a conversation.</h2><p>Ask {lead?.name || 'your lead agent'} anything, or bring a specialist in with @mention. Your agents share this room and keep their work visible.</p><div className="suggestions"><button onClick={() => setInput('Help me plan my week based on my recent work')}>Plan my week <ArrowRight size={14}/></button><button onClick={() => setInput('Search Slack for decisions I may have missed')}>Find recent decisions <ArrowRight size={14}/></button><button onClick={() => setInput('/goal Summarize my latest meeting transcripts')}>Start a goal <ArrowRight size={14}/></button></div></div> : <div className="message-list">{messages.map(message => <MessageCard key={message.id} message={message} agent={data.agents.find(x => x.id === message.agentId)}/>)}<div ref={bottom}/></div>}
    </div>
    <div className="composer-wrap"><div className="composer"><textarea placeholder={`Message ${lead?.name || 'your agents'}…   @mention an agent, /goal to delegate`} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} rows={2}/><div className="composer-footer"><div className="composer-hints"><span><AtSign size={14}/> Mention agent</span><span><Command size={14}/> /goal</span></div>{busy && <button className="text-button" onClick={() => void api.stopRoom(room.id)}>Stop run</button>}<button className="send-button" disabled={!input.trim() || busy} onClick={send}>{busy ? <span className="spinner"/> : <Send size={15}/>}</button></div></div><p className="composer-note">Agents can make mistakes. Source links and approvals stay visible.</p></div>
  </div>;
}
function MessageCard({ message, agent }: { message: Message; agent?: Agent }) {
  if (message.role === 'system') return <div className="handoff"><ArrowDownRight size={14}/>{message.content}</div>;
  return <div className={`message ${message.role}`}>
    {message.role === 'user' ? <span className="profile-avatar message-avatar">ME</span> : avatar(agent)}
    <div className="message-body"><div className="message-meta"><strong>{message.role === 'user' ? 'You' : agent?.name || 'Agent'}</strong>{agent && <span className="role-pill">{agent.role}</span>}<time>{time(message.createdAt)}</time>{message.status === 'streaming' && <span className="live-pill"><span/> working</span>}{message.status === 'failed' && <span className="failed-pill">failed</span>}</div><div className="message-text">{message.content ? linkedText(message.content) : <span className="typing"><i/><i/><i/></span>}</div></div>
  </div>;
}

function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) { return <header className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div><div className="page-actions">{actions}</div></header>; }

function TasksView({ data, run }: { data: Snapshot; run: (action: () => Promise<unknown>) => Promise<void> }) {
  const [newTask, setNewTask] = useState(''); const [tab, setTab] = useState<'proposed' | 'active' | 'done'>('active');
  const groups = { proposed: data.tasks.filter(x => x.status === 'proposed'), active: data.tasks.filter(x => ['ready','running','blocked'].includes(x.status)), done: data.tasks.filter(x => x.status === 'done') };
  return <div className="page-scroll"><PageHeader eyebrow="WORKSPACE / TASKS" title="Tasks & goals" description="A place for work to land, and a clear way to hand it off." actions={<button className="primary-button" onClick={() => document.getElementById('new-task')?.focus()}><Plus size={16}/> New task</button>}/>
    <div className="stats-grid"><Stat icon={<Inbox size={18}/>} label="Proposed" value={groups.proposed.length} accent="violet"/><Stat icon={<LayoutGrid size={18}/>} label="Ready & running" value={groups.active.length} accent="teal"/><Stat icon={<Check size={18}/>} label="Completed" value={groups.done.length} accent="orange"/></div>
    <div className="content-panel"><div className="tabbar"><button className={tab === 'active' ? 'current' : ''} onClick={() => setTab('active')}>Active <span>{groups.active.length}</span></button><button className={tab === 'proposed' ? 'current' : ''} onClick={() => setTab('proposed')}>Proposed <span>{groups.proposed.length}</span></button><button className={tab === 'done' ? 'current' : ''} onClick={() => setTab('done')}>Completed <span>{groups.done.length}</span></button></div>
      <div className="quick-add"><Plus size={17}/><input id="new-task" placeholder="Add a task…" value={newTask} onChange={e => setNewTask(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newTask.trim()) { void run(() => api.createTask(newTask.trim(), '')); setNewTask(''); } }}/><span>↵ to add</span></div>
      {groups[tab].length ? <div className="task-list">{groups[tab].map(task => <TaskRow key={task.id} task={task} agents={data.agents} goal={data.goals.find(goal => goal.taskId === task.id)} run={run}/>)}</div> : <div className="panel-empty"><span className="empty-icon"><LayoutGrid size={22}/></span><h3>{tab === 'proposed' ? 'No proposed work yet' : tab === 'done' ? 'Nothing completed yet' : 'A clear desk.'}</h3><p>{tab === 'proposed' ? 'Hourly reviews will suggest follow-ups here.' : tab === 'done' ? 'Finished goals will appear here.' : 'Add a task above or accept one from your review inbox.'}</p></div>}
    </div></div>;
}
function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent: string }) { return <div className={`stat-card ${accent}`}><span className="stat-icon">{icon}</span><span><small>{label}</small><strong>{value}</strong></span></div>; }
function TaskRow({ task, agents, goal, run }: { task: Task; agents: Agent[]; goal?: Snapshot['goals'][number]; run: (action: () => Promise<unknown>) => Promise<void> }) {
  const [selected, setSelected] = useState(task.agentId || agents[0]?.id || '');
  const [editing, setEditing] = useState(false); const [title, setTitle] = useState(task.title); const [notes, setNotes] = useState(task.notes);
  return <div className="task-row"><span className={`task-status ${task.status}`}>{task.status === 'done' ? <Check size={14}/> : task.status === 'running' ? <span className="spinner"/> : <span/>}</span><div className="task-main">{editing ? <div className="inline-editor"><input value={title} onChange={e => setTitle(e.target.value)}/><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}/><button className="small-button accent" disabled={!title.trim()} onClick={() => void run(async () => { await api.updateTask(task.id, { title: title.trim(), notes: notes.trim() }); setEditing(false); })}>Save changes</button><button className="text-button" onClick={() => setEditing(false)}>Cancel</button></div> : <><strong>{task.title}</strong>{task.notes && <p>{task.notes}</p>}</>}<div className="task-meta"><span>{date(task.createdAt)}</span>{task.sourceUrl && <button onClick={() => void run(() => api.openExternal(task.sourceUrl!))}><ExternalLink size={12}/> Source</button>}{goal && <span className={`goal-label ${goal.status}`}>{goal.status.replace('_', ' ')}</span>}</div>{goal?.detail && <p className="goal-detail">{goal.detail.slice(-600)}</p>}</div><div className="task-actions">{['proposed','ready','blocked'].includes(task.status) && <button className="small-button" onClick={() => setEditing(true)}>Edit</button>}{task.status === 'proposed' ? <><button className="small-button" onClick={() => void run(() => api.updateTask(task.id,{status:'ready'}))}>Accept</button><button className="icon-button" title="Dismiss" onClick={() => void run(() => api.updateTask(task.id,{status:'dismissed'}))}><X size={15}/></button></> : task.status === 'ready' || task.status === 'blocked' ? <><select value={selected} onChange={e => setSelected(e.target.value)}>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><button className="small-button accent" onClick={() => void run(() => api.startGoal(task.id, selected))}>Start goal <ArrowRight size={13}/></button></> : task.status === 'running' ? <button className="small-button" onClick={() => void run(() => api.stopGoal(task.id))}>Stop</button> : null}</div></div>;
}

function ReviewView({ data, run }: { data: Snapshot; run: (action: () => Promise<unknown>) => Promise<void> }) {
  const scans = data.scans;
  const proposed = data.tasks.filter(x => x.status === 'proposed');
  return <div className="page-scroll"><PageHeader eyebrow="WORKSPACE / REVIEW" title="Review activity" description="Exploratory searches across connected sources, roughly every hour." actions={<button className="primary-button" onClick={() => void run(() => api.runReview())}><Sparkles size={16}/> Review now</button>}/>
    <div className="callout"><Compass size={19}/><div><strong>A discovery feed, not a complete record.</strong><p>Searches surface likely decisions, commitments, and follow-ups. Each finding links to its source so you can check the context.</p></div></div>
    <div className="section-heading"><h2>Needs your attention <span>{proposed.length}</span></h2></div>
    {proposed.length ? <div className="review-cards">{proposed.map(task => <div className="review-card" key={task.id}><span className="review-spark"><Sparkles size={18}/></span><div><small>PROPOSED TASK · {date(task.createdAt)}</small><h3>{task.title}</h3><p>{task.notes}</p><div className="review-card-actions"><button className="small-button accent" onClick={() => void run(() => api.updateTask(task.id,{status:'ready'}))}>Add to tasks <ArrowRight size={13}/></button><button className="text-button" onClick={() => void run(() => api.updateTask(task.id,{status:'dismissed'}))}>Dismiss</button>{task.sourceUrl && <button className="text-button" onClick={() => void run(() => api.openExternal(task.sourceUrl!))}>View source <ExternalLink size={12}/></button>}</div></div></div>)}</div> : <div className="panel-empty wide"><span className="empty-icon"><Check size={23}/></span><h3>All caught up for now</h3><p>New suggestions from scheduled reviews will appear here.</p></div>}
    <div className="section-heading spaced"><h2>Search history</h2><span>Latest 60 scans</span></div>
    <div className="history-list">{scans.length ? scans.map(scan => <div className="history-row" key={scan.id}><span className={`source-badge ${scan.provider}`}>{scan.provider === 'slack' ? '#' : <FileText size={14}/>}</span><div><strong>{scan.query}</strong><small>{scan.provider} · {date(scan.startedAt)} at {time(scan.startedAt)}{scan.error ? ` · ${scan.error}` : ''}</small></div><span className={`scan-status ${scan.status}`}>{scan.status === 'complete' ? `${scan.created} tasks` : scan.status}</span></div>) : <div className="panel-empty compact">No scans yet. Connect a source or run a review.</div>}</div>
  </div>;
}

function MemoryView({ data, run }: { data: Snapshot; run: (action: () => Promise<unknown>) => Promise<void> }) {
  const [instructions, setInstructions] = useState(data.memoryInstructions);
  useEffect(() => setInstructions(data.memoryInstructions), [data.memoryInstructions]);
  return <div className="page-scroll"><PageHeader eyebrow="WORKSPACE / MEMORY" title="Memory" description="The durable context your agents carry forward." actions={<span className="count-pill">{data.memories.length} memories</span>}/>
    <div className="memory-layout"><div className="content-panel"><div className="panel-heading"><div><h2>Saved memories</h2><p>Automatically selected from review and agent work.</p></div><MemoryStick size={19}/></div>{data.memories.length ? <div className="memory-list">{data.memories.map(item => <MemoryRow key={item.id} item={item} run={run}/>)}</div> : <div className="panel-empty"><span className="empty-icon"><MemoryStick size={22}/></span><h3>Memories will collect here</h3><p>As your agents review work, they’ll keep useful facts and decisions.</p></div>}</div>
    <div className="instruction-card"><span className="eyebrow">MEMORY GUIDANCE</span><h3>What should agents keep?</h3><p>These instructions guide automatic memory writing. You can refine them as you learn what works.</p><textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={10}/><button className="primary-button" disabled={instructions === data.memoryInstructions} onClick={() => void run(() => api.setMemoryInstructions(instructions))}>Save instructions</button><div className="subtle-note"><CircleHelp size={14}/> Mnemosyne is used when available; memories also stay in the local app database.</div></div></div>
  </div>;
}

function MemoryRow({ item, run }: { item: Snapshot['memories'][number]; run: (action: () => Promise<unknown>) => Promise<void> }) {
  const [editing, setEditing] = useState(false); const [content, setContent] = useState(item.content);
  return <div className="memory-row"><span className="memory-orb"><Sparkles size={15}/></span><div>{editing ? <div className="inline-editor"><textarea value={content} onChange={e => setContent(e.target.value)} rows={3}/><button className="small-button accent" disabled={!content.trim()} onClick={() => void run(async () => { await api.correctMemory(item.id, content); setEditing(false); })}>Save correction</button><button className="text-button" onClick={() => setEditing(false)}>Cancel</button></div> : <p>{item.content}</p>}<small>{item.scope} · {date(item.createdAt)} {item.sourceUrl && <button onClick={() => void run(() => api.openExternal(item.sourceUrl!))}>Source <ExternalLink size={11}/></button>}</small></div><button className="small-button" onClick={() => setEditing(true)}>Correct</button><button className="icon-button" title="Forget memory" onClick={() => void run(() => api.forgetMemory(item.id))}><X size={15}/></button></div>;
}

function SettingsView({ data, run }: { data: Snapshot; run: (action: () => Promise<unknown>) => Promise<void> }) {
  const [clientId, setClientId] = useState(data.mcpSettings.slackClientId); const [clientSecret, setClientSecret] = useState('');
  const [editing, setEditing] = useState<string | null>(null); const [draft, setDraft] = useState<Agent | null>(null);
  const [newName, setNewName] = useState(''); const [newRole, setNewRole] = useState('');
  const slack = data.connectors.find(x => x.id === 'slack')!; const notion = data.connectors.find(x => x.id === 'notion')!;
  return <div className="page-scroll"><PageHeader eyebrow="WORKSPACE / SETTINGS" title="Your workspace" description="Shape your agents, connect your sources, and choose how the app runs."/>
    <div className="settings-grid"><div className="settings-main"><section className="content-panel settings-panel"><div className="panel-heading"><div><h2>Connections</h2><p>The same MCP connections serve chat and scheduled review.</p></div><SquareArrowOutUpRight size={18}/></div>
      <div className="connector-row"><span className="connector-icon slack">#</span><div><strong>Slack</strong><small className={`connector-state ${slack.status}`}><span/> {slack.status} · {slack.detail}</small></div><button className="small-button" onClick={() => void run(() => api.connect('slack', clientId, clientSecret))}>{slack.status === 'connected' ? 'Reconnect' : 'Connect'}</button></div>
      {slack.status !== 'connected' && <div className="connector-setup"><p>Use an internal Slack app with MCP enabled. Set its OAuth redirect URL to <code>http://127.0.0.1:8765/callback/slack</code>.</p><div className="form-row"><input placeholder="Slack Client ID" value={clientId} onChange={e => setClientId(e.target.value)}/><input type="password" placeholder="Client Secret" value={clientSecret} onChange={e => setClientSecret(e.target.value)}/></div><button className="link-button" onClick={() => void run(() => api.openExternal('https://api.slack.com/apps'))}>Open Slack app settings <ExternalLink size={12}/></button></div>}
      <div className="connector-row"><span className="connector-icon notion">N</span><div><strong>Notion</strong><small className={`connector-state ${notion.status}`}><span/> {notion.status} · {notion.detail}</small></div><button className="small-button" onClick={() => void run(() => api.connect('notion'))}>{notion.status === 'connected' ? 'Reconnect' : 'Connect'}</button></div>
      <div className="connector-note"><ShieldCheck size={15}/> OAuth tokens and secrets are encrypted with macOS Keychain-backed storage.</div>
    </section>
    <section className="content-panel settings-panel"><div className="panel-heading"><div><h2>Agent personalities</h2><p>Each agent has a role and its own instructions.</p></div><button className="icon-button" onClick={() => { setDraft(null); setEditing('new'); }}><Plus size={17}/></button></div>
      {data.agents.map(agent => <div className="settings-agent" key={agent.id}>{avatar(agent)}<div><strong>{agent.name}</strong><small>{agent.role}</small></div><button className="small-button" onClick={() => { setEditing(agent.id); setDraft({ ...agent }); }}>Edit</button></div>)}
      {editing && <div className="agent-editor"><div className="row-between"><strong>{editing === 'new' ? 'New agent' : `Edit ${draft?.name}`}</strong><button className="bare" onClick={() => setEditing(null)}><X size={15}/></button></div>{editing === 'new' ? <><input placeholder="Name" value={newName} onChange={e => setNewName(e.target.value)}/><input placeholder="Role" value={newRole} onChange={e => setNewRole(e.target.value)}/><textarea placeholder="Personality and instructions" value={draft?.instructions || ''} onChange={e => setDraft(current => ({ ...(current || { id:'', name:newName, role:newRole, color:'#8f79dd', createdAt:'' }), instructions:e.target.value }))} rows={4}/><button className="primary-button" onClick={() => void run(async () => { await api.createAgent({ name:newName, role:newRole, color:'#8f79dd', instructions:draft?.instructions || '' }); setEditing(null); setNewName(''); setNewRole(''); setDraft(null); })}>Create agent</button></> : draft && <><input value={draft.name} onChange={e => setDraft({ ...draft, name:e.target.value })}/><input value={draft.role} onChange={e => setDraft({ ...draft, role:e.target.value })}/><textarea value={draft.instructions} onChange={e => setDraft({ ...draft, instructions:e.target.value })} rows={5}/><button className="primary-button" onClick={() => void run(async () => { await api.updateAgent(draft); setEditing(null); })}>Save agent</button></>}</div>}
    </section></div><div className="settings-aside"><div className="info-card"><span className="eyebrow">RUNTIME</span><h3>Codex</h3><div className="status-line"><Cpu size={17}/><span>{data.codexStatus}</span></div><p>Agent turns run locally through Codex app-server.</p></div><div className="info-card"><span className="eyebrow">BACKGROUND</span><h3>Always ready</h3><p>Closing the window keeps Agent Desk in the menu bar. Reviews run hourly while your Mac is awake.</p><button className="small-button" onClick={() => void run(() => api.setLaunchAtLogin(!data.launchAtLogin))}>{data.launchAtLogin ? 'Disable start at login' : 'Start at login'}</button></div><div className="info-card"><span className="eyebrow">DESIGN PRINCIPLE</span><h3>Everything visible</h3><p>Agent runs, sources, proposed tasks, and approvals have a place you can return to.</p></div></div></div>
  </div>;
}

function ApprovalDock({ approvals, run }: { approvals: Approval[]; run: (action: () => Promise<unknown>) => Promise<void> }) { const item = approvals[0]; return <div className="approval-dock"><div className="approval-icon"><ShieldCheck size={19}/></div><div><small>AGENT NEEDS YOUR APPROVAL</small><strong>{item.title}</strong><p>{item.detail.slice(0, 220)}</p></div><button className="small-button" onClick={() => void run(() => api.resolveApproval(item.id, false))}>Deny</button><button className="primary-button" onClick={() => void run(() => api.resolveApproval(item.id, true))}>Approve</button></div>; }
function NewRoomModal({ agents, onClose, onCreate }: { agents: Agent[]; onClose: () => void; onCreate: (title: string, lead: string) => void }) { const [title, setTitle] = useState(''); const [lead, setLead] = useState(agents[0]?.id || ''); return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={e => e.stopPropagation()}><div className="row-between"><h2>New room</h2><button className="icon-button" onClick={onClose}><X size={17}/></button></div><p>Create a space for a project, topic, or ongoing thread.</p><label>ROOM NAME<input autoFocus placeholder="e.g. Product strategy" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && title.trim() && onCreate(title, lead)}/></label><label>LEAD AGENT<select value={lead} onChange={e => setLead(e.target.value)}>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name} · {agent.role}</option>)}</select></label><button className="primary-button full" disabled={!title.trim()} onClick={() => onCreate(title.trim(), lead)}>Create room <ArrowRight size={15}/></button></div></div>; }
