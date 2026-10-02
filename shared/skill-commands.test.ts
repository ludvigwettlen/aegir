import { expect, it } from 'vitest';
import { commandSkills, withSkillCommands } from './skill-commands';
import type { Skill } from './skills';

const base = { id: 'shared', name: 'research', description: 'Compare evidence', enabled: true, archived: false, error: null, ownerAgentId: null, enabledAgentIds: null, disabledAgentIds: [] } as unknown as Skill;
it('offers only skills usable by all recipients and the current run kind', () => {
  const skills = [base, { ...base, id: 'own', ownerAgentId: 'a' }, { ...base, id: 'disabled', disabledAgentIds: ['a'] },
    { ...base, id: 'off', enabled: false }, { ...base, id: 'archived', archived: true }, { ...base, id: 'broken', error: 'Invalid' },
    { ...base, id: 'chat-only', requirements: { runKinds: ['chat'], platforms: [], tools: [] } }];
  expect(commandSkills(skills, ['a'], 'task').map(skill => skill.id)).toEqual(['shared', 'own']);
  expect(commandSkills(skills, ['a', 'b'], 'task').map(skill => skill.id)).toEqual(['shared']);
  expect(commandSkills(skills, [], 'chat')).toEqual([]);
  expect(commandSkills([base], ['a'], 'chat', 'evidence')).toEqual([base]);
  expect(commandSkills([base], ['a'], 'chat', 'missing')).toEqual([]);
});
it('invokes exact skill IDs even when names collide', () => {
  expect(withSkillCommands('Do the work', [base, { ...base, id: 'own' }])).toBe('Use skill research ($skill:shared).\n\nUse skill research ($skill:own).\n\nDo the work');
  expect(withSkillCommands('  Hello  ', [])).toBe('Hello');
});
