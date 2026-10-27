import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { GbrainMemoryService } from './gbrain-memory.js';
import { providerSetup } from '../shared/provider-setup.js';
const folders: string[] = [];
afterEach(() => { for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aegir-brain-')); folders.push(root);
  const brain = join(root, 'notes'); mkdirSync(brain);
  const source = { id: 'notes', local_path: brain };
  const command = vi.fn(async (_binary: string, args: string[], _options?: { cwd?: string }) => args[0] === 'sources'
    ? JSON.stringify({ sources: [source] }) : '[0.9] people/test -- A useful remembered fact.');
  const service = new GbrainMemoryService('/configured/gbrain', providerSetup({ preset: 'legolas', brainDir: brain, brainId: 'personal', sourceId: 'notes' }), command);
  return { service, command, root, brain, source };
}
it('validates the registered folder and explicitly scopes every search to its brain and source', async () => {
  const { service, command, brain } = fixture();
  await service.check();
  const rows = await service.search('project context');
  expect(rows[0]).toMatchObject({ id: 'people/test', scope: 'brain' });
  expect(command.mock.calls.at(-1)?.slice(0, 2)).toEqual(['/configured/gbrain',
    ['search', 'project context', '--limit', '20', '--source', 'notes', '--brain', 'personal']]);
  expect(command.mock.calls.at(-1)?.[2]?.cwd).toBe(realpathSync(brain));
});
it('fails closed when gbrain points to a different folder, without writing there or silently returning no memories', async () => {
  const { service, source, root, command } = fixture();
  source.local_path = root;
  await expect(service.check()).rejects.toThrow('not registered');
  await expect(service.remember('shared', 'Remember this', null)).rejects.toThrow('not registered');
  expect(command.mock.calls.every(([, args]) => args[0] === 'sources')).toBe(true);
});
it('appends memories to the chosen brain without migration and refuses symlink escapes', async () => {
  const { service, brain, root } = fixture();
  await service.migrateLegacy();
  await service.remember('shared', 'Keep this fact', 'https://example.com/source');
  const file = join(brain, 'inbox/aegir-memories.md');
  expect(readFileSync(file, 'utf8')).toContain('Keep this fact Source: https://example.com/source');
  await expect(service.correct()).rejects.toThrow('Obsidian');
  await expect(service.forget()).rejects.toThrow('Obsidian');
  rmSync(file); symlinkSync(join(root, 'elsewhere.md'), file);
  await expect(service.remember('shared', 'Escape', null)).rejects.toThrow();
});
