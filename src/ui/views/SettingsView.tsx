import { GmailSettings } from './GmailSettings';
import { TypographySettings } from './TypographySettings';
import { ExternalLink, Plus, ShieldCheck, SquareArrowOutUpRight, X } from 'lucide-react';
import { useState } from 'react';
import { modelTierForRole } from '../../../shared/model-policy';
import type { Agent, Snapshot } from '../../../shared/types';
import { Badge, Button, Card } from '../design-system/primitives';
import { api, Avatar, type Run } from './common';
import { AgentSkillsSummary } from './SkillBindings';
import { PageHeader } from './PageHeader';

export function SettingsView({ data, run, onSkills, onSetup }: { data: Snapshot; run: Run; onSkills: (id?: string) => void; onSetup?: () => void }) {
  const [clientId, setClientId] = useState(data.mcpSettings.slackClientId);
  const [composioKey, setComposioKey] = useState('');
  const [composioAccount, setComposioAccount] = useState(data.mcpSettings.composioSlackAccount || '');
  const [composioPending, setComposioPending] = useState(false);
  const composio = data.connectors.find(x => x.id === 'composio');
  const composioAction = (action: () => Promise<unknown>) => void run(async () => {
    setComposioPending(true);
    try { await action(); } finally { setComposioPending(false); setComposioKey(''); }
  });
  const [clientSecret, setClientSecret] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Agent | null>(null);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const [browserPending, setBrowserPending] = useState(false);
  const browserAction = (action: () => Promise<unknown>) => void run(async () => {
    setBrowserPending(true);
    try { await action(); } finally { setBrowserPending(false); }
  });
  const slack = data.connectors.find((x) => x.id === 'slack')!;
  const notion = data.connectors.find((x) => x.id === 'notion')!;
  return (
    <div className="page-scroll supporting-page">
      <PageHeader
        eyebrow="WORKSPACE / SETTINGS"
        title="Your workspace"
        description="Shape your agents, connect your sources, and choose how the app runs."
      />
      <div className="settings-grid settings-controls">
        <div className="settings-main">
          {onSetup && <Card className="content-panel settings-panel" variant="outline" padding="none" as="section">
            <div className="panel-heading"><div><h2>Getting started</h2><p>Set up Codex, local memory, and your connected services.</p></div>
              <Button variant="outline" size="sm" onClick={onSetup}>{data.onboarding?.completed ? 'Review setup' : 'Continue setup'}</Button>
            </div>
          </Card>}
          <TypographySettings value={data.typography} />
          <Card className="content-panel settings-panel" variant="outline" padding="none" as="section">
            <div className="panel-heading"><div><h2>Document review</h2><p>Use Aegir's built-in editor and passage comments by default. Enable Malcolm's human-review integration to also review task documents in your browser. Requires human-review installed and available to your agent.</p></div>
              <Button variant="outline" size="sm" aria-pressed={!!data.browserReviewEnabled} disabled={browserPending} onClick={() => browserAction(() => api.setBrowserReviewEnabled(!data.browserReviewEnabled))}>{data.browserReviewEnabled ? 'Disable browser review' : 'Enable browser review'}</Button>
            </div>
          </Card>
          <GmailSettings state={data.gmail} />
          <Card className="content-panel settings-panel browser-settings" variant="outline" padding="none" as="section">
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
            <div className="panel-heading">
              <div>
                <h2>Skills</h2>
                <p>Manage shared and agent-owned skills, imports, and proposed changes.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => onSkills()}>Manage skills</Button>
            </div>
          </Card>
          <Card className="content-panel settings-panel" variant="outline" padding="none" as="section">
            <div className="panel-heading">
              <div>
                <h2>Startup</h2>
                <p>Open Aegir automatically when you log in to your Mac.</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                aria-pressed={data.launchAtLogin}
                onClick={() => void run(() => api.setLaunchAtLogin(!data.launchAtLogin))}
              >
                {data.launchAtLogin ? 'Disable start at login' : 'Start at login'}
              </Button>
            </div>
          </Card>
          <Card
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
            <div className="connector-setup">
              <p>Use the consumer API key from Composio’s AI Clients setup, or leave it blank to sign in through your browser. A saved key is reused; disconnect to clear it and switch to browser sign-in.</p>
              <div className="form-row">
                <input aria-label="Expected Composio Slack account" placeholder="Expected Slack account ID" value={composioAccount}
                  disabled={composioPending} onChange={event => setComposioAccount(event.target.value)} />
                <input aria-label="Composio consumer API key" type="password" autoComplete="off" placeholder={data.mcpSettings.composioConfigured ? 'Credential saved' : 'Consumer API key (optional)'}
                  value={composioKey} disabled={composioPending} onChange={event => setComposioKey(event.target.value)} />
              </div>
              <p>Agents check the expected account against Composio’s connection status. Known Slack read actions are available to tasks and routines; other Slack actions require approval in chat. Manage Slack accounts in Composio.</p>
            </div>
            <div className="connector-row">
              <span className="connector-icon slack">#</span>
              <div>
                <strong>Slack</strong>
                <Badge
                  size="sm"
                  tone={
                    slack.status === 'connected'
                      ? 'success'
                      : slack.status === 'error'
                        ? 'danger'
                        : 'neutral'
                  }
                  dot
                >
                  {slack.status}
                </Badge>
                <small className="connector-detail">{slack.detail}</small>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void run(() => api.connect('slack', clientId, clientSecret))}
              >
                {slack.status === 'connected' ? 'Reconnect' : 'Connect'}
              </Button>
            </div>
            {slack.status !== 'connected' && (
              <div className="connector-setup">
                <p>
                  Use an internal Slack app with MCP enabled. Set its OAuth redirect URL to{' '}
                  <code>http://127.0.0.1:8765/callback/slack</code>.
                </p>
                <div className="form-row">
                  <input
                    placeholder="Slack Client ID"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                  />
                  <input
                    type="password"
                    placeholder="Client Secret"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                  />
                </div>
                <button
                  className="link-button"
                  onClick={() => void run(() => api.openExternal('https://api.slack.com/apps'))}
                >
                  Open Slack app settings <ExternalLink size={12} />
                </button>
              </div>
            )}
            <div className="connector-row">
              <span className="connector-icon notion">N</span>
              <div>
                <strong>Notion</strong>
                <Badge
                  size="sm"
                  tone={
                    notion.status === 'connected'
                      ? 'success'
                      : notion.status === 'error'
                        ? 'danger'
                        : 'neutral'
                  }
                  dot
                >
                  {notion.status}
                </Badge>
                <small className="connector-detail">{notion.detail}</small>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void run(() => api.connect('notion'))}
              >
                {notion.status === 'connected' ? 'Reconnect' : 'Connect'}
              </Button>
              <Button variant="ghost" size="sm" disabled={notion.status === 'disconnected'}
                onClick={() => void run(() => api.disconnect('notion'))}>Disconnect</Button>
            </div>
            <div className="connector-note">
              <ShieldCheck size={15} /> OAuth tokens and secrets are encrypted with macOS
              Keychain-backed storage.
            </div>
          </Card>
          <Card
            className="content-panel settings-panel"
            variant="outline"
            padding="none"
            as="section"
          >
            <div className="panel-heading">
              <div>
                <h2>Agent personalities</h2>
                <p>Each agent has a role, its own instructions, and reusable skills.</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon
                aria-label="New agent"
                onClick={() => {
                  setDraft(null);
                  setEditing('new');
                }}
              >
                <Plus size={17} />
              </Button>
            </div>
            {data.agents.map((agent) => (
              <div className="settings-agent" key={agent.id}>
                <Avatar agent={agent} size={34} />
                <div>
                  <strong>{agent.name}</strong>
                  <small>
                    {agent.role} ·{' '}
                    {modelTierForRole(agent.role) === 'default'
                      ? 'Codex default model'
                      : 'Lightweight model'}
                  </small>
                </div>
                <AgentSkillsSummary agentId={agent.id} onOpen={onSkills}/>
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
                  <strong>{editing === 'new' ? 'New agent' : `Edit ${draft?.name}`}</strong>
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
                {editing === 'new' ? (
                  <>
                    <input
                      aria-label="Agent name"
                      placeholder="Name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                    />
                    <input
                      aria-label="Agent role"
                      placeholder="Role"
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value)}
                    />
                    <textarea
                      aria-label="Agent instructions"
                      placeholder="Personality and instructions"
                      value={draft?.instructions || ''}
                      onChange={(e) =>
                        setDraft((current) => ({
                          ...(current || {
                            id: '',
                            name: newName,
                            role: newRole,
                            color: '#8f79dd',
                            createdAt: '',
                          }),
                          instructions: e.target.value,
                        }))
                      }
                      rows={4}
                    />
                    <Button
                      size="sm"
                      disabled={!newName.trim() || !newRole.trim()}
                      onClick={() =>
                        void run(async () => {
                          await api.createAgent({
                            name: newName.trim(),
                            role: newRole.trim(),
                            color: '#8f79dd',
                            instructions: draft?.instructions || '',
                          });
                          setEditing(null);
                          setNewName('');
                          setNewRole('');
                          setDraft(null);
                        })
                      }
                    >
                      Create agent
                    </Button>
                  </>
                ) : (
                  draft && (
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
                  )
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
