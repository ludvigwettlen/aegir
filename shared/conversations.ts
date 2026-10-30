import { mainAgent } from './agent-mentions.js';
import type { Agent, Group, Thread } from './types.js';

// Groups remain as storage metadata for existing messages and task attachments.
// Specialist private chats are retired; task conversations remain accessible.
export function isRetiredAgentChat(thread: Thread, groups: Group[], agents: Agent[]): boolean {
  if (thread.kind === 'task') return false;
  const group = groups.find(group => group.id === thread.groupId);
  return group?.kind === 'private' && group.leadAgentId !== mainAgent(agents)?.id;
}

export function conversationThreads<T extends Thread>(threads: T[], groups: Group[], agents: Agent[]): T[] {
  return threads.filter(thread => !isRetiredAgentChat(thread, groups, agents));
}
