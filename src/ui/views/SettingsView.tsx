import { UpdateSettings } from './UpdateSettings';
import { mainAgent } from '../../../shared/agent-mentions';
import { DelegationSettings } from './TaskDelegation';
import { PersonalIntegrations } from './PersonalIntegrations';
import { BrainBridgeSettings } from './BrainBridgeSettings';
import { GmailSettings } from './GmailSettings';
import { TypographySettings } from './TypographySettings';
import { ArrowLeft, Bot, CircleHelp, Globe, Link, ListTodo, Palette, Search, Settings, ShieldCheck, SquareArrowOutUpRight, StickyNote, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { modelTierForRole } from '../../../shared/model-policy';
import type { Agent, Snapshot } from '../../../shared/types';
import { Badge, Button, Card } from '../design-system/primitives';
import { api, Avatar, type Run } from './common';
import { SkillsView } from './SkillsView';

const categories = [
  { id: 'general', title: 'General', description: 'Everyday preferences for your workspace.', keywords: 'startup login priorities', icon: Settings },
  { id: 'appearance', title: 'Appearance', description: 'Make Aegir comfortable to read and work in.', keywords: 'fonts typography text size scratchpad markdown', icon: Palette },
  { id: 'assistant', title: 'Assistant & skills', description: 'Choose how your assistant works with you.', keywords: 'name instructions skill library import proposed changes', icon: Bot },
  { id: 'connections', title: 'Connections', description: 'The apps and sources your assistant can work with.', keywords: 'Slack Composio Claude Code Notion Gmail email', icon: Link },
  { id: 'tasks', title: 'Tasks & delegation', description: 'Capture, organize, and share your work.', keywords: 'Reminders Apple list Notion database people assignments external Claude routines', icon: ListTodo },
  { id: 'memory', title: 'Memory & workflows', description: 'Choose where context lives and how work flows.', keywords: 'brain filing folders intake import export Obsidian Legolas', icon: StickyNote },
  { id: 'browser', title: 'Browser & review', description: 'A workspace for browsing and reviewing documents.', keywords: 'Chrome logins human-review permissions editor comments', icon: Globe },
  { id: 'updates', title: 'Updates & setup', description: 'Keep Aegir up to date and review your setup.', keywords: 'version GitHub token providers onboarding', icon: CircleHelp },
] as const;
type Category = typeof categories[number]['id'];

function SettingsSwitch({ checked, label, disabled, onClick }: { checked: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  return <Button className="settings-switch" variant="ghost" size="sm" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={onClick}><span className="settings-switch-thumb" /></Button>;
}

export function SettingsView({ data, run, onBack, onSetup, initialAgent, initialCategory = 'general' }: { data: Snapshot; run: Run; onBack: () => void; onSetup?: () => void; initialAgent?: string; initialCategory?: Category }) {
  const [category, setCategory] = useState<Category>(initialCategory);
  const [query, setQuery] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [skillsOpened, setSkillsOpened] = useState(initialCategory === 'assistant');
  const selectCategory = (id: Category) => { setCategory(id); setQuery(''); if (id === 'assistant') setSkillsOpened(true); requestAnimationFrame(() => { heading.current?.focus(); scroll.current?.scrollTo(0, 0); }); };
  useEffect(() => { heading.current?.focus(); }, []);
  const active = categories.find(item => item.id === category)!;
  const matches = categories.filter(item => (item.title + ' ' + item.description + ' ' + item.keywords).toLowerCase().includes(query.trim().toLowerCase()));
  const [composioKey, setComposioKey] = useState('');
  const [composioAccount, setComposioAccount] = useState(data.mcpSettings.composioSlackAccount || '');
  const [composioPending, setComposioPending] = useState(false);
  const composio = data.connectors.find(x => x.id === 'composio');
  const composioAction = (action: () => Promise<unknown>) => void run(async () => {
    setComposioPending(true);
    try { await action(); } finally { setComposioPending(false); setComposioKey(''); }
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Agent | null>(null);
  const prioritySaving = useRef(false);
  const [priorityPending, setPriorityPending] = useState(false);
  const [startupPending, setStartupPending] = useState(false);
  const showPriorities = data.showTaskPriorities !== false;
  const [browserPending, setBrowserPending] = useState(false);
  const browserAction = (action: () => Promise<unknown>) => void run(async () => {
    setBrowserPending(true);
    try { await action(); } finally { setBrowserPending(false); }
  });
  const notion = data.connectors.find((x) => x.id === 'notion');
  return <div className="settings-workspace">
    <aside className="settings-navigation">
      <h2>Settings</h2>
      <label className="settings-search"><Search size={15} aria-hidden="true"/><input type="search" aria-label="Search settings" placeholder="Search settings" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <nav aria-label="Settings categories">{categories.map(({ id, title, icon: Icon }, index) => <div key={id}>
        {(index === 0 || index === 3 || index === 7) && <div className="settings-nav-label">{index === 0 ? 'Workspace' : index === 3 ? 'Tools & sources' : 'App'}</div>}
        <button className="settings-nav-item" aria-current={category === id ? 'page' : undefined} onClick={() => selectCategory(id)}><Icon size={16} aria-hidden="true"/>{title}</button>
      </div>)}</nav>
      <small className="settings-version">Aegir {data.updates?.version}</small>
    </aside>
    <div className="settings-body" ref={scroll}>
      <header className="settings-topbar"><Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={15}/> Back to workspace <kbd className="ws-kbd">Esc</kbd></Button></header>
      <div className={'settings-content ' + (category === 'assistant' && !query.trim() ? 'settings-content-wide' : '')}>
        <header className="settings-intro"><h1 ref={heading} tabIndex={-1}>{query.trim() ? 'Search settings' : active.title}</h1><p>{query.trim() ? 'Find the right place to make a change.' : active.description}</p></header>
        {query.trim() && <div className="settings-results">{matches.length ? matches.map(item => <button key={item.id} onClick={() => selectCategory(item.id)}><strong>{item.title} →</strong><span>{item.description}</span></button>) : <p role="status">No settings found. Try “font”, “Slack”, or “browser”.</p>}</div>}
        <div className="settings-category" hidden={!!query.trim() || category !== 'general'}><Card className="content-panel settings-panel" variant="outline" padding="none" as="section">
            <div className="panel-heading">
              <div>
                <h2>Startup</h2>
                <p>Open Aegir automatically when you log in to your Mac.</p>
              </div>
              <SettingsSwitch label="Start at login" checked={data.launchAtLogin} disabled={startupPending} onClick={() => {
                setStartupPending(true);
                void run(async () => { try { await api.setLaunchAtLogin(!data.launchAtLogin); } finally { setStartupPending(false); } });
              }} />
            </div>
          </Card>
<Card className="content-panel settings-panel" variant="outline" padding="none" as="section">
            <div className="panel-heading"><div><h2>Task priorities</h2><p>Show priority controls, badges and shortcuts. Hiding them keeps your saved priorities.</p></div>
              <SettingsSwitch label="Show task priorities" checked={showPriorities} disabled={priorityPending} onClick={() => {
                if (prioritySaving.current) return;
                prioritySaving.current = true; setPriorityPending(true);
                void run(async () => {
                  try { await api.setShowTaskPriorities(!showPriorities); }
                  finally { prioritySaving.current = false; setPriorityPending(false); }
                });
              }} />
            </div>
          </Card></div>
<div className="settings-category" hidden={!!query.trim() || category !== 'appearance'}><TypographySettings value={data.typography} /></div>
<div className="settings-category" hidden={!!query.trim() || category !== 'assistant'}><Card
            className="content-panel settings-panel"
            variant="outline"
            padding="none"
            as="section"
          >
            <div className="panel-heading">
              <div>
                <h2>Your assistant</h2>
                <p>One assistant for your chats, tasks and routines. Customize its instructions and skills.</p>
              </div>
            </div>
            {data.agents.filter(agent => agent.id === mainAgent(data.agents)?.id).map((agent) => (
              <div className="settings-agent" key={agent.id}>
                <Avatar agent={agent} size={34} />
                <div>
                  <strong>{agent.name}</strong>
                  <small>
                    {agent.role} ·{' '}
                    {modelTierForRole(agent.role) === 'default'
                      ? data.onboarding?.setup?.engine === 'claude' ? 'Claude Code default model' : 'Codex default model'
                      : data.onboarding?.setup?.engine === 'claude' ? 'Claude Sonnet' : 'Lightweight model'}
                  </small>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditing(agent.id);
                    setDraft({ ...agent });
                  }}
                >
                  Edit
                </Button>
              </div>
            ))}
            {editing && (
              <div className="agent-editor">
                <div className="row-between">
                  <strong>{`Edit ${draft?.name}`}</strong>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    aria-label="Close agent editor"
                    onClick={() => setEditing(null)}
                  >
                    <X size={15} />
                  </Button>
                </div>
                {draft && (
                    <>
                      <input
                        aria-label="Agent name"
                        value={draft.name}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      />
                      <input
                        aria-label="Agent role"
                        value={draft.role}
                        onChange={(e) => setDraft({ ...draft, role: e.target.value })}
                      />
                      <textarea
                        aria-label="Agent instructions"
                        value={draft.instructions}
                        onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
                        rows={5}
                      />
                      <Button
                        size="sm"
                        disabled={!draft.name.trim() || !draft.role.trim()}
                        onClick={() =>
                          void run(async () => {
                            await api.updateAgent(draft);
                            setEditing(null);
                          })
                        }
                      >
                        Save agent
                      </Button>
                    </>
                )}
              </div>
            )}
          </Card>
<section className="settings-skill-library" aria-label="Skill library">{skillsOpened && <SkillsView data={data} run={run} initialAgent={initialAgent} />}</section></div>
<div className="settings-category" hidden={!!query.trim() || category !== 'connections'}><Card
            className="content-panel settings-panel"
            variant="outline"
            padding="none"
            as="section"
          >
            <div className="panel-heading">
              <div>
                <h2>Connections</h2>
                <p>
                  The same MCP connections serve chat, tasks and routines. Tasks and routines only
                  get read-only tools.
                </p>
              </div>
              <SquareArrowOutUpRight size={18} />
            </div>
            <div className="connector-row">
              <span className="connector-icon slack">#</span>
              <div>
                <strong>Slack via Composio</strong>
                <Badge size="sm" dot tone={composio?.status === 'connected' ? 'success' : composio?.status === 'error' ? 'danger' : 'neutral'}>
                  {composio?.status || 'disconnected'}
                </Badge>
                <small className="connector-detail" role="status">{composio?.detail || 'Reuse your existing Composio Slack connection'}</small>
              </div>
              <Button variant="outline" size="sm" disabled={composioPending || composio?.status === 'connecting'}
                onClick={() => composioAction(() => api.connect('composio', composioAccount, composioKey))}>
                {composioPending ? 'Connecting…' : composio?.status === 'connected' ? 'Reconnect' : 'Connect'}
              </Button>
              <Button variant="ghost" size="sm" disabled={composioPending || composio?.status === 'disconnected'}
                onClick={() => composioAction(() => api.disconnect('composio'))}>Disconnect</Button>
            </div>
            <details className="connector-setup"><summary>Composio connection options</summary>
              <p>Use the consumer API key from Composio’s AI Clients setup, or leave it blank to sign in through your browser. A saved key is reused; disconnect to clear it and switch to browser sign-in.</p>
              <div className="form-row">
                <input aria-label="Expected Composio Slack account" placeholder="Expected Slack account ID" value={composioAccount}
                  disabled={composioPending} onChange={event => setComposioAccount(event.target.value)} />
                <input aria-label="Composio consumer API key" type="password" autoComplete="off" placeholder={data.mcpSettings.composioConfigured ? 'Credential saved' : 'Consumer API key (optional)'}
                  value={composioKey} disabled={composioPending} onChange={event => setComposioKey(event.target.value)} />
              </div>
              <p>Agents check the expected account against Composio’s connection status. Known Slack read actions are available to tasks and routines; other Slack actions require approval in chat. Manage Slack accounts in Composio.</p>
            </details>
            <div className="connector-row"><span className="connector-icon slack">#</span><div><strong>Slack via Claude Code</strong><small className="connector-detail">Connect Slack in Claude Code to use its connector with your Claude assistant.</small></div></div>
            <div className="connector-row">
              <span className="connector-icon notion">N</span>
              <div>
                <strong>Notion</strong>
                <Badge
                  size="sm"
                  tone={
                    notion?.status === 'connected'
                      ? 'success'
                      : notion?.status === 'error'
                        ? 'danger'
                        : 'neutral'
                  }
                  dot
                >
                  {notion?.status || 'disconnected'}
                </Badge>
                <small className="connector-detail">{notion?.detail}</small>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void run(() => api.connect('notion'))}
              >
                {notion?.status === 'connected' ? 'Reconnect' : 'Connect'}
              </Button>
              <Button variant="ghost" size="sm" disabled={notion?.status === 'disconnected'}
                onClick={() => void run(() => api.disconnect('notion'))}>Disconnect</Button>
            </div>
            <div className="connector-note">
              <ShieldCheck size={15} /> OAuth tokens and secrets are encrypted with macOS
              Keychain-backed storage.
            </div>
          </Card>
<GmailSettings state={data.gmail} /></div>
<div className="settings-category" hidden={!!query.trim() || category !== 'tasks'}><PersonalIntegrations reminders={data.reminders} />
<DelegationSettings state={data.delegation} connected={notion?.status === 'connected'} /></div>
<div className="settings-category" hidden={!!query.trim() || category !== 'memory'}><BrainBridgeSettings state={data.brainBridge} /></div>
<div className="settings-category" hidden={!!query.trim() || category !== 'browser'}><Card className="content-panel settings-panel browser-settings" variant="outline" padding="none" as="section">
            <div className="panel-heading">
              <div>
                <h2>Browser</h2>
                <p>Let agents browse and work on websites in a separate Chrome profile.</p>
              </div>
              <Button variant="outline" size="sm" aria-pressed={data.browser.enabled}
                disabled={browserPending}
                onClick={() => browserAction(() => api.setBrowserEnabled(!data.browser.enabled))}>
                {data.browser.enabled ? 'Disable browser' : 'Enable browser'}
              </Button>
            </div>
            <div className="browser-settings-body">
              <div className="browser-status" role="status">
                <Badge size="sm" dot tone={data.browser.status === 'error' ? 'danger' : data.browser.enabled ? 'success' : 'neutral'}>
                  {data.browser.status}
                </Badge>
                <span>{data.browser.detail}</span>
              </div>
              <p>Open the browser to sign in to your websites. Logins stay on this Mac, separately from your personal Chrome profile. Google Chrome must be installed.</p>
              <p>Chats and tasks ask once per response for permission to read pages and take actions, including form submissions. One agent controls the browser at a time. Routines do not have browser access.</p>
              <div className="browser-actions">
                <Button variant="outline" size="sm" disabled={!data.browser.enabled || browserPending || !!data.browser.threadId}
                  onClick={() => browserAction(() => api.openBrowser())}>Open browser to sign in</Button>
                <Button variant="outline" size="sm" disabled={!data.browser.enabled}
                  onClick={() => void run(() => api.stopBrowser())}>Stop browser</Button>
              </div>
            </div>
          </Card>
<Card className="content-panel settings-panel" variant="outline" padding="none" as="section">
            <div className="panel-heading"><div><h2>Document review</h2><p>Use Aegir's built-in editor and passage comments by default. Enable Malcolm's human-review integration to also review task documents in your browser. Requires human-review installed and available to your agent.</p></div>
              <Button variant="outline" size="sm" aria-pressed={!!data.browserReviewEnabled} disabled={browserPending} onClick={() => browserAction(() => api.setBrowserReviewEnabled(!data.browserReviewEnabled))}>{data.browserReviewEnabled ? 'Disable browser review' : 'Enable browser review'}</Button>
            </div>
          </Card></div>
<div className="settings-category" hidden={!!query.trim() || category !== 'updates'}><UpdateSettings value={data.updates} />
{onSetup && <Card className="content-panel settings-panel" variant="outline" padding="none" as="section">
            <div className="panel-heading"><div><h2>Getting started</h2><p>Current setup: {data.onboarding?.choiceRequired ? 'Not selected yet' : data.onboarding?.setup?.preset === 'legolas' ? 'Legolas · Claude Code and Obsidian brain' : 'Aegir · Codex and built-in memory'}. Review setup to change providers or check your connections.</p></div>
              <Button variant="outline" size="sm" onClick={onSetup}>{data.onboarding?.completed ? 'Review setup' : 'Continue setup'}</Button>
            </div>
          </Card>}</div>
      </div>
    </div>
  </div>;
}
