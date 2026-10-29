import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import type { Task } from '../../../shared/types';
import { delegationStatuses, type DelegationState, type DelegationStatus, type NotionPerson } from '../../../shared/delegation';
import { Button, Card } from '../design-system/primitives';
import { api } from './common';

function PeoplePicker({ label, value, onChange, disabled }: { label: string; value: NotionPerson[]; onChange: (people: NotionPerson[]) => void; disabled: boolean }) {
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<NotionPerson[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setPeople([]); setError(''); setLoading(query.trim().length >= 2);
    const timer = setTimeout(() => {
      if (query.trim().length < 2) return;
      void api.findDelegationPeople(query).then(rows => { if (active) setPeople(rows); })
        .catch(cause => { if (active) setError(String(cause)); }).finally(() => { if (active) setLoading(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);
  return <div className="ws-people-picker">
    <label>{label}<input aria-label={label} placeholder="Search Notion people…" value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} /></label>
    <div className="ws-person-chips">{value.map(p => <Button key={p.id} size="sm" variant="outline" disabled={disabled} aria-label={`Remove ${p.name} from ${label}`} onClick={() => onChange(value.filter(item => item.id !== p.id))}>{p.name}<X size={12} /></Button>)}</div>
    {loading && <p role="status">Searching…</p>}
    {error && <p role="alert" className="ws-field-error">{error}</p>}
    {!loading && !error && query.trim().length >= 2 && !people.length && <p role="status">No matching people. Try a name or email.</p>}
    <div className="ws-people-results" role="group" aria-label={`${label} results`}>{people.filter(p => !value.some(item => item.id === p.id)).map(p => <Button key={p.id} variant="ghost" size="sm" disabled={disabled} onClick={() => { onChange([...value, p]); setQuery(''); }}>{p.name}{p.email && <small>{p.email}</small>}</Button>)}</div>
  </div>;
}

export function TaskDelegation({ task, connected }: { task: Task; connected: boolean }) {
  const link = task.delegation;
  const [open, setOpen] = useState(false);
  const [assignees, setAssignees] = useState<NotionPerson[]>([]);
  const [tagged, setTagged] = useState<NotionPerson[]>([]);
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<DelegationStatus>(link?.status ?? 'Assigned');
  useEffect(() => { setStatus(link?.status ?? 'Assigned'); }, [link?.status]);
  const action = async (work: () => Promise<void>, close = false) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await work(); if (close) setOpen(false); }
    catch (cause) { setError(String(cause).replace(/^Error: /, '')); }
    finally { pending.current = false; setBusy(false); }
  };
  const unavailable = ['done', 'dismissed', 'proposed', 'running'].includes(task.status);
  return <section className="ws-task-delegation" aria-label="Human delegation">
    <div className="ws-delegation-heading">
      <Dialog.Root open={open} onOpenChange={value => {
        if (pending.current) return;
        if (value) { setAssignees(link?.assignee.id ? [link.assignee] : []); setTagged(link?.taggedPeople ?? []); setBrief(link?.brief ?? ''); setError(''); }
        setOpen(value);
      }}>
        <Dialog.Trigger asChild><Button variant="ghost" size="sm" disabled={unavailable || busy}><UserPlus size={14} />{link ? `Assigned to ${link.assignee.name}` : 'Assign to person'}</Button></Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="ws-list-dialog-overlay" />
          <Dialog.Content className="ws-list-dialog ws-delegation-dialog" onEscapeKeyDown={event => { if (pending.current) event.preventDefault(); }} onPointerDownOutside={event => { if (pending.current) event.preventDefault(); }}>
            <div className="ws-move-title"><Dialog.Title>Assign to person</Dialog.Title><Dialog.Close asChild><Button variant="ghost" size="sm" icon disabled={busy} aria-label="Close assignment"><X size={16} /></Button></Dialog.Close></div>
            <Dialog.Description>Share this task through Notion. The assignee owns the work; tagged people are collaborators.</Dialog.Description>
            <form onSubmit={event => { event.preventDefault(); if (assignees.length === 1) void action(() => api.delegateTask(task.id, { assignee: assignees[0], taggedPeople: tagged, brief }), true); }}>
              <PeoplePicker label="Assignee" value={assignees} onChange={people => setAssignees(people.slice(-1))} disabled={busy} />
              <PeoplePicker label="Tagged people" value={tagged} onChange={setTagged} disabled={busy} />
              <label>Shared brief<textarea aria-label="Shared brief" rows={4} maxLength={10000} disabled={busy} value={brief} onChange={event => setBrief(event.target.value)} placeholder="What should they do? Private notes stay on this Mac." /></label>
              <div className="ws-delegation-preview"><strong>Will be shared</strong><p>{task.title}</p><p>{task.dueAt ? `Due ${task.dueAt}` : 'No due date'}{task.labels?.length ? ` · ${task.labels.map(label => `#${label}`).join(' ')}` : ''}</p><p>The brief and people above are also shared. Notes, files and agent conversations stay local.</p><p>People need access to the tracker in Notion. Tagging does not grant access or guarantee a notification.</p></div>
              {!connected && <p role="status">Connect Notion in Settings to publish.</p>}
              {error && <p role="alert" className="ws-field-error">{error}</p>}
              <Button type="submit" size="sm" disabled={busy || !connected || assignees.length !== 1}>{busy ? 'Publishing…' : link ? 'Publish changes' : 'Assign in Notion'}</Button>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {link?.pageUrl && <Button variant="ghost" size="sm" onClick={() => void api.openExternal(link.pageUrl!)}>Open in Notion</Button>}
    </div>
    {link && <>
      <div className="ws-delegation-status"><label>Shared status<select aria-label="Shared status" value={status} disabled={busy || !connected || link.publishing} onChange={event => setStatus(event.target.value as DelegationStatus)}>{delegationStatuses.map(value => <option key={value}>{value}</option>)}</select></label>
        <Button variant="outline" size="sm" disabled={busy || !connected || status === link.status || link.publishing} onClick={() => void action(() => api.setDelegationStatus(task.id, status))}>Update status</Button>
        <Button variant="ghost" size="sm" disabled={busy || !connected} onClick={() => void action(() => api.syncDelegations())}>{busy ? 'Working…' : 'Refresh'}</Button>
      </div>
      {link.publishing && <p role="status">Publishing is unconfirmed. Refresh to recover the shared record, or retry Publish changes.</p>}
      {link.taggedPeople.length > 0 && <p>Tagged: {link.taggedPeople.map(p => p.name).join(', ')}</p>}
      {link.progress && <p className="ws-delegation-progress">{link.progress}</p>}
      <small>{link.syncedAt ? `Last refreshed ${new Date(link.syncedAt).toLocaleString()}` : 'Not yet synchronized'}. Local completion and shared status are separate.</small>
      {(link.error || (!open && error)) && <p role="alert" className="ws-field-error">{error || link.error}</p>}
    </>}
  </section>;
}

export function DelegationSettings({ state, connected }: { state?: DelegationState; connected: boolean }) {
  const [database, setDatabase] = useState(state?.database ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const act = async (work: () => Promise<void>) => { setBusy(true); setError(''); try { await work(); } catch (cause) { setError(String(cause)); } finally { setBusy(false); } };
  return <Card className="content-panel settings-panel" variant="outline" padding="none" as="section">
    <div className="panel-heading"><div><h2>People and delegation</h2><p>Publish human assignments to a shared Notion tracker. Shared status and progress refresh every two minutes while Aegir is open.</p></div></div>
    <div className="ws-delegation-settings"><label>Notion delegation database<input aria-label="Notion delegation database" value={database} onChange={event => setDatabase(event.target.value)} disabled={busy} /></label>
      <div className="browser-actions"><Button variant="outline" size="sm" disabled={busy || !connected || !database.trim()} onClick={() => void act(() => api.configureDelegation(database.trim()))}>Save and check database</Button>
        <Button variant="ghost" size="sm" disabled={busy || !connected || state?.syncing} onClick={() => void act(() => api.syncDelegations())}>Refresh assignments</Button>
        {state?.database && <Button variant="ghost" size="sm" onClick={() => void api.openExternal(state.database)}>Open tracker</Button>}</div>
      <p>Share the tracker with Malcolm and other collaborators in Notion. They can work there while your Mac is off. This first version tracks outgoing assignments; another Aegir installation does not import them automatically.</p>
      {!connected && <p>Connect Notion below to use delegation.</p>}
      {busy && <p role="status">Checking Notion…</p>}
      {(error || state?.error) && <p className="ws-field-error" role="alert">{error || state?.error}</p>}
    </div>
  </Card>;
}
