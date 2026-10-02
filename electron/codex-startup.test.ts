import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexProvider } from './codex.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: vi.fn() }));

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

function server() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
  });
  child.stdin.on('data', chunk => {
    const message = JSON.parse(chunk.toString());
    if (message.method === 'initialize') {
      queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`));
    }
  });
  return child;
}

describe('Codex startup', () => {
  it.each([
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex',
  ])('launches the installed bundle at %s without relying on PATH', async path => {
    vi.stubEnv('CODEX_BINARY', '');
    vi.mocked(existsSync).mockImplementation(candidate => candidate === path);
    vi.mocked(spawn).mockReturnValue(server() as unknown as ReturnType<typeof spawn>);
    const provider = new CodexProvider();
    await provider.start();
    expect(spawn).toHaveBeenCalledWith(path, ['app-server', '--stdio'], expect.any(Object));
    expect(provider.status).toBe('Connected');
    provider.close();
  });

  it('reports synchronous ENOTDIR failures and allows retry', async () => {
    vi.stubEnv('CODEX_BINARY', '/configured/codex');
    vi.mocked(spawn).mockImplementationOnce(() => { throw new Error('spawn ENOTDIR'); });
    const provider = new CodexProvider();
    await expect(provider.start()).rejects.toThrow('Could not start Codex (/configured/codex): spawn ENOTDIR');
    expect(provider.status).toBe('Failed to start');
    vi.mocked(spawn).mockReturnValue(server() as unknown as ReturnType<typeof spawn>);
    await provider.start();
    expect(provider.status).toBe('Connected');
    provider.close();
  });

  it('rejects initialization on asynchronous spawn failure and allows retry', async () => {
    vi.stubEnv('CODEX_BINARY', '/missing/codex');
    const child = server();
    child.stdin.removeAllListeners('data');
    vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
    const provider = new CodexProvider();
    const starting = provider.start();
    const assertion = expect(starting).rejects.toThrow('Could not start Codex (/missing/codex): spawn ENOENT');
    child.emit('error', new Error('spawn ENOENT'));
    await assertion;
    vi.mocked(spawn).mockReturnValue(server() as unknown as ReturnType<typeof spawn>);
    await provider.start();
    child.emit('exit', -1);
    expect(provider.status).toBe('Connected');
    provider.close();
  });
});
