import type { SkillProposal } from '../shared/skills.js';
import { describeSchedule } from '../shared/routines.js';
import type { Store } from './db.js';

// Read the full saved history in one operation, independently of UI pagination.
export function chatTranscript(store: Store, threadId: string, proposals: Pick<SkillProposal, 'id' | 'state'>[] = []): string {
  if (typeof threadId !== 'string') throw new Error('Invalid conversation');
  const thread = store.get('threads', threadId);
  if (!thread) throw new Error('This conversation no longer exists');
  const agents = new Map(store.list('agents').map(agent => [agent.id, agent.name]));
  const proposalStates = new Map(proposals.map(proposal => [proposal.id, proposal.state]));
  const messages = store.messagesForThread(threadId);
  const entries = messages.map(message => {
    const speaker = message.role === 'user' ? 'You' : message.role === 'system' ? 'System' : agents.get(message.agentId || '') || 'Agent';
    const date = new Date(message.createdAt).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const parts = [`**${speaker}** · ${date}`, message.content];
    if (message.meta?.type === 'skill-change')
      parts.push(`Skill revision: ${message.meta.skillName} · ${proposalStates.get(message.meta.proposalId) || 'status unavailable'}`);
    if (message.meta?.type === 'routine-change') {
      const { change, state } = message.meta;
      parts.push(`Routine change · ${state}`);
      if (change.name !== undefined) parts.push(`Name: ${change.name}`);
      if (change.schedule) parts.push(`Schedule: ${describeSchedule(change.schedule)}`);
      if (change.agentId) parts.push(`Agent: ${agents.get(change.agentId) || 'Agent'}`);
      if (change.enabled !== undefined) parts.push(`Status: ${change.enabled ? 'On' : 'Paused'}`);
      if (change.instructions !== undefined) parts.push(`Instructions:\n${change.instructions}`);
    }
    if (message.status === 'streaming') parts.push('[Response in progress — copied so far]');
    if (message.status === 'failed') parts.push('[Response failed]');
    return parts.filter(Boolean).join('\n\n');
  });
  return `# ${thread.title}\n\n${entries.length ? entries.join('\n\n---\n\n') : '(No messages yet.)'}\n`;
}
