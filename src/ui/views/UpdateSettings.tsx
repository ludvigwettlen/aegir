import { useState } from 'react';
import type { UpdateState } from '../../../shared/updates';
import { Button, Card } from '../design-system/primitives';
import { api } from './common';

export function UpdateSettings({ value }: { value?: UpdateState }) {
  const [token, setToken] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const action = async (operation: () => Promise<unknown>) => {
    setPending(true); setError('');
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setPending(false); }
  };
  if (!value) return null;
  const busy = pending || ['checking', 'downloading', 'installing'].includes(value.status);
  return <Card className="content-panel settings-panel" variant="outline" padding="none" as="section">
    <div className="panel-heading"><div><h2>App updates</h2><p>Installed version {value.version}. Updates are published from the Aegir repository.</p></div>
      <Button variant="outline" size="sm" disabled={busy || !value.configured} onClick={() => void action(() => api.checkUpdates())}>Check for updates</Button>
    </div>
    <div className="browser-settings-body update-settings-body">
      <p role="status" aria-live="polite">{value.message}</p>
      {value.availableVersion && <p><strong>Version {value.availableVersion}</strong></p>}
      {value.notes && <p className="update-release-notes">{value.notes}</p>}
      {value.status === 'downloading' && <progress aria-label="Update download progress" max={100} value={value.progress || 0} />}
      <div className="update-actions">
        {value.status === 'available' && <Button size="sm" disabled={busy} onClick={() => void action(() => api.downloadUpdate())}>Download update</Button>}
        {value.status === 'ready' && <Button size="sm" disabled={busy} onClick={() => void action(() => api.installUpdate())}>Restart to update</Button>}
        {['checking', 'downloading'].includes(value.status) && <Button variant="outline" size="sm" onClick={() => void api.cancelUpdate()}>Cancel</Button>}
      </div>
      <details>
        <summary>GitHub access · {value.authenticated ? 'saved on this Mac' : 'required for this private repository'}</summary>
        <p>Use your own GitHub token. Repository owners can use a fine-grained token restricted to Aegir with Contents: read. Collaborators may need a classic token with repo access, which grants broader access to their private repositories. Aegir only uses it to read releases, and encrypts it on this Mac using macOS Keychain.</p>
        <p><a href="https://github.com/settings/personal-access-tokens/new" onClick={event => { event.preventDefault(); void api.openExternal('https://github.com/settings/personal-access-tokens/new'); }}>Create a fine-grained token</a>{' · '}<a href="https://github.com/settings/tokens/new" onClick={event => { event.preventDefault(); void api.openExternal('https://github.com/settings/tokens/new'); }}>Create a classic token</a></p>
        <label className="ws-field"><span>GitHub access token</span><input type="password" autoComplete="off" spellCheck={false} value={token} disabled={busy} onChange={event => setToken(event.target.value)} /></label>
        <div className="update-actions">
          <Button variant="outline" size="sm" disabled={busy || !token.trim()} onClick={() => void action(async () => { await api.saveUpdateToken(token.trim()); setToken(''); })}>Save access</Button>
          {value.authenticated && <Button variant="outline" size="sm" disabled={busy} onClick={() => void action(() => api.saveUpdateToken(''))}>Remove access</Button>}
        </div>
      </details>
      {error && <p className="ws-field-error" role="alert">{error}</p>}
    </div>
  </Card>;
}
