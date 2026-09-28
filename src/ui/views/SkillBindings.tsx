import type { Routine } from '../../../shared/types';
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
