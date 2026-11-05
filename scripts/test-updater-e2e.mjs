#!/usr/bin/env node
// Opt-in macOS packaged-app test. All app data and installation files are disposable.
import { _electron } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, sign } from 'node:crypto';
import assert from 'node:assert/strict';

const root = await mkdtemp(join(tmpdir(), 'aegir-full-update-'));
const canonicalRoot = execFileSync('/bin/pwd', ['-P'], { cwd: root, encoding: 'utf8' }).trim();
const profile = join(canonicalRoot, 'profile'); await mkdir(profile);
const target = join(canonicalRoot, 'Aegir.app');
const archive = resolve('release/updater-e2e/Aegir-0.1.2-arm64.zip');
const candidate = resolve('release/updater-e2e/candidate/mac-arm64/Aegir.app');
execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', candidate, archive]);
execFileSync('/usr/bin/ditto', [resolve('release/mac-arm64/Aegir.app'), target]);
const bytes = readFileSync(archive);
const payload = Buffer.from(JSON.stringify({ schema: 1, version: '0.1.2', commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), architecture: 'arm64', minimumSystemVersion: '14.0', asset: 'Aegir-0.1.2-arm64.zip', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), notes: 'Full updater test: version 0.1.2 installed.' }));
const envelope = JSON.stringify({ payload: payload.toString('base64'), signature: sign(null, payload, readFileSync(join(homedir(), '.config/aegir-release/private.pem'))).toString('base64') });
const server = createServer((request, response) => {
  if (request.url === '/repos/ludvigwettlen/aegir/releases?per_page=30') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify([{ draft: false, tag_name: 'v0.1.2', assets: [{ id: 1, name: 'aegir-update-arm64.json', size: Buffer.byteLength(envelope) }, { id: 2, name: 'Aegir-0.1.2-arm64.zip', size: bytes.length }] }]));
  } else if (request.url === '/repos/ludvigwettlen/aegir/releases/assets/1') response.end(envelope);
  else if (request.url === '/repos/ludvigwettlen/aegir/releases/assets/2') { response.setHeader('Content-Length', bytes.length); createReadStream(archive).pipe(response); }
  else { response.statusCode = 404; response.end(); }
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;
let application;
let replacementPID;
try {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  application = await _electron.launch({ executablePath: join(target, 'Contents/MacOS/Aegir'), args: [`--user-data-dir=${profile}`], env, timeout: 30000 });
  const page = await application.firstWindow(); page.setDefaultTimeout(15000);
  await page.waitForFunction(() => !!window.aegir);
  const actualProfile = await application.evaluate(({ app }) => app.getPath('userData'));
  assert.equal(actualProfile, profile, 'Test must never use the normal workspace');
  await application.evaluate(({ safeStorage }, port) => {
    // Only the disposable test process uses this encryption stub; no real credentials enter this test.
    safeStorage.isEncryptionAvailable = () => true;
    safeStorage.encryptString = value => Buffer.from(value);
    safeStorage.decryptString = value => value.toString();
    const original = globalThis.fetch;
    globalThis.fetch = (url, options) => {
      const parsed = new URL(String(url));
      if (parsed.origin !== 'https://api.github.com') throw new Error('Unexpected network request in update test');
      return original(`http://127.0.0.1:${port}${parsed.pathname}${parsed.search}`, options);
    };
  }, port);
  await page.evaluate(async () => {
    await window.aegir.saveSetup('setup', 'later');
    await window.aegir.createTask({ title: 'Keep this task across the update' });
  });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('app-event', { type: 'open-settings' }));
  await page.getByRole('heading', { name: 'App updates', exact: true }).waitFor();
  await page.getByText('GitHub access · required', { exact: false }).click();
  await page.getByLabel('GitHub access token', { exact: true }).fill('disposable_update_test_token_123456789');
  await page.getByRole('button', { name: 'Save access', exact: true }).click();
  await page.waitForFunction(async () => (await window.aegir.snapshot()).updates.authenticated);
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await page.getByRole('button', { name: 'Download update', exact: true }).waitFor();
  await page.setViewportSize({ width: 950, height: 700 });
  await page.screenshot({ path: '/tmp/aegir-updater-available.png', fullPage: true });
  await page.getByRole('button', { name: 'Download update', exact: true }).click();
  let downloadState;
  const downloadDeadline = Date.now() + 180000;
  do {
    downloadState = await page.evaluate(async () => (await window.aegir.snapshot()).updates);
    if (['ready', 'error'].includes(downloadState.status)) break;
    await new Promise(ok => setTimeout(ok, 200));
  } while (Date.now() < downloadDeadline);
  assert.equal(downloadState.status, 'ready', downloadState.message);
  await page.getByRole('button', { name: 'Restart to update', exact: true }).waitFor();
  await page.screenshot({ path: '/tmp/aegir-updater-ready.png', fullPage: true });
  const quitting = application.waitForEvent('close', { timeout: 90000 });
  await page.getByRole('button', { name: 'Restart to update', exact: true }).click();
  await quitting; application = undefined;
  const pending = JSON.parse(await readFile(join(profile, 'updates/pending.json'), 'utf8'));
  const deadline = Date.now() + 150000;
  let result;
  while (Date.now() < deadline) {
    try { result = JSON.parse(await readFile(join(pending.root, 'result.json'), 'utf8')); break; } catch {}
    await new Promise(ok => setTimeout(ok, 200));
  }
  if (!result || result.status !== 'updated') {
    console.error(await readFile(join(pending.root, 'helper.log'), 'utf8').catch(() => 'No helper log'));
    throw new Error(`Replacement failed: ${JSON.stringify(result)}`);
  }
  assert.equal(result.version, '0.1.2');
  assert.equal(execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', join(target, 'Contents/Info.plist')], { encoding: 'utf8' }).trim(), '0.1.2');
  // Read the disposable database using the packaged Electron ABI.
  const code = `const D=require(${JSON.stringify(join(target, 'Contents/Resources/app.asar/node_modules/better-sqlite3'))}); const d=new D(${JSON.stringify(join(profile, 'aegir.sqlite'))},{readonly:true}); console.log(d.prepare("SELECT count(*) AS n FROM tasks WHERE title = ?").get('Keep this task across the update').n);d.close();`;
  assert.equal(execFileSync(join(target, 'Contents/MacOS/Aegir'), ['-e', code], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' }).trim(), '1');
  console.log('PASS: UI check → signed download → safe restart → app replacement → confirmed 0.1.2 startup; task preserved.');
} catch (error) {
  if (application) {
    const page = await application.firstWindow();
    console.error('Updater state:', await page.evaluate(async () => (await window.aegir.snapshot()).updates).catch(() => 'unavailable'));
    await page.screenshot({ path: '/tmp/aegir-updater-failure.png', fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  await application?.close().catch(() => {});
  // Kill only processes executing this disposable bundle; never use a global Aegir process-name match.
  try {
    const list = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
    for (const line of list.split('\n')) {
      const match = line.trim().match(/^(\d+)\s+(.*)$/);
      if (match && match[2].startsWith(target + '/Contents/')) { try { process.kill(Number(match[1]), 'SIGTERM'); } catch {} }
    }
  } catch {}
  await new Promise(ok => setTimeout(ok, 1000));
  await new Promise(ok => server.close(ok));
  if (process.env.AEGIR_KEEP_UPDATE_TEST !== '1') await rm(root, { recursive: true, force: true });
  else console.log('Disposable test retained at', canonicalRoot);
}
