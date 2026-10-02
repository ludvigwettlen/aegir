import type { Skill } from './skills.js';

// The runtime validates tool requirements and visibility again when starting a run.
export function commandSkills(skills: Skill[], agentIds: string[], kind: 'chat' | 'task', query = '') {
  const q = query.toLowerCase();
  return skills.filter(skill => skill.enabled && !skill.archived && !skill.error && agentIds.length > 0
    && agentIds.every(id => (!skill.ownerAgentId || skill.ownerAgentId === id)
      && (skill.enabledAgentIds === null || skill.enabledAgentIds.includes(id))
      && !skill.disabledAgentIds.includes(id))
    && (!skill.requirements?.runKinds.length || skill.requirements.runKinds.includes(kind))
    && (!skill.requirements?.platforms.length || skill.requirements.platforms.includes('macos'))
    && `${skill.name} ${skill.description}`.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function withSkillCommands(text: string, skills: Pick<Skill, 'id' | 'name'>[]) {
  return [...skills.map(skill => `Use skill ${skill.name} ($skill:${skill.id}).`), text.trim()].filter(Boolean).join('\n\n');
}
