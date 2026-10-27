import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Release assets and SHA-256 digests from the publishers' GitHub release APIs.
// Keep versions fixed: a new Aegir release deliberately updates these together.
export const setupReleases = {
  uv: { version: '0.13.1', arm64: 'cfe454573412ff7380d15fc7dae5997ab53ffce72fce0a78e91ddbc84001acd2', x64: 'bb7b805bdcf3d0bc8c74ceb94569e6b3e8aa35bd492acdbb9d46bf46d9d4ff6b' },
  codex: { version: '0.162.1', arm64: 'b293a0fcdd871900a44c0a4f40a1aa401b31e02854f790ebdb8bd5d1177fd1fe', x64: 'd68e39d8f62639f33f7d00656554cb9c3ef7809e664a3827e62ab3ace3c21b21' },
  memory: '3.15.1',
};

type CommandOptions = { signal?: AbortSignal; env?: NodeJS.ProcessEnv; timeout?: number; cwd?: string };
export function setupCommand(binary: string, args: string[], options: CommandOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new Error('Setup cancelled. You can try again.')); return; }
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], env: options.env || process.env, cwd: options.cwd, detached: process.platform !== 'win32' });
    let output = ''; let errors = ''; let failure: Error | undefined;
    const stop = () => {
      try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* Already exited. */ }
    };
    const abort = () => { failure = new Error('Setup cancelled. You can try again.'); stop(); };
    const timer = setTimeout(() => { failure = new Error('Setup took too long. Check your connection and try again.'); stop(); }, options.timeout || 30_000);
    const clean = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); };
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(-64_000); });
    child.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-4000); });
    child.on('error', error => { clean(); reject(error); });
    child.on('close', code => { clean(); failure ? reject(failure) : code === 0 ? resolve(output) : reject(new Error(errors.trim() || `${binary} could not finish (exit ${code}).`)); });
  });
}

export async function downloadVerified(url: string, destination: string, expected: string, signal: AbortSignal) {
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(5 * 60_000)]) });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}). Check your internet connection and try again.`);
  const hash = createHash('sha256'); let size = 0;
  const meter = new Transform({ transform(chunk, _encoding, callback) {
    size += chunk.length;
    if (size > 250 * 1024 * 1024) { callback(new Error('Download was larger than expected.')); return; }
    hash.update(chunk); callback(null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(destination, { flags: 'wx', mode: 0o600 }), { signal });
  if (hash.digest('hex') !== expected) throw new Error('Download verification failed. Nothing has been installed. Please try again.');
}

export type InstallOptions = { root: string; signal: AbortSignal; progress: (message: string) => void };
export async function installDependency(kind: 'codex' | 'memory', options: InstallOptions): Promise<string> {
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) throw new Error('Automatic setup currently supports Apple Silicon and Intel Macs.');
  const { root, signal, progress } = options;
  const arch = process.arch as 'arm64' | 'x64';
  const target = `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`;
  const stage = await mkdtemp(join(tmpdir(), 'aegir-setup-'));
  // Never move a Python venv: its scripts contain absolute interpreter paths.
  const destination = join(root, kind, randomUUID());
  await mkdir(destination, { recursive: true });
  const command = (binary: string, args: string[], env?: NodeJS.ProcessEnv) => setupCommand(binary, args, { signal, env, timeout: 15 * 60_000 });
  try {
    const tool = kind === 'codex' ? 'codex' : 'uv';
    const release = setupReleases[tool];
    const archive = join(stage, 'download.tar.gz');
    const url = tool === 'codex'
      ? `https://github.com/openai/codex/releases/download/rust-v${release.version}/codex-${target}.tar.gz`
      : `https://github.com/astral-sh/uv/releases/download/${release.version}/uv-${target}.tar.gz`;
    progress(kind === 'codex' ? 'Downloading Codex from OpenAI…' : 'Downloading the memory installer…');
    await downloadVerified(url, archive, release[arch], signal);
    progress('Download verified. Preparing installation…');
    if (kind === 'codex') {
      const name = `codex-${target}`;
      await command('/usr/bin/tar', ['-xzf', archive, '-C', destination, name]);
      const binary = join(destination, name);
      await chmod(binary, 0o755);
      await command(binary, ['--version']);
      return binary;
    }
    await command('/usr/bin/tar', ['-xzf', archive, '-C', stage, `uv-${target}/uv`]);
    const uv = join(stage, `uv-${target}`, 'uv');
    const env = { ...process.env, UV_PYTHON_INSTALL_DIR: join(root, 'python'), UV_CACHE_DIR: join(root, 'cache'), UV_NO_CONFIG: '1', UV_PYTHON_DOWNLOADS: 'automatic' };
    progress('Preparing Python for memory. No system changes are needed…');
    await command(uv, ['venv', '--python', '3.12', '--managed-python', destination], env);
    const python = join(destination, 'bin', 'python');
    progress('Installing Mnemosyne and local search. This can take a few minutes…');
    await command(uv, ['pip', 'install', '--python', python, '--only-binary', ':all:', '--index-url', 'https://pypi.org/simple', `mnemosyne-memory[embeddings]==${setupReleases.memory}`], env);
    const binary = join(destination, 'bin', 'mnemosyne');
    progress('Testing memory. The first search may download its local language model…');
    await verifyMemory(binary, signal, command);
    return binary;
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  } finally { await rm(stage, { recursive: true, force: true }); }
}

// Exercise the same CLI contract as MemoryService in a disposable data directory.
// No test memory is ever written to the user's banks.
export async function verifyMemory(binary: string, signal: AbortSignal, command = (bin: string, args: string[], env?: NodeJS.ProcessEnv) => setupCommand(bin, args, { signal, env, timeout: 10 * 60_000 })) {
  const data = await mkdtemp(join(tmpdir(), 'aegir-memory-check-'));
  const env = { ...process.env, MNEMOSYNE_DATA_DIR: data, MNEMOSYNE_BANK: 'default', MNEMOSYNE_DEFAULT_SCOPE: 'global' };
  try {
    const content = 'Aegir setup verification memory';
    const saved = await command(binary, ['store', content, 'aegir-setup'], env);
    const id = saved.match(/^Stored:\s*([0-9a-f-]{8,80})\s*$/im)?.[1];
    if (!id) throw new Error('Memory did not confirm it could save. Please retry setup.');
    const result = JSON.parse(await command(binary, ['recall', content, '5', '--json'], env));
    if (!Array.isArray(result.results) || !result.results.some((row: { id: string }) => row.id === id)) throw new Error('Memory saved a test but could not find it again. Please retry setup.');
    await command(binary, ['delete', id], env);
  } finally { await rm(data, { recursive: true, force: true }); }
}
