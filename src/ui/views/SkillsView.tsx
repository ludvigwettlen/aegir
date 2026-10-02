import { useEffect, useState } from 'react';
import { BookOpen, Plus, Upload } from 'lucide-react';
import type { Snapshot } from '../../../shared/types';
import type { Skill, SkillDetail, SkillFile, SkillProposal } from '../../../shared/skills';
import { PackageDiff } from '../design-system/PackageDiff';
import { newSkillText } from '../../../shared/skills';
import { Button, Badge } from '../design-system/primitives';
import { useSkillLibrary } from '../hooks/useSkillLibrary';
import { api, type Run } from './common';

export function SkillsView({ data, run, initialAgent }: { data: Snapshot; run: Run; initialAgent?: string }) {
  const { library, error, reload } = useSkillLibrary();
  const [filter, setFilter] = useState(initialAgent || 'shared');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const skills = library?.skills || [];
  const shown = skills.filter(skill => (filter === 'archived' ? skill.archived : !skill.archived && (filter === 'proposed' ? library?.proposals.some(p => p.skillId === skill.id) : filter === 'shared' ? !skill.ownerAgentId : !skill.ownerAgentId || skill.ownerAgentId === filter)) && `${skill.name} ${skill.description}`.toLowerCase().includes(query));
  const current = skills.find(skill => skill.id === selected) || shown[0];
  const owner = data.agents.some(agent => agent.id === filter) ? filter : null;
  const act = (action: () => Promise<unknown>) => run(async () => { await action(); await reload(); });
  return <div className="skills-layout">
    <section className="skills-list" aria-label="Skill library">
      <header className="ws-group-head">
        <h1><BookOpen size={19}/> Skills</h1>
        <p>Reusable methods for your agents.</p>
        <div className="skills-actions">
          <Button size="sm" onClick={() => setCreating(true)}><Plus size={14}/> New skill</Button>
          <Button size="sm" variant="outline" onClick={() => void act(async () => { const skill = await api.importSkill(owner); if (skill) { setSelected(skill.id); setCreating(false); } })}><Upload size={14}/> Import</Button>
        </div>
        <label>Library<select value={filter} onChange={e => { setFilter(e.target.value); setSelected(null); setCreating(false); }}>
          <option value="shared">Shared</option>
          {data.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name} · inherited and owned</option>)}
          <option value="proposed">Proposed changes ({library?.proposals.length || 0})</option>
          <option value="archived">Archived</option>
        </select></label>
        <input type="search" aria-label="Search skills" placeholder="Search skills…" value={query} onChange={e => setQuery(e.target.value)}/>
      </header>
      <div className="skills-items" data-keyboard-pane="list" tabIndex={-1}>
        {!library && !error && <p className="ws-empty-line" role="status">Loading skills…</p>}
        {error && <p className="ws-empty-line" role="alert">{error} <button onClick={() => void reload()}>Retry</button></p>}
        {library && !shown.length && <p className="ws-empty-line">{query ? 'No skills match your search.' : filter === 'proposed' ? 'No changes waiting for review.' : 'No skills in this library yet.'}</p>}
        {shown.map(skill => <button key={skill.id} data-keyboard-item data-keyboard-current={current?.id === skill.id ? '' : undefined} className={`skills-item ${!creating && current?.id === skill.id ? 'selected' : ''}`} onClick={() => { setSelected(skill.id); setCreating(false); }}>
          <strong>{skill.name}</strong><span>{skill.description}</span><small>{skill.ownerAgentId ? data.agents.find(a => a.id === skill.ownerAgentId)?.name : 'Shared'}{skill.error ? ' · Invalid package' : skill.archived ? ' · Archived' : !skill.enabled ? ' · Disabled' : ''}{owner && skill.disabledAgentIds.includes(owner) ? ' · Disabled for this agent' : ''}</small>
        </button>)}
      </div>
    </section>
    <main className="skills-detail" data-keyboard-pane="detail" tabIndex={-1}>
      {creating ? <NewSkill key={filter} owner={owner} data={data} run={run} onClose={() => setCreating(false)} onCreated={async skill => { setFilter(skill.ownerAgentId || 'shared'); setSelected(skill.id); setCreating(false); await reload(); }}/>
        : current ? <SkillEditor key={current.id} skill={current} allSkills={skills} data={data} run={run} onReload={reload} onCopy={skill => { setFilter(skill.ownerAgentId || 'shared'); setSelected(skill.id); }}/>
        : <div className="ws-thread-empty"><p>Select a skill or create one.</p></div>}
    </main>
  </div>;
}
function NewSkill({ owner, data, run, onClose, onCreated }: { owner: string | null; data: Snapshot; run: Run; onClose: () => void; onCreated: (skill: Skill) => Promise<void> }) {
  const [text, setText] = useState(newSkillText); const [scope, setScope] = useState(owner || ''); const [busy, setBusy] = useState(false);
  return <div className="skills-editor"><h2>New skill</h2><label>Available to<select value={scope} onChange={e => setScope(e.target.value)}><option value="">Shared library</option>{data.agents.map(a => <option key={a.id} value={a.id}>{a.name} only</option>)}</select></label>
    <label>SKILL.md<textarea className="skill-code" rows={20} value={text} onChange={e => setText(e.target.value)}/></label>
    <div className="skills-actions"><Button disabled={busy} onClick={() => void run(async () => { setBusy(true); try { await onCreated(await api.createSkill({ ownerAgentId: scope || null, files: [{ path: 'SKILL.md', encoding: 'utf8', content: text }] })); } finally { setBusy(false); } })}>Create skill</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
  </div>;
}
function SkillEditor({ skill, allSkills, data, run, onReload, onCopy }: { skill: Skill; allSkills: Skill[]; data: Snapshot; run: Run; onReload: () => Promise<void>; onCopy: (skill: Skill) => void }) {
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [files, setFiles] = useState<SkillFile[]>([]); const [base, setBase] = useState('');
  const [path, setPath] = useState('SKILL.md'); const [newPath, setNewPath] = useState('');
  const [reason, setReason] = useState(''); const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false);
  const [copyOwner, setCopyOwner] = useState(''); const [undoRevision, setUndoRevision] = useState<string | null>(null);
  const [review, setReview] = useState<{ proposal: SkillProposal; before: SkillFile[] } | null>(null);
  const load = async () => { const value = await api.skillDetail(skill.id); setDetail(value); setFiles(value.files); setBase(value.skill.revision); setDirty(false); setReason(''); setReview(null); };
  useEffect(() => { void run(load); }, [skill.id]);
  useEffect(() => api.onEvent(event => {
    if (event.type !== 'skills-changed') return;
    // Refresh review/history metadata without overwriting an unsaved draft.
    void api.skillDetail(skill.id).then(setDetail).catch(() => {});
  }), [skill.id]);
  const act = (fn: () => Promise<unknown>) => run(async () => { setBusy(true); try { await fn(); await load(); await onReload(); } finally { setBusy(false); } });
  const original = allSkills.find(s => s.id === skill.extendsSkillId);
  const file = files.find(f => f.path === path);
  if (!detail) return <p className="ws-empty-line" role="status">Loading skill…</p>;
  return <div className="skills-editor">
    <div className="skills-title"><h2>{skill.name}</h2><Badge>{skill.ownerAgentId ? data.agents.find(a => a.id === skill.ownerAgentId)?.name || 'Agent-owned' : 'Shared'}</Badge></div>
    <p>{skill.description}</p>
    {skill.error && <p className="skills-error" role="alert">{skill.error}</p>}
    {skill.revision !== base && <p role="status">This skill changed while you were editing. Your draft is preserved. <button onClick={() => void run(load)}>Reload latest</button></p>}
    {original && <p>Customized from {original.name}.{original.revision !== skill.extendsRevision ? ' The shared original has changed; review it before updating this copy.' : ''}</p>}
    {skill.requirements && (skill.requirements.platforms.length > 0 || skill.requirements.tools.length > 0 || skill.requirements.runKinds.length > 0) && <details><summary>Requirements</summary><p>{skill.requirements.platforms.length ? `Platforms: ${skill.requirements.platforms.join(', ')}. ` : ''}{skill.requirements.runKinds.length ? `Run types: ${skill.requirements.runKinds.join(', ')}. ` : ''}{skill.requirements.tools.length ? `Tools: ${skill.requirements.tools.join(', ')}. ` : ''}Availability is checked against the tools permitted in each run.</p></details>}
    <p className="skills-meta">{skill.origin} · {skill.loads} file loads · Updated {new Date(skill.updatedAt).toLocaleString()}{skill.source ? ` · ${skill.source}` : ''}</p>
    <div className="skills-actions">
      <Button size="sm" variant="outline" disabled={busy || dirty} onClick={() => void act(() => api.configureSkill(skill.id, { enabled: !skill.enabled }))}>{skill.enabled ? 'Disable' : 'Enable'}</Button>
      <Button size="sm" variant="outline" disabled={busy || dirty} onClick={() => void act(() => api.configureSkill(skill.id, { pinned: !skill.pinned }))}>{skill.pinned ? 'Allow agent changes' : 'Protect from agent changes'}</Button>
      <Button size="sm" variant="outline" disabled={busy || dirty} onClick={() => void act(() => api.configureSkill(skill.id, { archived: !skill.archived }))}>{skill.archived ? 'Restore from archive' : 'Archive'}</Button>
      <Button size="sm" variant="ghost" onClick={() => void run(() => api.exportSkill(skill.id))}>Export folder</Button>
    </div>
    {!skill.ownerAgentId && <details><summary>Agent availability</summary><p>Shared by default. Disable for individual agents here.</p>{data.agents.map(agent => <label className="skill-check" key={agent.id}><input type="checkbox" checked={!skill.disabledAgentIds.includes(agent.id) && (skill.enabledAgentIds === null || skill.enabledAgentIds.includes(agent.id))} disabled={busy || dirty} onChange={e => void act(() => api.configureSkill(skill.id, { enabledAgentIds: null, disabledAgentIds: data.agents.filter(a => a.id === agent.id ? !e.target.checked : skill.disabledAgentIds.includes(a.id) || (skill.enabledAgentIds !== null && !skill.enabledAgentIds.includes(a.id))).map(a => a.id) }))}/>{agent.name}</label>)}</details>}
    <details><summary>{skill.ownerAgentId ? 'Promote to shared' : 'Customize for an agent'}</summary>
      {skill.ownerAgentId ? <><p>Create a shared copy after checking it contains no agent-specific context.</p><Button size="sm" disabled={dirty || busy} onClick={() => void act(async () => onCopy(await api.copySkill(skill.id, null)))}>Create shared copy</Button></> : <div className="skills-actions"><select aria-label="Customize for agent" value={copyOwner} onChange={e => setCopyOwner(e.target.value)}><option value="">Choose agent…</option>{data.agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select><Button size="sm" disabled={!copyOwner || busy || dirty} onClick={() => void act(async () => onCopy(await api.copySkill(skill.id, copyOwner)))}>Create customization</Button></div>}
    </details>
    <label>Package file<select value={path} onChange={e => setPath(e.target.value)}>{files.map(f => <option key={f.path}>{f.path}</option>)}</select></label>
    {file?.encoding === 'utf8' ? <textarea className="skill-code" aria-label={`Edit ${path}`} rows={16} value={file.content} onChange={e => { setFiles(current => current.map(f => f.path === path ? { ...f, content: e.target.value } : f)); setDirty(true); }}/>
      : <p>Binary asset preserved with this package. Export the folder to use it.</p>}
    <div className="skills-actions"><input aria-label="New reference file path" placeholder="references/example.md" value={newPath} onChange={e => setNewPath(e.target.value)}/><Button size="sm" variant="outline" disabled={!newPath || files.some(f => f.path === newPath)} onClick={() => { setFiles([...files, { path: newPath, content: '', encoding: 'utf8' }]); setPath(newPath); setNewPath(''); setDirty(true); }}>Add file</Button>{path !== 'SKILL.md' && <Button size="sm" variant="ghost" onClick={() => { setFiles(files.filter(f => f.path !== path)); setPath('SKILL.md'); setDirty(true); }}>Remove file</Button>}</div>
    {dirty && <><label>Reason for change<input value={reason} onChange={e => setReason(e.target.value)} placeholder="What improved?"/></label><div className="skills-actions"><Button disabled={busy || !reason.trim()} onClick={() => void act(async () => { const previous = base; await api.updateSkill(skill.id, base, files, reason); setUndoRevision(previous); })}>Save revision</Button><Button variant="ghost" onClick={() => void run(load)}>Discard draft</Button></div></>}
    {undoRevision && !dirty && <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(async () => { await api.restoreSkillRevision(skill.id, base, undoRevision); setUndoRevision(null); })}>Undo last edit</Button>}
    <h3>Proposed changes</h3>
    {detail.proposals.filter(p => p.state === 'pending').map(proposal => <div className="skill-proposal" key={proposal.id}><strong>{proposal.reason}</strong><p>{data.agents.find(a => a.id === proposal.actor)?.name || proposal.actor} · {new Date(proposal.createdAt).toLocaleString()}</p><div className="skills-actions"><Button size="sm" variant="outline" onClick={() => void run(async () => setReview({ proposal, before: await api.skillRevisionFiles(skill.id, proposal.baseRevision) }))}>Review changes</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => api.resolveSkillProposal(proposal.id, false))}>Dismiss</Button></div></div>)}
    {!detail.proposals.some(p => p.state === 'pending') && <p>No proposed changes.</p>}
    {review && <section className="skill-review"><h3>Review: {review.proposal.reason}</h3><PackageDiff before={review.before} after={review.proposal.files}/>{review.proposal.baseRevision !== skill.revision ? <p role="alert">The skill has changed since this proposal. Merge the proposal into the current editor and save a new revision.</p> : <Button disabled={busy || dirty} onClick={() => void act(() => api.resolveSkillProposal(review.proposal.id, true))}>Apply revision</Button>}</section>}
    <details><summary>Revision history ({detail.revisions.length})</summary>{detail.revisions.map(revision => <div className="skill-history" key={revision.id}><span>{revision.reason}<small>{new Date(revision.createdAt).toLocaleString()} · {data.agents.find(a => a.id === revision.actor)?.name || revision.actor}</small></span><Button size="sm" variant="ghost" disabled={busy || dirty || revision.id === base} onClick={() => void act(() => api.restoreSkillRevision(skill.id, base, revision.id))}>Restore</Button></div>)}</details>
    <details><summary>Recent loads</summary>{detail.recentLoads.length ? detail.recentLoads.map((load, i) => <p className="skills-meta" key={i}>{data.agents.find(a => a.id === load.agentId)?.name} · {load.path} · revision {load.revision.slice(0, 8)} · {new Date(load.createdAt).toLocaleString()}</p>) : <p>No loads yet. Loading records access, not whether the workflow succeeded.</p>}</details>
  </div>;
}
