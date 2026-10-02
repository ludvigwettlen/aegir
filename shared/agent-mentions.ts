import type { Agent, Group } from './types.js';

export function mentionsAgent(text: string, name: string) {
  const literal = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`@${literal}(?![\\p{L}\\p{N}_])`, 'iu').test(text);
}

// Agents mentioned by name (@Mimer), falling back to the group lead.
export function mentionedAgents(text: string, agents: Agent[], group: Group): Agent[] {
  const mentioned = agents.filter(agent => mentionsAgent(text, agent.name));
  if (group.kind === 'private') return agents.filter(agent => agent.id === group.leadAgentId);
  return mentioned.length ? mentioned : agents.filter(agent => agent.id === group.leadAgentId);
}
