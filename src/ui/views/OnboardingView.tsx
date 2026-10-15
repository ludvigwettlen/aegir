import { ArrowLeft, ArrowRight, Brain, Check, Download, ExternalLink, Link2, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../../../shared/types';
import type { OnboardingState, SetupDependency, SetupStep } from '../../../shared/onboarding';
import { Badge, Button, Card } from '../design-system/primitives';
import { api } from './common';

const steps: { id: SetupStep; title: string; description: string }[] = [
  { id: 'codex', title: 'Connect your AI', description: 'Codex & your account' },
  { id: 'memory', title: 'Give it a memory', description: 'Private, local memory' },
  { id: 'connections', title: 'Connect your work', description: 'Your apps & sources' },
];
const labels: Record<SetupDependency['status'], string> = {
  unchecked: 'Not checked', checking: 'Checking', missing: 'Setup needed', working: 'In progress', 'needs-sign-in': 'Sign-in needed', ready: 'Ready', error: 'Needs attention',
};

export function OnboardingView({ data, onClose, onSettings }: { data: Snapshot; onClose: () => void; onSettings: () => void }) {
  const [state, setState] = useState<OnboardingState>(data.onboarding!);
  const [step, setStep] = useState(state.step);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [clientId, setClientId] = useState(data.mcpSettings.slackClientId);
  const [clientSecret, setClientSecret] = useState('');
  const [account, setAccount] = useState(data.mcpSettings.composioSlackAccount || '');
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(true);
  useEffect(() => { if (data.onboarding) setState(data.onboarding); }, [data.onboarding]);
  useEffect(() => {
    mounted.current = true;
    const check = () => { void api.checkSetup().then(value => { if (mounted.current) setState(value); }).catch(cause => { if (mounted.current) setError(String(cause)); }); };
    check(); window.addEventListener('focus', check);
    return () => { mounted.current = false; window.removeEventListener('focus', check); };
  }, []);
  useEffect(() => { heading.current?.focus(); }, [step]);
  const act = async (action: () => Promise<unknown>) => {
    if (pending) return;
    setPending(true); setError('');
    try { const result = await action(); if (mounted.current && result && typeof result === 'object' && 'showOnLaunch' in result) setState(result as OnboardingState); }
    catch (cause) { if (mounted.current) setError(String(cause).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')); }
    finally { if (mounted.current) setPending(false); }
  };
  const working = pending || state.busy;
  const signingIn = state.codex.status === 'working' && !state.busy;
  const locked = working || signingIn;
  const position = steps.findIndex(item => item.id === step);
  const go = (next: SetupStep) => void act(async () => { const saved = await api.saveSetup(next, 'continue'); setStep(next); return saved; });
  const leave = (settings = false) => void act(async () => { await api.saveSetup(step, 'later'); settings ? onSettings() : onClose(); });
  const ready = state.codex.status === 'ready' && state.memory.status === 'ready';
  const notion = data.connectors.find(item => item.id === 'notion');
  const composio = data.connectors.find(item => item.id === 'composio');
  const slack = data.connectors.find(item => item.id === 'slack');
  const status = (dependency: SetupDependency) => <div className={`setup-status ${dependency.status === 'error' ? 'setup-status-error' : ''}`} role="status" aria-live="polite">
    <Badge tone={dependency.status === 'ready' ? 'success' : dependency.status === 'error' ? 'danger' : 'neutral'}>{labels[dependency.status]}</Badge>
    <span>{dependency.detail}</span>
    {dependency.diagnostic && <details><summary>Details for your setup helper</summary><p>{dependency.diagnostic}</p></details>}
  </div>;
  return <main className="setup-page">
    <div className="setup-topbar"><span className="setup-brand"><Sparkles size={21} /> Aegir</span><Button variant="ghost" size="sm" disabled={locked} onClick={() => leave()}>Set up later</Button></div>
    <div className="setup-layout">
      <aside className="setup-intro">
        <p className="setup-eyebrow">WELCOME TO YOUR WORKSPACE</p><h1>Make Aegir<br />yours.</h1>
        <p>A little setup, then a team that knows your work. We’ll guide you through each step.</p>
        <nav aria-label="Setup steps"><ol>{steps.map((item, index) => {
          const done = item.id === 'connections' ? state.completed : state[item.id].status === 'ready';
          return <li key={item.id}><button disabled={locked} aria-current={step === item.id ? 'step' : undefined} onClick={() => go(item.id)}>
            <span className="setup-step-number">{done ? <Check size={16} aria-label="Ready" /> : index + 1}</span>
            <span><strong>{item.title}</strong><small>{item.description}</small></span>
          </button></li>;
        })}</ol></nav>
        <p className="setup-footnote">Your progress is saved on this Mac. You can return anytime from Settings → Getting started.</p>
      </aside>
      <Card className="setup-card" variant="outline" padding="none" as="section" aria-labelledby="setup-heading">
        <div className="setup-content">
          <p className="setup-eyebrow">STEP {position + 1} OF 3</p>
          <h2 id="setup-heading" ref={heading} tabIndex={-1}>{steps[position].title}</h2>
          {step === 'codex' && <>
            <div className="setup-feature-icon"><Sparkles size={28} /></div>
            <p className="setup-lead">Codex powers your agent team.</p>
            <p>Use your own ChatGPT account. If Codex is already set up on this Mac, Aegir can use it. Otherwise, we can install it for you.</p>
            {status(state.codex)}
            <div className="setup-actions">
              {state.codex.status !== 'ready' && state.codex.status !== 'needs-sign-in' && <Button disabled={locked} onClick={() => void act(() => api.installSetupComponent('codex'))}><Download size={16} /> Install Codex</Button>}
              {(state.codex.status === 'needs-sign-in' || state.codex.status === 'error') && <Button disabled={locked} onClick={() => void act(() => api.signInCodex())}>Sign in with ChatGPT <ExternalLink size={15} /></Button>}
              {signingIn ? <Button variant="outline" disabled={pending} onClick={() => void act(() => api.cancelCodexSignIn())}>Cancel sign-in</Button> : <Button variant="outline" disabled={working} onClick={() => void act(() => api.checkSetup())}>Check again</Button>}
            </div>
            <div className="setup-note"><strong>No Terminal needed.</strong><p>Installation downloads Codex from OpenAI into Aegir’s storage. Sign-in opens in your browser. Your account’s access and usage limits apply.</p></div>
          </>}
          {step === 'memory' && <>
            <div className="setup-feature-icon"><Brain size={28} /></div>
            <p className="setup-lead">Help your team remember what matters.</p>
            <p>Mnemosyne saves preferences and useful context between conversations. The memory database stays on this Mac; relevant memories are sent to your AI provider when your agents use them.</p>
            {status(state.memory)}
            <div className="setup-actions">
              {state.memory.status !== 'ready' && <Button disabled={locked} onClick={() => void act(() => api.installSetupComponent('memory'))}><Download size={16} /> Set up memory</Button>}
              <Button variant="outline" disabled={locked} onClick={() => void act(() => api.checkSetup())}>Check again</Button>
            </div>
            <div className="setup-note"><strong>We’ll take care of the installation.</strong><p>Aegir downloads Python, Mnemosyne, and its local search dependencies. This may take several minutes and needs an internet connection. Keep Aegir open until it finishes.</p><p>Existing memory is kept. You won’t need an administrator password or any commands.</p></div>
          </>}
          {step === 'connections' && <>
            <p className="setup-lead">Bring your work into the conversation.</p><p>Connect the services you use. These are optional, and you can add more in Settings later.</p>
            <div className="setup-connection"><div><strong>Notion</strong><p>Find notes, documents, and project context.</p><small role="status">{notion?.detail || 'Not connected'}</small></div>
              <Button variant="outline" size="sm" disabled={working || notion?.status === 'connected' || notion?.status === 'connecting'} onClick={() => void act(() => api.connect('notion'))}>{notion?.status === 'connected' ? 'Connected' : notion?.status === 'connecting' ? 'Connecting…' : 'Connect Notion'}</Button>
              {notion?.status === 'connecting' && <Button variant="ghost" size="sm" onClick={() => void act(() => api.disconnect('notion'))}>Cancel</Button>}
            </div>
            <div className="setup-connection"><div><strong>Slack</strong><p>Find discussions and decisions through Composio.</p><small role="status">{composio?.detail || 'Not connected'}</small></div>
              <Button variant="outline" size="sm" disabled={working || composio?.status === 'connected' || composio?.status === 'connecting'} onClick={() => void act(() => api.connect('composio', account))}>{composio?.status === 'connected' ? 'Composio connected' : composio?.status === 'connecting' ? 'Connecting…' : 'Connect Slack'}</Button>
              {composio?.status === 'connecting' && <Button variant="ghost" size="sm" onClick={() => void act(() => api.disconnect('composio'))}>Cancel</Button>}
            </div>
            <p className="setup-help">First, connect Slack in your own Composio account. Then connect that account here. Your workspace may need an administrator’s approval.</p>
            <Button variant="link" disabled={working} onClick={() => void act(() => api.openExternal('https://composio.dev/'))}>Open Composio <ExternalLink size={14} /></Button>
            <details className="setup-advanced"><summary>Slack setup options for your office helper</summary>
              <label>Expected Composio Slack account ID (optional)<input value={account} onChange={event => setAccount(event.target.value)} /></label>
              <p>Alternatively, use an internal Slack app with MCP enabled and redirect URL <code>http://127.0.0.1:8765/callback/slack</code>.</p>
              <label>Slack client ID<input value={clientId} onChange={event => setClientId(event.target.value)} /></label>
              <label>Slack client secret<input type="password" autoComplete="off" value={clientSecret} onChange={event => setClientSecret(event.target.value)} /></label>
              <Button variant="outline" size="sm" disabled={working || !clientId.trim() || !clientSecret.trim() || slack?.status === 'connecting'} onClick={() => void act(async () => { try { await api.connect('slack', clientId, clientSecret); } finally { setClientSecret(''); } })}>Connect office Slack app</Button>
              <p role="status">{slack?.detail}</p>
              <p>Composio’s connection status only confirms access to Composio. Test a Slack search before relying on it. Gmail and Calendar use the separate Composio CLI at ~/.local/bin/composio; verify Gmail in Settings and Calendar in 1:1 prep.</p>
            </details>
            <div className="setup-connection"><div><strong>Gmail & Google Calendar</strong><p>These currently need a one-time assisted setup. Your office setup helper can connect Gmail in Settings and Calendar in 1:1 prep.</p></div><Link2 size={19} /></div>
            <Button variant="link" disabled={locked} onClick={() => leave(true)}>Open connection settings <ArrowRight size={14} /></Button>
            <div className="setup-note"><strong>{ready ? 'Your essentials are ready.' : 'A couple of essentials still need attention.'}</strong>
              <p>Codex: {labels[state.codex.status]}. Memory: {labels[state.memory.status]}. {ready ? 'You can start using Aegir with or without connections.' : 'Go back to finish these, or choose Set up later to explore the app. Automatic routines stay paused for a new workspace until setup is complete.'}</p>
            </div>
          </>}
          {error && <p className="setup-error" role="alert">{error}</p>}
        </div>
        <footer className="setup-footer">
          {position > 0 ? <Button variant="ghost" disabled={locked} onClick={() => go(steps[position - 1].id)}><ArrowLeft size={15} /> Back</Button> : <span />}
          {position < 2 ? <Button disabled={locked} onClick={() => go(steps[position + 1].id)}>{state[step as 'codex' | 'memory'].status === 'ready' ? 'Continue' : 'Skip this step'} <ArrowRight size={15} /></Button>
            : <Button disabled={locked || !ready} onClick={() => void act(async () => { await api.saveSetup('connections', 'finish'); onClose(); })}>Start using Aegir <ArrowRight size={15} /></Button>}
        </footer>
      </Card>
    </div>
  </main>;
}
