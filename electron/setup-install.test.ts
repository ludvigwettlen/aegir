import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { downloadVerified, verifyMemory, setupCommand } from './setup-install.js';

afterEach(() => { vi.unstubAllGlobals(); });
it('rejects changed downloads before they can be extracted or executed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aegir-download-test-'));
  const body = Buffer.from('trusted release bytes');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
  try {
    await downloadVerified('https://github.com/example', join(root, 'ok'), createHash('sha256').update(body).digest('hex'), new AbortController().signal);
    expect(await readFile(join(root, 'ok'), 'utf8')).toBe(body.toString());
    await expect(downloadVerified('https://github.com/example', join(root, 'bad'), '0'.repeat(64), new AbortController().signal)).rejects.toThrow('verification failed');
  } finally { await rm(root, { recursive: true, force: true }); }
});
it('verifies saving, finding, and deleting a memory in disposable storage', async () => {
  const environments: NodeJS.ProcessEnv[] = [];
  const calls: string[][] = [];
  const command = async (_binary: string, args: string[], env?: NodeJS.ProcessEnv) => {
    environments.push(env!); calls.push(args);
    if (args[0] === 'store') return 'Stored: abcdef12-1234';
    if (args[0] === 'recall') return '{"results":[{"id":"abcdef12-1234"}]}';
    return '';
  };
  await verifyMemory('/memory', new AbortController().signal, command);
  expect(calls.map(args => args[0])).toEqual(['store', 'recall', 'delete']);
  expect(environments.every(env => env.MNEMOSYNE_BANK === 'default')).toBe(true);
  expect(new Set(environments.map(env => env.MNEMOSYNE_DATA_DIR)).size).toBe(1);
  expect(environments[0].MNEMOSYNE_DATA_DIR).toContain('aegir-memory-check-');
  await expect(readFile(environments[0].MNEMOSYNE_DATA_DIR!)).rejects.toThrow();
});
it('rejects an installation that saves but cannot retrieve a memory', async () => {
  await expect(verifyMemory('/memory', new AbortController().signal, async (_bin, args) => args[0] === 'store' ? 'Stored: abcdef12' : '{"results":[]}')).rejects.toThrow('could not find');
});
it('does not launch a command after cancellation', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(setupCommand('/missing/program', [], { signal: controller.signal })).rejects.toThrow('cancelled');
});
