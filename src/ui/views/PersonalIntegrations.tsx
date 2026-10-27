import { useState } from 'react';
import type { ClaudeRoutines, RemindersState } from '../../../shared/types';
import { Button, Card } from '../design-system/primitives';
import { api } from './common';
export function PersonalIntegrations({ reminders }: { reminders?: RemindersState }) {
  const [list, setList] = useState(reminders?.list || 'Reminders');
  const [enabled, setEnabled] = useState(reminders?.enabled || false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [external, setExternal] = useState<ClaudeRoutines | null>(null);
  const act = async (action: () => Promise<unknown>) => { if (pending) return; setPending(true); setError(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setPending(false); } };
  return <Card className="content-panel settings-panel" variant="outline" padding="none" as="section">
    <div className="panel-heading"><div><h2>Personal integrations</h2><p>Optional integrations available with either setup.</p></div></div>
    <div className="personal-integrations">
      <fieldset disabled={pending || reminders?.syncing}><legend>Apple Reminders capture</legend>
        <p>Import non-repeating reminders from one list. Imported reminders are completed after their alerts have had time to fire. Location alerts stay in Reminders.</p>
        <label><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Enable capture</label>
        <label>Reminders list<input value={list} onChange={e => setList(e.target.value)} maxLength={100} /></label>
        <Button variant="outline" size="sm" onClick={() => void act(() => api.configureReminders(enabled, list))}>Save capture settings</Button>
        <Button variant="outline" size="sm" disabled={!reminders?.enabled} onClick={() => void act(() => api.syncReminders())}>Check Reminders now</Button>
      </fieldset>
      <p role="status">{reminders?.syncing ? 'Checking…' : reminders?.detail || 'Capture is off.'}{reminders?.lastSyncAt ? ` · Last checked ${new Date(reminders.lastSyncAt).toLocaleString()}` : ''}</p>
      <h3>External Claude routines</h3><p>Read scheduled tasks from the Claude desktop app. Manage these in Claude; Aegir does not run or change them.</p>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => void act(async () => setExternal(await api.claudeRoutines()))}>{pending ? 'Loading…' : 'Refresh external routines'}</Button>
      {external && <><p>{external.tasks.length ? `${external.tasks.length} routines` : 'No supported Claude schedules found.'}</p>{external.tasks.map(task => <details key={task.id}><summary>{task.name} · {task.enabled ? 'On' : 'Paused'} · {task.schedule}</summary><p>{task.description}</p>{task.runs.length ? task.runs.map((item, i) => <p key={i}>{new Date(item.startedAt).toLocaleString()} · {item.status} · {item.detail}{item.needsAction ? ` · ${item.needsAction}` : ''}</p>) : <p>No recent runs found.</p>}</details>)}</>}
      {error && <p role="alert">{error}</p>}
    </div>
  </Card>;
}
