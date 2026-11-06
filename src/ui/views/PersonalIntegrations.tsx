import { useState } from 'react';
import type { RemindersState } from '../../../shared/types';
import { Button, Card } from '../design-system/primitives';
import { api } from './common';
export function PersonalIntegrations({ reminders }: { reminders?: RemindersState }) {
  const [list, setList] = useState(reminders?.list || 'Reminders');
  const [enabled, setEnabled] = useState(reminders?.enabled || false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const act = async (action: () => Promise<unknown>) => { if (pending) return; setPending(true); setError(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setPending(false); } };
  return <Card className="content-panel settings-panel" variant="outline" padding="none" as="section">
    <div className="panel-heading"><div><h2>Personal integrations</h2><p>Optional integrations.</p></div></div>
    <div className="personal-integrations">
      <fieldset disabled={pending || reminders?.syncing}><legend>Apple Reminders capture</legend>
        <p>Import non-repeating reminders from one list. Imported reminders are completed after their alerts have had time to fire. Location alerts stay in Reminders.</p>
        <label><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Enable capture</label>
        <label>Reminders list<input value={list} onChange={e => setList(e.target.value)} maxLength={100} /></label>
        <Button variant="outline" size="sm" onClick={() => void act(() => api.configureReminders(enabled, list))}>Save capture settings</Button>
        <Button variant="outline" size="sm" disabled={!reminders?.enabled} onClick={() => void act(() => api.syncReminders())}>Check Reminders now</Button>
      </fieldset>
      <p role="status">{reminders?.syncing ? 'Checking…' : reminders?.detail || 'Capture is off.'}{reminders?.lastSyncAt ? ` · Last checked ${new Date(reminders.lastSyncAt).toLocaleString()}` : ''}</p>
      {error && <p role="alert">{error}</p>}
    </div>
  </Card>;
}
