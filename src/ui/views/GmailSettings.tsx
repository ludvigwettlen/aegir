import { useState } from 'react';
import type { GmailState } from '../../../shared/gmail';
import { Button, Card } from '../design-system/primitives';
import { api } from './common';
export function GmailSettings({ state }: { state?: GmailState }) {
  const [account, setAccount] = useState(state?.account || '');
  const [email, setEmail] = useState(state?.email || '');
  const [enabled, setEnabled] = useState(state?.enabled ?? true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const action = async (sync: boolean) => {
    setPending(true); setError('');
    try { if (sync) await api.syncGmail(); else await api.configureGmail(account, email, enabled); }
    catch (cause) { setError(String(cause)); } finally { setPending(false); }
  };
  return <Card className="content-panel settings-panel gmail-settings" variant="outline" padding="none" as="section">
    <div className="panel-heading"><div><h2>Gmail via Composio</h2><p>Read email and draft replies in chat. Every send requires your approval.</p></div></div>
    <label>Composio Gmail account<input value={account} onChange={e => setAccount(e.target.value)} placeholder="Gmail account alias" disabled={pending || state?.syncing} /></label>
    <label>Gmail address<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" disabled={pending || state?.syncing} /></label>
    <label className="gmail-sync-choice"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} disabled={pending || state?.syncing} />Add emails needing my reply to Inbox automatically</label>
    <p>Checks every 15 minutes while Aegir is running, including read mail from the last 30 days. Calendar, promotional and automated mail are excluded. Uses your existing Composio CLI connection.</p>
    <div className="gmail-actions"><Button size="sm" disabled={pending || state?.syncing || !account || !email} onClick={() => void action(false)}>{pending ? 'Working…' : 'Verify and save'}</Button>
      <Button variant="outline" size="sm" disabled={pending || state?.syncing || !state?.account} onClick={() => void action(true)}>{state?.syncing ? 'Checking email…' : 'Check inbox now'}</Button></div>
    <p role="status">{state?.account ? `Connected account: ${state.email}` : 'Gmail not configured'}{state?.lastSyncedAt ? ` · Last checked ${new Date(state.lastSyncedAt).toLocaleString()}` : ''}</p>
    {state?.summary && <p>{state.summary}</p>}
    {(error || state?.error) && <p role="alert">{error || state?.error}</p>}
  </Card>;
}
