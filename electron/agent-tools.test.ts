import { describe, expect, it } from 'vitest';
import { cleanRoutineChange, connectorToolsFor, mentionedAgents, mentionedRoutines, taskSourceKey } from './agent-tools.js';
import type { Agent, Group, Routine } from '../shared/types.js';

const agent = (id: string, name: string): Agent => ({ id, name, role: '', color: '', instructions: '', createdAt: '' });
const agents = [agent('a', 'Aegir'), agent('s', 'Mimer'), agent('q', 'Saga')];
const group: Group = { id: 'g', title: 'General', kind: 'group', agentIds: ['a', 's', 'q'], leadAgentId: 'a', instructions: '', createdAt: '' };

describe('tool policy', () => {
  const tools = [{ name: 'slack__search', description: '', inputSchema: {}, readOnly: true }, { name: 'slack__post', description: '', inputSchema: {}, readOnly: false }];
  it('gives chat every connector tool but tasks and routines only read-only ones', () => {
    expect(connectorToolsFor('chat', tools)).toHaveLength(2);
    expect(connectorToolsFor('task', tools).map(tool => tool.name)).toEqual(['slack__search']);
    expect(connectorToolsFor('routine', tools).map(tool => tool.name)).toEqual(['slack__search']);
  });
});

describe('mentions', () => {
  it('keeps legacy and custom mentions on the main assistant', () => {
    const custom = [agent('a', 'Aegir'), agent('b', 'Research [EU]'), agent('c', 'René')];
    expect(mentionedAgents('@Research [EU] review', custom, group).map(agent => agent.id)).toEqual(['a']);
    expect(mentionedAgents('@René review', custom, group).map(agent => agent.id)).toEqual(['a']);
    expect(mentionedAgents('@Renée review', custom, group).map(agent => agent.id)).toEqual(['a']);
  });
  it('uses one assistant even for multiple mentions and legacy private groups', () => {
    expect(mentionedAgents('@Mimer @Saga please help', agents, group).map(x => x.name)).toEqual(['Aegir']);
    expect(mentionedAgents('@mimer can you look?', agents, group).map(x => x.name)).toEqual(['Aegir']);
    expect(mentionedAgents('@aegir please help', agents, group).map(x => x.name)).toEqual(['Aegir']);
    expect(mentionedAgents('hello', agents, group).map(x => x.name)).toEqual(['Aegir']);
    expect(mentionedAgents('@Saga hi', agents, { ...group, kind: 'private', agentIds: ['s'], leadAgentId: 's' }).map(x => x.name)).toEqual(['Aegir']);
  });
  it('finds tagged routines by full name', () => {
    const routine = (name: string) => ({ id: name, name } as Routine);
    expect(mentionedRoutines('Can @hourly discovery skip weekends?', [routine('Hourly discovery'), routine('Morning brief')]).map(x => x.name)).toEqual(['Hourly discovery']);
  });
});

describe('routine changes from agents', () => {
  it('keeps valid fields and rejects bad schedules', () => {
    expect(cleanRoutineChange({ schedule: { every: 'hour', weekdaysOnly: true }, bogus: 1 }, agents, false)).toEqual({ schedule: { every: 'hour', weekdaysOnly: true } });
    expect(() => cleanRoutineChange({ schedule: { every: 'minute' } }, agents, false)).toThrow('Invalid schedule');
    expect(() => cleanRoutineChange({ agentId: 'nobody' }, agents, false)).toThrow('empty');
  });
  it('requires name, instructions and schedule for a new routine', () => {
    expect(() => cleanRoutineChange({ name: 'Brief' }, agents, true)).toThrow('needs a name');
    expect(cleanRoutineChange({ name: 'Brief', instructions: 'Summarise', schedule: { every: 'day', at: '08:00' } }, agents, true).name).toBe('Brief');
  });
});

describe('suggested task keys', () => {
  it('deduplicates the same source and title despite whitespace and case', () => {
    expect(taskSourceKey('routine', 'https://slack.test/1', 'Send  proposal')).toBe(taskSourceKey('routine', 'https://slack.test/1', 'send proposal'));
    expect(taskSourceKey('routine', 'https://slack.test/1', 'Send proposal')).not.toBe(taskSourceKey('routine', 'https://slack.test/2', 'Send proposal'));
  });
});
