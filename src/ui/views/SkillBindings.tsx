import type { Routine, Snapshot } from '../../../shared/types';
import { useSkillLibrary } from '../hooks/useSkillLibrary';
import { api, type Run } from './common';
export function RoutineSkillBindings({ routine, run }: { routine: Routine; run: Run }) {
  const { library, error, reload } = useSkillLibrary();
  const ids = library?.routineBindings[routine.id] || [];
  const skills = library?.skills.filter(skill => ids.includes(skill.id) || (!skill.archived && skill.enabled && (!skill.ownerAgentId || skill.ownerAgentId === routine.agentId) && !skill.disabledAgentIds.includes(routine.agentId) && (skill.enabledAgentIds === null || skill.enabledAgentIds.includes(routine.agentId)))) || [];
  return <details className="ws-instructions skill-bindings"><summary>Skills · {ids.length} required</summary><p>Selected skills load on every run. A missing or disabled skill stops the run.</p>{error && <p role="alert">{error}</p>}{!library && !error && <p>Loading…</p>}{skills.map(skill => <label className="skill-check" key={skill.id}><input type="checkbox" checked={ids.includes(skill.id)} onChange={e => void run(async () => { await api.bindRoutineSkills(routine.id, e.target.checked ? [...ids, skill.id] : ids.filter(id => id !== skill.id)); await reload(); })}/>{skill.name}{skill.error ? ' · Invalid' : !skill.enabled ? ' · Disabled' : ''}</label>)}</details>;
}
export function AgentSkillsSummary({ agentId, onOpen }: { agentId: string; onOpen: (id: string) => void }) {
  const { library } = useSkillLibrary();
  const owned = library?.skills.filter(s => !s.archived && s.ownerAgentId === agentId).length || 0;
  const shared = library?.skills.filter(s => !s.archived && !s.ownerAgentId && s.enabled && !s.disabledAgentIds.includes(agentId) && (s.enabledAgentIds === null || s.enabledAgentIds.includes(agentId))).length || 0;
  return <button className="ws-btn" onClick={() => onOpen(agentId)}>Skills · {shared} shared · {owned} owned</button>;
}
export function ComposerSkills({ data, agentIds, value, onSelect }: { data: Snapshot; agentIds: string[]; value: string; onSelect: (reference: string) => void }) {
  const { library, error } = useSkillLibrary();
  const eligible = library?.skills.filter(s => !s.archived && s.enabled && !s.error && agentIds.every(id => (!s.ownerAgentId || s.ownerAgentId === id) && !s.disabledAgentIds.includes(id) && (s.enabledAgentIds === null || s.enabledAgentIds.includes(id)))) || [];
  return <select className="skill-composer-select" aria-label="Add skill to message" value="" disabled={!!error} title={error || 'Load a skill explicitly for this message'} onChange={e => { if (e.target.value) onSelect(`$skill:${e.target.value} `); }}><option value="">+ Skill</option>{eligible.map(s => <option key={s.id} value={s.id} disabled={value.includes(`$skill:${s.id}`)}>{s.name} · {s.ownerAgentId ? data.agents.find(a => a.id === s.ownerAgentId)?.name : 'Shared'}</option>)}</select>;
}
