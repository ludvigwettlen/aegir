import { updateFs } from './update-files.js';
const { rm } = updateFs.promises;
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants, existsSync, readFileSync, realpathSync } from 'node:fs';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { UpdateManifest } from './update-manifest.js';
import { setupCommand } from './setup-install.js';

export type Installation = { target: string; source: string; parentPID: number; token: string; root: string; userData: string; version: string };
export async function prepareInstallation(options: { executable: string; helper: string; userData: string; candidate: string; manifest: UpdateManifest }) {
  const target = realpathSync(resolve(dirname(options.executable), '../..'));
  if (!target.endsWith('.app') || (target.startsWith('/Volumes/') || target.includes('/AppTranslocation/'))) throw new Error('Move Aegir into Applications before updating.');
  await access(dirname(target), constants.W_OK | constants.X_OK);
  if (existsSync(target + '.aegir-update-old') || existsSync(target + '.aegir-update-new')) throw new Error('An earlier update needs recovery. Keep its backup and follow the recovery instructions.');
  const source = realpathSync(options.candidate);
  const plist = join(source, 'Contents/Info.plist');
  const value = (key: string) => setupCommand('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist]);
  if ((await value('CFBundleIdentifier')).trim() !== 'dev.personal.aegir' || (await value('CFBundleShortVersionString')).trim() !== options.manifest.version) throw new Error('The downloaded app identity or version does not match its signed release.');
  const arches = await setupCommand('/usr/bin/lipo', ['-archs', join(source, 'Contents/MacOS/Aegir')]);
  if (!arches.split(/\s+/).includes(options.manifest.architecture === 'x64' ? 'x86_64' : options.manifest.architecture)) throw new Error('The downloaded app does not support this Mac.');
  const userData = realpathSync(options.userData);
  const updates = join(userData, 'updates'); await mkdir(updates, { recursive: true, mode: 0o700 });
  const root = realpathSync(await mkdtemp(join(updates, 'transaction-')));
  const request: Installation = { target, source, parentPID: process.pid, token: randomUUID(), root, userData, version: options.manifest.version };
  const helper = join(root, 'aegir-updater'); await copyFile(options.helper, helper); await chmod(helper, 0o700);
  const requestPath = join(root, 'request.json'); await writeFile(requestPath, JSON.stringify(request), { mode: 0o600, flag: 'wx' });
  await writeFile(join(updates, 'pending.json'), JSON.stringify({ root, token: request.token }), { mode: 0o600 });
  let child: ReturnType<typeof spawn> | undefined;
  const cancel = async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = new Promise<void>(ok => child!.once('close', () => ok()));
      child.kill('SIGTERM'); await closed;
    }
    // Cleanup acquires the same native lock; it never removes another installer's staging.
    await setupCommand(helper, [requestPath, '--discard']).catch(() => {});
  };
  return { request, cancel, start: async () => {
    const log = await import('node:fs').then(fs => fs.openSync(join(root, 'helper.log'), 'a', 0o600));
    try { child = spawn(helper, [requestPath], { detached: true, stdio: ['ignore', log, log] }); }
    finally { (await import('node:fs')).closeSync(log); }
    let failure: Error | undefined;
    child.once('error', error => { failure = error; });
    child.once('exit', code => { if (code !== 0) failure = new Error('The update helper could not prepare the app. Your installed app is unchanged.'); });
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      if (existsSync(join(root, 'ready')) && (await readFile(join(root, 'ready'), 'utf8')) === request.token) { child.unref(); return; }
      await new Promise(ok => setTimeout(ok, 100));
    }
    child.kill('SIGTERM'); throw new Error('Preparing the update took too long. Your installed app is unchanged.');
  } };
}
export function pendingInstallation(userData: string): { request: Installation; phase: string; result?: { status: string; message: string }; healthy: boolean } | undefined {
  if (!existsSync(join(userData, 'updates/pending.json'))) return undefined;
  const updates = realpathSync(join(userData, 'updates'));
  const pending = JSON.parse(readFileSync(join(updates, 'pending.json'), 'utf8'));
  if (typeof pending.token !== 'string' || typeof pending.root !== 'string' || !pending.root.startsWith(updates + '/transaction-') || realpathSync(pending.root) !== pending.root) throw new Error('Invalid update receipt.');
  const request: Installation = JSON.parse(readFileSync(join(pending.root, 'request.json'), 'utf8'));
  if (request.token !== pending.token || request.root !== pending.root || request.userData !== realpathSync(userData)) throw new Error('Invalid update startup request.');
  const phase = existsSync(join(request.root, 'phase')) ? readFileSync(join(request.root, 'phase'), 'utf8') : '';
  const result = existsSync(join(request.root, 'result.json')) ? JSON.parse(readFileSync(join(request.root, 'result.json'), 'utf8')) : undefined;
  const healthy = existsSync(join(request.root, 'healthy')) && readFileSync(join(request.root, 'healthy'), 'utf8') === request.token;
  return { request, phase, result, healthy };
}
export function startupTransaction(userData: string, token: string | undefined): Installation | undefined {
  if (!token) return undefined;
  const pending = pendingInstallation(userData);
  if (!pending || pending.request.token !== token) throw new Error('Invalid update startup token.');
  return pending.request;
}
export async function launchRecovery(request: Installation) {
  const log = (await import('node:fs')).openSync(join(request.root, 'recovery.log'), 'a', 0o600);
  const helper = spawn(join(request.root, 'aegir-updater'), [join(request.root, 'request.json'), '--recover', String(process.pid)], { detached: true, stdio: ['ignore', log, log] });
  (await import('node:fs')).closeSync(log);
  let error: Error | undefined;
  helper.once('error', e => { error = e; });
  helper.once('exit', code => { if (code !== 0) error = new Error('The installer is still running, or recovery could not start. Wait and try again.'); });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (error) throw error;
    if (existsSync(join(request.root, 'recovery-ready')) && readFileSync(join(request.root, 'recovery-ready'), 'utf8') === request.token) { helper.unref(); return; }
    await new Promise(ok => setTimeout(ok, 100));
  }
  helper.kill('SIGTERM'); throw new Error('Recovery could not prepare. Backups were retained.');
}
export async function confirmStartup(request: Installation) {
  await writeFile(join(request.root, 'healthy'), request.token, { mode: 0o600 });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const result = JSON.parse(await readFile(join(request.root, 'result.json'), 'utf8'));
      if (result.token !== request.token || result.status !== 'updated') throw new Error('The update was not confirmed.');
      const downloadRoot = dirname(dirname(request.source));
      if (downloadRoot.startsWith(join(request.userData, 'updates', 'download-'))) await rm(downloadRoot, { recursive: true, force: true }).catch(() => {});
      return;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await new Promise(ok => setTimeout(ok, 100));
  }
  throw new Error('The update helper did not confirm installation. Restart Aegir before continuing.');
}
