import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillRegistry } from './skills.js';
import { parseSkill, readPackage } from './skill-package.js';
import { handleSkillTool } from './skill-tools.js';
import { disabledHostSkills } from './skill-provider.js';
import type { SkillFile } from '../shared/skills.js';
const files = (name = 'example', body = 'Check the evidence.'): SkillFile[] => [{ path: 'SKILL.md', content: `---\nname: ${name}\ndescription: A repeatable procedure\n---\n${body}`, encoding: 'utf8' }, { path: 'references/check.md', content: 'Original reference', encoding: 'utf8' }];
const cleanup: (() => void)[] = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'aegir-skills-')); const db = new Database(join(root, 'skills.sqlite'));
  const registry = new SkillRegistry(db, join(root, 'skills'), id => ['a', 'b'].includes(id), id => id === 'routine' ? 'a' : undefined);
  cleanup.push(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  return { registry, root, db };
}
afterEach(() => cleanup.splice(0).forEach(fn => fn()));
describe('skills', () => {
  it('seeds once and preserves edits, disabled state and archives across restarts', () => {
    const { registry, root, db } = setup(); const research = registry.list().find(s => s.name === 'research')!;
    registry.update(research.id, research.revision, files('research', 'My method'), 'Edited');
    const originalIds = registry.list().map(skill => skill.id).sort();
    registry.configure(research.id, { enabled: false, archived: true });
    const restarted = new SkillRegistry(db, join(root, 'skills'), () => true, () => 'a');
    expect(restarted.list().map(skill => skill.id).sort()).toEqual(originalIds);
    expect(restarted.get(research.id)).toMatchObject({ enabled: false, archived: true });
    restarted.configure(research.id, { archived: false });
    expect(restarted.detail(research.id).files[0].content).toContain('My method');
  });
  it('resolves shared inheritance, agent ownership and explicit customizations', () => {
    const { registry } = setup(); const shared = registry.create({ ownerAgentId: null, files: files() });
    const owned = registry.copy(shared.id, 'a');
    const a = registry.session('a', 'run', 'chat', []).session; const b = registry.session('b', 'run2', 'chat', []).session;
    expect(a.entries.has(owned.id)).toBe(true); expect(a.entries.has(shared.id)).toBe(false);
    expect(b.entries.has(owned.id)).toBe(false); expect(b.entries.has(shared.id)).toBe(true);
    expect(() => registry.read(b, owned.id)).toThrow('not available');
    registry.configure(shared.id, { disabledAgentIds: ['b'] });
    expect(registry.session('b', 'next', 'chat', []).session.entries.has(shared.id)).toBe(false);
    expect(registry.session('a', 'explicit', 'chat', [], `$skill:${shared.id}`).session.loaded.has(`${shared.id}:SKILL.md`)).toBe(true);
  });
  it('freezes all package files for a run and detects stale writes', () => {
    const { registry } = setup(); const skill = registry.create({ ownerAgentId: null, files: files() });
    const session = registry.session('a', 'run', 'task', []).session;
    const changed = files('renamed', 'Changed body'); changed[1].content = 'New reference';
    registry.update(skill.id, skill.revision, changed, 'Updated');
    expect(registry.read(session, skill.id, 'references/check.md').content).toBe('Original reference');
    expect(registry.read(registry.session('a', 'next', 'task', []).session, skill.id).content).toContain('Changed body');
    expect(() => registry.update(skill.id, skill.revision, files(), 'Old edit')).toThrow('changed since');
    const current = registry.get(skill.id); registry.restoreRevision(skill.id, current.revision, skill.revision);
    expect(registry.detail(skill.id).files).toEqual(files());
  });
  it('restricts agent writes and applies proposals with optimistic concurrency', () => {
    const { registry } = setup(); const shared = registry.create({ ownerAgentId: null, files: files() });
    const own = registry.create({ ownerAgentId: 'a', files: files('learned') }, { agentId: 'a', runId: 'r' });
    expect(() => registry.create({ ownerAgentId: 'b', files: files('bad') }, { agentId: 'a' })).toThrow('only create their own');
    expect(() => registry.update(shared.id, shared.revision, files(), 'edit', { agentId: 'a' })).toThrow('Propose');
    registry.update(own.id, own.revision, files('learned', 'Improved'), 'Verified', { agentId: 'a' });
    const proposal = registry.propose(shared.id, shared.revision, files('example', 'Proposed'), 'Better', { agentId: 'a' });
    registry.resolveProposal(proposal.id, true); expect(registry.detail(shared.id).files[0].content).toContain('Proposed');
    expect(registry.proposals()[0].state).toBe('applied');
    expect(() => registry.resolveProposal(proposal.id, true)).toThrow('no longer');
    const current = registry.get(shared.id);
    const stale = registry.propose(shared.id, current.revision, files('example', 'Stale proposal'), 'Old revision', { agentId: 'a' });
    registry.update(shared.id, current.revision, files('example', 'User correction'), 'User edit');
    expect(() => registry.resolveProposal(stale.id, true)).toThrow('changed since');
    expect(registry.detail(shared.id).files[0].content).toContain('User correction');
    expect(registry.proposals().find(item => item.id === stale.id)?.state).toBe('pending');
    registry.configure(own.id, { pinned: true });
    expect(() => registry.propose(own.id, registry.get(own.id).revision, files('learned'), 'oops', { agentId: 'a' })).toThrow('pinned');
  });
  it('keeps routine bindings stable through renames and fails on missing dependencies', () => {
    const { registry } = setup(); const skill = registry.create({ ownerAgentId: null, files: files() });
    registry.bindRoutine('routine', [skill.id]); registry.update(skill.id, skill.revision, files('renamed'), 'Rename');
    expect(registry.session('a', 'r', 'routine', [], '', 'routine').session.loaded.has(`${skill.id}:SKILL.md`)).toBe(true);
    expect(() => registry.configure(skill.id, { archived: true })).toThrow('routines');
    registry.configure(skill.id, { enabled: false });
    expect(() => registry.session('a', 'r', 'routine', [], '', 'routine')).toThrow('missing or disabled');
    registry.bindRoutine('routine', []); registry.configure(skill.id, { archived: true });
  });
  it('does not let skills broaden available tools or run types', () => {
    const { registry } = setup(); const pkg = files(); pkg[0].content = pkg[0].content.replace('description:', 'metadata:\n  aegir:\n    requiresTools: [slack__post]\n    runKinds: [chat]\ndescription:');
    const skill = registry.create({ ownerAgentId: null, files: pkg });
    expect(() => registry.session('a', 'r', 'task', ['slack__search'], `$skill:${skill.id}`)).toThrow('Missing tools');
    expect(() => registry.session('a', 'r', 'task', ['slack__post'], `$skill:${skill.id}`)).toThrow('Not available in task runs');
    expect(registry.session('a', 'r', 'chat', ['slack__post'], `$skill:${skill.id}`).session.loaded.size).toBe(1);
  });
  it('records disk edits and exposes broken packages for repair', () => {
    const { registry, root } = setup(); const skill = registry.create({ ownerAgentId: null, files: files() });
    const path = join(root, 'skills', 'shared', skill.id, 'SKILL.md'); writeFileSync(path, files('example', 'Disk edit')[0].content);
    registry.reconcile(); expect(registry.get(skill.id).revision).not.toBe(skill.revision);
    writeFileSync(path, 'broken'); registry.reconcile(); expect(registry.get(skill.id).error).toContain('frontmatter');
    expect(() => registry.read(registry.session('a', 'r', 'chat', []).session, skill.id)).toThrow('frontmatter');
    registry.restoreRevision(skill.id, registry.get(skill.id).revision, skill.revision); expect(registry.get(skill.id).error).toBeNull();
    const dir = join(root, 'skills', 'shared', 'new-folder'); mkdirSync(dir); writeFileSync(join(dir, 'SKILL.md'), 'broken');
    registry.reconcile(); expect(registry.list().find(s => s.directory === 'new-folder')?.error).toContain('frontmatter');
  });
  it('preserves binary resources and unknown metadata through copies and updates', () => {
    const { registry } = setup(); const pkg = files(); pkg[0].content = pkg[0].content.replace('description:', 'metadata:\n  other:\n    custom: keep-me\ndescription:'); pkg.push({ path: 'assets/image.bin', encoding: 'base64', content: 'AP8=' });
    const skill = registry.create({ ownerAgentId: null, files: pkg }); const own = registry.copy(skill.id, 'a');
    expect(registry.detail(own.id).files).toEqual(expect.arrayContaining(pkg));
    const session = registry.session('a', 'r', 'chat', []).session;
    handleSkillTool(registry, session, 'propose_change', { id: own.id, expectedRevision: own.revision, files: pkg.filter(f => f.encoding === 'utf8'), reason: 'Update text' });
    expect(registry.proposals()[0].files).toEqual(expect.arrayContaining(pkg));
  });
  it('rejects paths, oversized packages, duplicate files, YAML aliases and symlinks', () => {
    const { root } = setup();
    for (const path of ['../outside', '/tmp/outside', 'a/../../outside', 'a\\bad']) expect(() => parseSkill([...files(), { path, encoding: 'utf8', content: '' }])).toThrow();
    expect(() => parseSkill([...files(), files()[0]])).toThrow('Duplicate');
    expect(() => parseSkill([...files(), { path: 'references', encoding: 'utf8', content: 'collision' }])).toThrow('both a file and a directory');
    expect(() => parseSkill(files('example', 'x'.repeat(1024 * 1024)))).toThrow('large');
    expect(() => parseSkill([{ path: 'SKILL.md', encoding: 'utf8', content: '---\nname: &a example\ndescription: *a\n---\n' }])).toThrow('aliases');
    const dir = join(root, 'linked'); mkdirSync(dir); symlinkSync('/tmp', join(dir, 'escape')); expect(() => readPackage(dir)).toThrow('symlinks');
  });
  it('recovers an interrupted package publication from its journal', () => {
    const { registry, db, root } = setup(); const skill = registry.create({ ownerAgentId: null, files: files() });
    const revision = { id: 'recovered', skillId: skill.id, hash: '', parent: skill.revision, actor: 'user', sourceRun: null, reason: 'Recovery', createdAt: new Date().toISOString() };
    const next = { ...skill, revision: revision.id };
    db.prepare('INSERT INTO skill_journal VALUES (?,?)').run(skill.id, JSON.stringify({ skill: next, revision, files: files('example', 'Recovered content') }));
    rmSync(join(root, 'skills', 'shared', skill.id), { recursive: true });
    new SkillRegistry(db, join(root, 'skills'), () => true, () => 'a');
    expect(readFileSync(join(root, 'skills', 'shared', skill.id, 'SKILL.md'), 'utf8')).toContain('Recovered content');
    expect(db.prepare('SELECT * FROM skill_journal').all()).toHaveLength(0);
  });
  it('normalizes host skill paths and fails closed on discovery errors', () => {
    expect(disabledHostSkills({ data: [{ skills: [{ path: '/tmp/one/SKILL.md' }, { path: '/tmp/two' }], errors: [] }] })).toEqual([{ path: '/tmp/one', enabled: false }, { path: '/tmp/two', enabled: false }]);
    expect(() => disabledHostSkills({})).toThrow('catalog');
    expect(() => disabledHostSkills({ data: [{ skills: [], errors: ['failed'] }] })).toThrow('discovery failed');
  });
});
