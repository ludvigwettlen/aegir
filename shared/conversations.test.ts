import { expect, it } from 'vitest';
import { conversationThreads } from './conversations.js';
import type { Agent, Group, Thread } from './types.js';

it('flattens channel/main-assistant conversations, retires specialist chats, and preserves task conversations', () => {
  const agents = [{ id: 'a', role: 'Lead' }, { id: 's', role: 'Research' }] as Agent[];
  const groups = [
    { id: 'general', kind: 'group', leadAgentId: 'a' },
    { id: 'project', kind: 'group', leadAgentId: 's' },
    { id: 'main', kind: 'private', leadAgentId: 'a' },
    { id: 'legacy', kind: 'private', leadAgentId: 's' },
  ] as Group[];
  const threads = [
    { id: 'one', groupId: 'general', kind: 'chat' },
    { id: 'two', groupId: 'project', kind: 'chat' },
    { id: 'three', groupId: 'main', kind: 'chat' },
    { id: 'four', groupId: 'legacy', kind: 'chat' },
    { id: 'five', groupId: 'legacy', kind: 'task' },
  ] as Thread[];
  expect(conversationThreads(threads, groups, agents).map(thread => thread.id)).toEqual(['one', 'two', 'three', 'five']);
  expect(threads).toHaveLength(5);
  expect(threads[4].groupId).toBe('legacy');
});
