import { updateFs } from './update-files.js';
const { rm } = updateFs.promises;
import { describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { compareVersions, readSignedManifest } from './update-manifest.js';
import { githubRequest, UpdateService } from './updates.js';
import { extractUpdate, updateEntryPath } from './update-archive.js';

const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const manifest = { schema: 1, version: '0.1.2', commit: 'a'.repeat(40), architecture: 'arm64', minimumSystemVersion: '14.0', asset: 'Aegir-0.1.2-arm64.zip', size: 3, sha256: createHash('sha256').update('zip').digest('hex'), notes: 'Updater test completed.' };
function signed(value = manifest) { const payload = Buffer.from(JSON.stringify(value)); return JSON.stringify({ payload: payload.toString('base64'), signature: sign(null, payload, keys.privateKey).toString('base64') }); }
function releases() { return [{ draft: false, tag_name: 'v0.1.2', assets: [{ id: 1, name: 'aegir-update-arm64.json', size: 1000 }, { id: 2, name: manifest.asset, size: 3 }] }]; }
function fixture(fetcher?: typeof fetch) {
  let token = 'test-token-with-enough-characters';
  const service = new UpdateService({ repository: 'ludvigwettlen/aegir', publicKey, version: '0.1.1', architecture: 'arm64', systemVersion: '14.1', root: tmpdir(), supported: true, token: () => token, saveToken: t => { token = t; }, changed: () => {}, install: async () => {},
    fetch: fetcher || (async input => new Response(String(input).includes('/assets/1') ? signed() : JSON.stringify(releases()))) as typeof fetch });
  return service;
}
describe('signed releases', () => {
  it('verifies exact payload bytes and rejects tampering, other keys and invalid metadata', () => {
    expect(readSignedManifest(signed(), publicKey)).toEqual(manifest);
    const envelope = JSON.parse(signed()); envelope.payload = Buffer.from(JSON.stringify({ ...manifest, version: '9.0.0' })).toString('base64');
    expect(() => readSignedManifest(JSON.stringify(envelope), publicKey)).toThrow('signature');
    const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(() => readSignedManifest(signed(), other)).toThrow('signature');
    expect(() => readSignedManifest(signed({ ...manifest, asset: '../evil.zip' }), publicKey)).toThrow();
  });
  it('orders numeric versions and prereleases without allowing downgrades', () => {
    expect(compareVersions('0.1.10', '0.1.2')).toBe(1);
    expect(compareVersions('0.1.2', '0.1.2-test.20')).toBe(1);
    expect(compareVersions('0.1.2-test.10', '0.1.2-test.2')).toBe(1);
    expect(compareVersions('0.1.1', '0.1.2')).toBe(-1);
  });
  it('finds verified updates, excludes incompatible builds, and never exposes a token', async () => {
    const service = fixture(); await service.check();
    expect(service.state().status).toBe('available'); expect(service.state().availableVersion).toBe('0.1.2');
    expect(JSON.stringify(service.state())).not.toContain('test-token');
    const newerOS = fixture((async input => new Response(String(input).includes('/assets/1') ? signed({ ...manifest, minimumSystemVersion: '99.0' }) : JSON.stringify(releases()))) as typeof fetch);
    await newerOS.check(); expect(newerOS.state().availableVersion).toBeUndefined();
  });
  it('checks a public release without sending an authorization header', async () => {
    const fetcher = (async (input, options) => {
      expect(new Headers(options?.headers).has('authorization')).toBe(false);
      return new Response(String(input).includes('/assets/1') ? signed() : JSON.stringify(releases()));
    }) as typeof fetch;
    const service = fixture(fetcher);
    service.saveToken('');
    await service.check();
    expect(service.state().availableVersion).toBe('0.1.2');
  });
  it('reports auth failures and supports cancellation and duplicate operation rejection', async () => {
    const denied = fixture((async () => new Response('denied', { status: 401 })) as typeof fetch);
    await denied.check(); expect(denied.state().status).toBe('error'); expect(denied.state().message).toContain('GitHub access');
    const service = fixture(((_input, options) => new Promise((_ok, fail) => options!.signal!.addEventListener('abort', () => fail(new Error('aborted')), { once: true }))) as typeof fetch);
    const checking = service.check(); await expect(service.check()).rejects.toThrow('already'); service.cancel(); await checking;
    expect(service.state().status).toBe('idle');
  });
  it('strips authorization from CDN redirects and rejects credential-stealing redirects', async () => {
    const calls: { url: string; headers: Headers }[] = [];
    const fetcher = (async (url, options) => { calls.push({ url: String(url), headers: new Headers(options?.headers) }); return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/asset' } }) : new Response('zip'); }) as typeof fetch;
    await githubRequest('/repos/ludvigwettlen/aegir/releases/assets/1', 'secret', new AbortController().signal, fetcher);
    expect(calls[0].headers.get('authorization')).toBe('Bearer secret'); expect(calls[1].headers.has('authorization')).toBe(false);
    await expect(githubRequest('/repos/ludvigwettlen/aegir/releases/assets/1', 'secret', new AbortController().signal, (async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } })) as typeof fetch)).rejects.toThrow('Untrusted');
  });
  it('rejects corrupted archive bytes before extraction or installation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aegir-update-test-'));
    const service = new UpdateService({ repository: 'ludvigwettlen/aegir', publicKey, version: '0.1.1', architecture: 'arm64', systemVersion: '14', root, supported: true, token: () => 'token', saveToken: () => {}, changed: () => {}, install: async () => { throw new Error('must not install'); }, fetch: (async input => new Response(String(input).includes('/assets/1') ? signed() : String(input).includes('/assets/2') ? 'bad' : JSON.stringify(releases()))) as typeof fetch });
    try { await service.check(); await service.download(); expect(service.state().message).toContain('checksum'); expect(service.state().status).toBe('error'); await expect(service.install()).rejects.toThrow('Download'); }
    finally { await rm(root, { recursive: true, force: true }); }
  });
});
describe('archive extraction', () => {
  it('rejects traversal, absolute and unexpected paths', () => {
    for (const path of ['/Aegir.app/evil', 'Aegir.app/../evil', 'Aegir.app/./evil', 'Aegir.app\\evil', 'another.app/file']) expect(() => updateEntryPath(path)).toThrow();
  });
  it('extracts executable files and internal framework links; rejects escaping symlinks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aegir-zip-test-'));
    try {
      // Python only generates developer fixtures. Installed users do not need it.
      const archive = join(root, 'safe.zip');
      execFileSync('/usr/bin/python3', ['-c', `import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1],'w')\ne=zipfile.ZipInfo('Aegir.app/Contents/MacOS/Aegir');e.external_attr=0o100755<<16;z.writestr(e,'binary')\ne=zipfile.ZipInfo('Aegir.app/Contents/Link');e.external_attr=0o120777<<16;z.writestr(e,'MacOS/Aegir')\nz.close()`, archive]);
      const app = await extractUpdate(archive, join(root, 'safe'), new AbortController().signal);
      expect(await readFile(join(app, 'Contents/Link'), 'utf8')).toBe('binary');
      execFileSync('/usr/bin/python3', ['-c', `import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1],'w')\ne=zipfile.ZipInfo('Aegir.app/escape');e.external_attr=0o120777<<16;z.writestr(e,'../../outside')\nz.close()`, join(root, 'bad.zip')]);
      await expect(extractUpdate(join(root, 'bad.zip'), join(root, 'bad'), new AbortController().signal)).rejects.toThrow('escapes');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
it.skipIf(process.env.AEGIR_UPDATE_ARCHIVE !== '1')('extracts the real packaged candidate without changing framework links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aegir-real-archive-'));
  try { await extractUpdate(join(process.cwd(), 'release/updater-e2e/Aegir-0.1.2-arm64.zip'), join(root, 'app'), new AbortController().signal); }
  finally { await rm(root, { recursive: true, force: true }); }
}, 120000);
it.skipIf(process.env.AEGIR_LIVE_UPDATE_ACCESS !== '1')('reads private GitHub release assets with the maintainer account without leaking credentials on redirect', async () => {
  const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
  const signal = AbortSignal.timeout(30000);
  const response = await githubRequest('/repos/ludvigwettlen/aegir/releases?per_page=30', token, signal);
  const list = await response.json() as { assets: { id: number; name: string; size: number }[] }[];
  const asset = list.flatMap(release => release.assets).find(item => item.name === 'Aegir-updater-proof-arm64.zip');
  expect(asset).toBeTruthy();
  const download = await githubRequest(`/repos/ludvigwettlen/aegir/releases/assets/${asset!.id}`, token, signal);
  const bytes = Buffer.from(await download.arrayBuffer());
  expect(bytes.byteLength).toBe(asset!.size);
  const expected = (await readFile(join(process.cwd(), 'release/updater-test/assets/SHA256SUMS.txt'), 'utf8')).split('\n').find(line => line.endsWith('Aegir-updater-proof-arm64.zip'))!.split(' ')[0];
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected);
}, 45000);
