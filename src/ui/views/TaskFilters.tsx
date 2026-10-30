import { useRef, useState } from 'react';
import type { Task, TaskList } from '../../../shared/types';
import { defaultTaskFilter, readTaskFilter, selectedLabels, type TaskFilter, type SavedTaskView, type TaskScope } from '../../../shared/task-filters';
import { taskLabels } from '../../../shared/task-labels';
import { Button } from '../design-system/primitives';
import { api } from './common';
export function loadTaskFilters(list: string): { filter: TaskFilter; saved: { name: string; filter: TaskFilter }[] } {
  try { const value = JSON.parse(localStorage.getItem(`aegir.task-filters.${list}`) || '{}'); return { filter: readTaskFilter(value.filter), saved: Array.isArray(value.saved) ? value.saved.filter((item: { name: string }) => item && typeof item.name === 'string').slice(0, 30).map((item: { name: string; filter: TaskFilter }) => ({ name: item.name, filter: readTaskFilter(item.filter) })) : [] }; }
  catch { return { filter: { ...defaultTaskFilter }, saved: [] }; }
}
export function TaskFilters({ list, tasks, lists, value, onChange, priorities, scope, onScope, saved, views, onOpen, onDeleted }: {
  list: string; tasks: Task[]; lists: TaskList[]; value: TaskFilter; onChange: (value: TaskFilter) => void; priorities: boolean; scope: TaskScope; onScope: (scope: TaskScope) => void;
  saved?: SavedTaskView; views: SavedTaskView[]; onOpen: (id: string) => void; onDeleted: () => void;
}) {
  const [name, setName] = useState(saved?.name || '');
  const [error, setError] = useState(''), [pending, setPending] = useState(false);
  const busy = useRef(false);
  const persist = (filter: TaskFilter) => {
    onChange(filter);
    if (saved) return;
    try { const previous = loadTaskFilters(list); localStorage.setItem(`aegir.task-filters.${list}`, JSON.stringify({ ...previous, filter })); setError(''); } catch { setError('Could not save these view preferences.'); }
  };
  const labels = [...new Set([...tasks.flatMap(taskLabels), ...selectedLabels(value)])].sort();
  const selected = selectedLabels(value);
  const save = async (copy = false) => {
    if (busy.current || !name.trim()) return;
    busy.current = true; setPending(true); setError('');
    try { const same = saved ? undefined : views.find(view => view.name === name.trim() && view.scope === scope); const view = { id: copy ? crypto.randomUUID() : saved?.id ?? same?.id ?? crypto.randomUUID(), name: name.trim(), scope, filter: value }; await api.saveTaskView(view); onOpen(view.id); }
    catch (e) { setError((e as Error).message); } finally { busy.current = false; setPending(false); }
  };
  const activeCount = Number(!!(value.label || selected.length)) + Number(!!value.status) + Number(priorities && !!value.priority) + Number(value.sort !== 'default' && (priorities || value.sort !== 'priority'));
  const active = activeCount > 0;
  return <details className="ws-task-filters" open={list === 'all' ? true : undefined}><summary><span>Filter and sort</span>{active && <span className="ws-filter-count">{activeCount} active</span>}</summary>
    <fieldset className="ws-filter-fields" disabled={pending}>
      <legend className="sr-only">Filtered view settings</legend>
      <details className="ws-filter-section"><summary>Labels<span>{value.label === '__none' ? 'No labels' : selected.length ? `${selected.length} selected` : 'Any'}</span></summary><fieldset className="ws-label-choices"><legend>Labels</legend>
        <label><input type="checkbox" checked={value.label === '__none'} onChange={e => persist({ ...value, label: e.target.checked ? '__none' : '', labels: [] })} />No labels only</label>
        {labels.map(label => <label key={label}><input aria-label={`Filter label ${label}`} type="checkbox" checked={value.label !== '__none' && selected.includes(label)} onChange={e => persist({ ...value, label: '', labels: e.target.checked ? [...selected, label] : selected.filter(item => item !== label) })} />#{label}</label>)}
        {!labels.length && <p>No labels yet. Add labels to a task first.</p>}
      </fieldset>
      {selected.length > 1 && <label>Match labels<select aria-label="Match labels" value={value.labelMode ?? 'all'} onChange={e => persist({ ...value, labelMode: e.target.value as 'all' | 'any' })}><option value="all">All selected labels</option><option value="any">Any selected label</option></select></label>}
      </details>
      <div className="ws-filter-grid">
      <label>Status<select aria-label="Status" value={value.status} onChange={e => persist({ ...value, status: e.target.value })}><option value="">All statuses</option>{[['proposed','Suggested'],['ready','Open'],['running','Working'],['review','Ready for review'],['blocked','Blocked'],['done','Completed']].map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {priorities && <label>Priority<select aria-label="Priority" value={value.priority} onChange={e => persist({ ...value, priority: e.target.value })}><option value="">All priorities</option><option value="none">No priority</option>{[1,2,3].map(p => <option key={p} value={p}>P{p}</option>)}</select></label>}
      <label>Sort<select aria-label="Sort" value={value.sort} onChange={e => persist({ ...value, sort: e.target.value as TaskFilter['sort'] })}>{[['default','Default'],['due','Deadline'],...(priorities ? [['priority','Priority']] : []),['title','Title'],['newest','Newest first']].map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      </div>
      {active && <Button type="button" variant="ghost" size="sm" onClick={() => persist({ ...defaultTaskFilter })}>Reset filters</Button>}
      <details className="ws-filter-section"><summary>View settings<span>{saved ? saved.name : 'Save or change scope'}</span></summary>
      <label>Scope<select aria-label="View scope" value={scope} onChange={e => onScope(e.target.value as TaskScope)}>{[['all','All open tasks'],['inbox','Inbox'],['today','Today'],['upcoming','Upcoming'],['team','Delegated'],['needs','Needs you'],['completed','Completed'],...lists.map(item => [`list:${item.id}`,item.name])].map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>

      <div className="ws-filter-save"><label>Save view as<input aria-label="Save view as" maxLength={60} value={name} onChange={e => setName(e.target.value)} /></label>
      <Button type="button" variant="outline" size="sm" disabled={!name.trim()} onClick={() => void save()}>{pending ? 'Saving…' : saved ? 'Update view' : 'Save view'}</Button>
      {saved && <><Button type="button" variant="outline" size="sm" disabled={!name.trim()} onClick={() => void save(true)}>Save as new view</Button><Button type="button" variant="ghost" size="sm" onClick={() => {
        if (busy.current) return; busy.current = true; setPending(true); setError('');
        void api.deleteTaskView(saved.id).then(onDeleted).catch(e => setError((e as Error).message)).finally(() => { busy.current = false; setPending(false); });
      }}>Delete view</Button></>}
      </div></details>
    </fieldset>
    {error && <p role="alert">{error}</p>}
  </details>;
}
