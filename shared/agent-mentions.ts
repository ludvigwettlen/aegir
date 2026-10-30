import type { Agent, Group } from './types.js';

export function mentionsAgent(text: string, name: string) {
  const literal = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`@${literal}(?![\\p{L}\\p{N}_])`, 'iu').test(text);
}

// Legacy identities remain readable, but all new work uses one main assistant.
export function mainAgent(agents: Agent[]): Agent | undefined {
  return agents.find(agent => agent.role === 'Lead') || agents[0];
}

export function mentionedAgents(_text: string, agents: Agent[], _group: Group): Agent[] {
  const agent = mainAgent(agents);
  return agent ? [agent] : [];
}
