import { useCallback, useEffect, useState } from 'react';
import { CircleHelp, Cpu, ExternalLink, MemoryStick, Plus, ShieldCheck, Sparkles, SquareArrowOutUpRight, X } from 'lucide-react';
import type { Agent, Approval, Snapshot } from '../../shared/types';
import { modelTierForRole } from '../../shared/model-policy';
import { Badge, Button, Card } from './design-system/primitives';
import { api, Avatar, isTyping, type Route, type Run } from './views/common';
import { Sidebar } from './views/Sidebar';
import { TasksView } from './views/TasksView';
import { GroupView } from './views/GroupView';
import { RoutineView } from './views/RoutineView';

const date = (value: string) => new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
function avatar(agent?: Agent) { return <Avatar agent={agent} size={34}/>; }

export function App() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [route, setRoute] = useState<Route>({ view: 'tasks', list: 'today' });
  const [error, setError] = useState('');
  const [showNewGroup, setShowNewGroup] = useState(false);
  useEffect(() => {
    void api.snapshot().then(setData);
    return api.onEvent(event => {
      if (event.type === 'snapshot') setData(event.value);
      if (event.type === 'message-delta') setData(current => current ? { ...current, messages: current.messages.map(message => message.id === event.messageId ? { ...message, content: message.content + event.delta } : message) } : current);
    });
  }, []);
  const run: Run = useCallback(async action => { setError(''); try { await action(); } catch (cause) { setError(String(cause).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')); } }, []);
  // g then t/u/w/n jumps between task lists, Linear/Godspeed style.
  useEffect(() => {
    let pending = false; let timer = 0;
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (pending) {
        pending = false; window.clearTimeout(timer);
        const list = ({ t: 'today', u: 'upcoming', w: 'team', n: 'needs' } as const)[event.key as 't' | 'u' | 'w' | 'n'];
        if (list) { event.preventDefault(); setRoute({ view: 'tasks', list }); }
        return;
      }
      if (event.key === 'g') { pending = true; timer = window.setTimeout(() => { pending = false; }, 900); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!data) return <div className="loading">Loading Ägir…</div>;
  const group = route.view === 'group' ? data.groups.find(item => item.id === route.groupId) : undefined;
  const routine = route.view === 'routine' ? data.routines.find(item => item.id === route.routineId) : undefined;
  const discuss = (name: string) => { const home = data.groups.find(item => item.kind === 'group') || data.groups[0]; setRoute({ view: 'group', groupId: home.id, draft: `@${name} ` }); };
  return <div className="ws-shell">
    <Sidebar data={data} route={route} go={setRoute} onNewGroup={() => setShowNewGroup(true)}/>
    <div className="ws-main">
      {route.view === 'tasks' && <TasksView key={route.list} data={data} run={run} list={route.list}/>}
      {route.view === 'group' && group && <GroupView key={`${group.id}:${route.draft || ''}`} data={data} group={group} threadId={route.threadId} draft={route.draft} run={run} onSelectThread={threadId => setRoute({ view: 'group', groupId: group.id, threadId })}/>}
      {route.view === 'routine' && routine && <RoutineView key={routine.id} data={data} routine={routine} run={run} onDiscuss={() => discuss(routine.name)}/>}
      {route.view === 'memory' && <main className="full-page"><MemoryView data={data} run={run}/></main>}
      {route.view === 'settings' && <main className="full-page"><SettingsView data={data} run={run}/></main>}
    </div>
    {data.approvals.length > 0 && <ApprovalDock approvals={data.approvals} run={run}/>}
    {error && <div className="error-toast" role="alert"><span>{error}</span><button className="bare" aria-label="Dismiss error" onClick={() => setError('')}><X size={15}/></button></div>}
    {showNewGroup && <NewGroupModal agents={data.agents} onClose={() => setShowNewGroup(false)} onCreate={(title, agentIds) => run(async () => { const created = await api.createGroup(title, agentIds); setRoute({ view: 'group', groupId: created.id }); setShowNewGroup(false); })}/>}
  </div>;
}

function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) { return <header className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div><div className="page-actions">{actions}</div></header>; }

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
    <div className="settings-grid"><div className="settings-main"><Card className="content-panel settings-panel" variant="outline" padding="none" as="section"><div className="panel-heading"><div><h2>Connections</h2><p>The same MCP connections serve chat, tasks and routines. Tasks and routines only get read-only tools.</p></div><SquareArrowOutUpRight size={18}/></div>
      <div className="connector-row"><span className="connector-icon slack">#</span><div><strong>Slack</strong><Badge size="sm" tone={slack.status === 'connected' ? 'success' : slack.status === 'error' ? 'danger' : 'neutral'} dot>{slack.status}</Badge><small className="connector-detail">{slack.detail}</small></div><Button variant="outline" size="sm" onClick={() => void run(() => api.connect('slack', clientId, clientSecret))}>{slack.status === 'connected' ? 'Reconnect' : 'Connect'}</Button></div>
      {slack.status !== 'connected' && <div className="connector-setup"><p>Use an internal Slack app with MCP enabled. Set its OAuth redirect URL to <code>http://127.0.0.1:8765/callback/slack</code>.</p><div className="form-row"><input placeholder="Slack Client ID" value={clientId} onChange={e => setClientId(e.target.value)}/><input type="password" placeholder="Client Secret" value={clientSecret} onChange={e => setClientSecret(e.target.value)}/></div><button className="link-button" onClick={() => void run(() => api.openExternal('https://api.slack.com/apps'))}>Open Slack app settings <ExternalLink size={12}/></button></div>}
      <div className="connector-row"><span className="connector-icon notion">N</span><div><strong>Notion</strong><Badge size="sm" tone={notion.status === 'connected' ? 'success' : notion.status === 'error' ? 'danger' : 'neutral'} dot>{notion.status}</Badge><small className="connector-detail">{notion.detail}</small></div><Button variant="outline" size="sm" onClick={() => void run(() => api.connect('notion'))}>{notion.status === 'connected' ? 'Reconnect' : 'Connect'}</Button></div>
      <div className="connector-note"><ShieldCheck size={15}/> OAuth tokens and secrets are encrypted with macOS Keychain-backed storage.</div>
    </Card>
    <Card className="content-panel settings-panel" variant="outline" padding="none" as="section"><div className="panel-heading"><div><h2>Agent personalities</h2><p>Each agent has a role and its own instructions.</p></div><Button variant="ghost" size="sm" icon aria-label="New agent" onClick={() => { setDraft(null); setEditing('new'); }}><Plus size={17}/></Button></div>
      {data.agents.map(agent => <div className="settings-agent" key={agent.id}>{avatar(agent)}<div><strong>{agent.name}</strong><small>{agent.role} · {modelTierForRole(agent.role) === 'default' ? 'Codex default model' : 'Lightweight model'}</small></div><Button variant="outline" size="sm" onClick={() => { setEditing(agent.id); setDraft({ ...agent }); }}>Edit</Button></div>)}
      {editing && <div className="agent-editor"><div className="row-between"><strong>{editing === 'new' ? 'New agent' : `Edit ${draft?.name}`}</strong><Button variant="ghost" size="sm" icon aria-label="Close agent editor" onClick={() => setEditing(null)}><X size={15}/></Button></div>{editing === 'new' ? <><input aria-label="Agent name" placeholder="Name" value={newName} onChange={e => setNewName(e.target.value)}/><input aria-label="Agent role" placeholder="Role" value={newRole} onChange={e => setNewRole(e.target.value)}/><textarea aria-label="Agent instructions" placeholder="Personality and instructions" value={draft?.instructions || ''} onChange={e => setDraft(current => ({ ...(current || { id:'', name:newName, role:newRole, color:'#8f79dd', createdAt:'' }), instructions:e.target.value }))} rows={4}/><Button size="sm" disabled={!newName.trim() || !newRole.trim()} onClick={() => void run(async () => { await api.createAgent({ name:newName.trim(), role:newRole.trim(), color:'#8f79dd', instructions:draft?.instructions || '' }); setEditing(null); setNewName(''); setNewRole(''); setDraft(null); })}>Create agent</Button></> : draft && <><input aria-label="Agent name" value={draft.name} onChange={e => setDraft({ ...draft, name:e.target.value })}/><input aria-label="Agent role" value={draft.role} onChange={e => setDraft({ ...draft, role:e.target.value })}/><textarea aria-label="Agent instructions" value={draft.instructions} onChange={e => setDraft({ ...draft, instructions:e.target.value })} rows={5}/><Button size="sm" disabled={!draft.name.trim() || !draft.role.trim()} onClick={() => void run(async () => { await api.updateAgent(draft); setEditing(null); })}>Save agent</Button></>}</div>}
    </Card></div><div className="settings-aside"><Card className="info-card" variant="outline" padding="md"><span className="eyebrow">RUNTIME</span><h3>Codex</h3><div className="status-line"><Cpu size={17}/><span>{data.codexStatus}</span></div><p>Lead agents use your Codex default. Specialists and routines use an available Luna model at low effort. If none is available, those runs stop rather than silently use a larger model.</p></Card><Card className="info-card" variant="outline" padding="md"><span className="eyebrow">BACKGROUND</span><h3>Always ready</h3><p>Closing the window keeps Ägir in the menu bar. Routines run on schedule while your Mac is awake.</p><Button variant="outline" size="sm" onClick={() => void run(() => api.setLaunchAtLogin(!data.launchAtLogin))}>{data.launchAtLogin ? 'Disable start at login' : 'Start at login'}</Button></Card><Card className="info-card" variant="outline" padding="md"><span className="eyebrow">OUTPUT</span><h3>Files, not posts</h3><p>Work handed to the team is saved as files in Documents › Ägir. It never writes to Slack or Notion.</p></Card></div></div>
  </div>;
}

function ApprovalDock({ approvals, run }: { approvals: Approval[]; run: Run }) { const item = approvals[0]; return <div className="approval-dock"><div className="approval-icon"><ShieldCheck size={19}/></div><div><small>AGENT NEEDS YOUR APPROVAL</small><strong>{item.title}</strong><p>{item.detail.slice(0, 220)}</p></div><button className="small-button" onClick={() => void run(() => api.resolveApproval(item.id, false))}>Deny</button><button className="primary-button" onClick={() => void run(() => api.resolveApproval(item.id, true))}>Approve</button></div>; }
function NewGroupModal({ agents, onClose, onCreate }: { agents: Agent[]; onClose: () => void; onCreate: (title: string, agentIds: string[]) => void }) {
  const [title, setTitle] = useState(''); const [chosen, setChosen] = useState<string[]>(agents.map(agent => agent.id));
  const ready = title.trim() && chosen.length;
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="new-group-title" onMouseDown={e => e.stopPropagation()}>
    <div className="row-between"><h2 id="new-group-title">New group</h2><button className="icon-button" aria-label="Close" onClick={onClose}><X size={17}/></button></div>
    <p>A standing set of agents for a project or topic. The first agent you pick leads.</p>
    <label>GROUP NAME<input autoFocus placeholder="e.g. research" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && ready && onCreate(title.trim(), chosen)}/></label>
    <fieldset className="ws-agent-picks"><legend>AGENTS</legend>{agents.map(agent => <label key={agent.id}><input type="checkbox" checked={chosen.includes(agent.id)} onChange={e => setChosen(e.target.checked ? [...chosen, agent.id] : chosen.filter(id => id !== agent.id))}/>{agent.name}<small>{agent.role}</small></label>)}</fieldset>
    <button className="primary-button full" disabled={!ready} onClick={() => onCreate(title.trim(), chosen)}>Create group <Plus size={15}/></button>
  </div></div>;
}
