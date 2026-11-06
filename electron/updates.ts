import { updateFs } from './update-files.js';
const { rm } = updateFs.promises;
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { UpdateState } from '../shared/updates.js';
import { compareVersions, readSignedManifest, type UpdateManifest } from './update-manifest.js';
import { extractUpdate } from './update-archive.js';

const assetSchema = z.object({ id: z.number().int().positive(), name: z.string(), size: z.number().int().nonnegative() });
const releaseSchema = z.object({ draft: z.boolean(), tag_name: z.string(), assets: z.array(assetSchema) });
type Asset = z.infer<typeof assetSchema>;
export type UpdateOptions = {
  repository: string; publicKey: string; version: string; architecture: string; systemVersion: string; root: string;
  initialMessage?: string;
  supported: boolean; token: () => string; saveToken: (token: string) => void; changed: () => void;
  install: (candidate: string, manifest: UpdateManifest) => Promise<void>;
  fetch?: typeof fetch;
};
export async function githubRequest(path: string, token: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Response> {
  let url = new URL(path, 'https://api.github.com');
  if (url.origin !== 'https://api.github.com' || !url.pathname.startsWith('/repos/ludvigwettlen/aegir/')) throw new Error('Invalid update endpoint.');
  for (let hop = 0; hop < 5; hop++) {
    const isApi = url.origin === 'https://api.github.com';
    const response = await fetcher(url, { signal, redirect: 'manual', headers: {
      Accept: /\/releases\/assets\/\d+$/.test(url.pathname) ? 'application/octet-stream' : 'application/vnd.github+json', 'User-Agent': 'Aegir-Updater',
      ...(isApi ? { 'X-GitHub-Api-Version': '2022-11-28' } : {}),
      ...(isApi && token ? { Authorization: `Bearer ${token}` } : {}),
    } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) throw new Error('Invalid update redirect.');
      const next = new URL(location, url);
      if (next.protocol !== 'https:' || next.username || next.password || !['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(next.hostname)) throw new Error('Untrusted update redirect.');
      url = next; continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(response.status === 401 || response.status === 403 || response.status === 404 ? 'GitHub access failed. Check your saved GitHub access or try again later.' : `Update request failed (${response.status}).`); }
    return response;
  }
  throw new Error('Too many update redirects.');
}
async function boundedText(response: Response, limit: number) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of Readable.fromWeb(response.body as never)) { size += chunk.length; if (size > limit) { await response.body?.cancel().catch(() => {}); throw new Error('Update response is too large.'); } chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks).toString('utf8');
}
export class UpdateService {
  private value: UpdateState;
  private controller?: AbortController;
  private manifest?: UpdateManifest;
  private asset?: Asset;
  private candidate?: string;
  private stage?: string;
  constructor(private options: UpdateOptions) {
    this.value = { version: options.version, configured: !!options.publicKey, authenticated: false, status: 'idle', message: options.initialMessage || (options.supported ? 'Check for a signed release from this repository.' : 'Updates can be installed from a packaged macOS app.') };
  }
  state(): UpdateState {
    let authenticated = false;
    try { authenticated = !!this.options.token(); } catch { /* Keychain unavailable: ask for access again, never expose credentials. */ }
    return { ...this.value, authenticated };
  }
  get installing() { return this.value.status === 'installing'; }
  get busy() { return !!this.controller || this.installing; }
  private change(change: Partial<UpdateState>) { this.value = { ...this.value, ...change }; this.options.changed(); }
  saveToken(token: string) {
    if (this.busy) throw new Error('Finish or cancel the update operation first.');
    if (token && (!/^[A-Za-z0-9_]+$/.test(token) || token.length < 20 || token.length > 500)) throw new Error('Enter a valid GitHub access token.');
    this.options.saveToken(token); this.manifest = undefined; this.candidate = undefined;
    this.change({ status: 'idle', availableVersion: undefined, notes: undefined, message: token ? 'GitHub access saved. Check for updates to verify it.' : 'GitHub access removed.' });
  }
  cancel() { this.controller?.abort(); }
  async close() {
    this.cancel();
    while (this.controller) await new Promise(ok => setTimeout(ok, 50));
    if (!this.installing && this.stage) await rm(this.stage, { recursive: true, force: true });
  }
  private async operation(action: (signal: AbortSignal) => Promise<void>) {
    if (this.busy) throw new Error('An update operation is already in progress.');
    const controller = new AbortController(); this.controller = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15 * 60_000)]);
    try { await action(signal); }
    catch (error) {
      const cancelled = controller.signal.aborted;
      this.candidate = undefined;
      this.change({ status: cancelled ? 'idle' : 'error', progress: undefined, message: cancelled ? 'Update cancelled. Your installed app is unchanged.' : error instanceof Error ? error.message : 'Update failed. Please try again.' });
    } finally { this.controller = undefined; }
  }
  async check() {
    return this.operation(async signal => {
      this.manifest = undefined; this.asset = undefined; this.candidate = undefined;
      this.change({ status: 'checking', availableVersion: undefined, notes: undefined, progress: undefined, message: 'Checking GitHub releases…' });
      if (!this.options.publicKey) throw new Error('No trusted release key is configured. Rebuild the app with release configuration.');
      const token = this.options.token();
      const request = (path: string) => githubRequest(path, token, signal, this.options.fetch);
      const releases = z.array(releaseSchema).parse(JSON.parse(await boundedText(await request(`/repos/${this.options.repository}/releases?per_page=30`), 2 * 1024 ** 2)));
      let best: { manifest: UpdateManifest; asset: Asset } | undefined;
      for (const release of releases.filter(r => !r.draft)) {
        const entry = release.assets.find(a => a.name === `aegir-update-${this.options.architecture}.json`);
        if (!entry) continue;
        const manifest = readSignedManifest(await boundedText(await request(`/repos/${this.options.repository}/releases/assets/${entry.id}`), 100000), this.options.publicKey);
        if (release.tag_name !== `v${manifest.version}` || manifest.architecture !== this.options.architecture) throw new Error('Release metadata does not match its signed manifest.');
        if (compareVersions(manifest.version, this.options.version) <= 0) continue;
        const required = manifest.minimumSystemVersion.split('.').map(Number), current = this.options.systemVersion.split('.').map(Number);
        let compatible = true;
        for (let i = 0; i < 3; i++) { if ((current[i] || 0) !== (required[i] || 0)) { compatible = (current[i] || 0) > (required[i] || 0); break; } }
        if (!compatible) continue;
        const asset = release.assets.find(a => a.name === manifest.asset && a.size === manifest.size);
        if (!asset) throw new Error('Signed release archive is missing or its size has changed.');
        if (!best || compareVersions(manifest.version, best.manifest.version) > 0) best = { manifest, asset };
      }
      this.manifest = best?.manifest; this.asset = best?.asset;
      this.change(best ? { status: 'available', availableVersion: best.manifest.version, notes: best.manifest.notes, message: 'A verified update is available.' } : { status: 'idle', message: 'You have the latest compatible signed release.' });
    });
  }
  async download() {
    return this.operation(async signal => {
      const manifest = this.manifest, asset = this.asset;
      if (!manifest || !asset) throw new Error('Check for updates before downloading.');
      if (!this.options.supported) throw new Error('Install a packaged Aegir app before downloading an update.');
      await mkdir(this.options.root, { recursive: true, mode: 0o700 });
      const disk = await statfs(this.options.root);
      if (disk.bavail * disk.bsize < 5 * 1024 ** 3) throw new Error('Free at least 5 GB before downloading an update.');
      if (this.stage) await rm(this.stage, { recursive: true, force: true });
      this.stage = await mkdtemp(join(this.options.root, 'download-'));
      this.change({ status: 'downloading', progress: 0, message: 'Downloading the signed update…' });
      try {
        const archive = join(this.stage, 'app.zip'), hash = createHash('sha256'); let received = 0, last = 0;
        const response = await githubRequest(`/repos/${this.options.repository}/releases/assets/${asset.id}`, this.options.token(), signal, this.options.fetch);
        const meter = new Transform({ transform: (chunk, _encoding, done) => {
          received += chunk.length;
          if (received > manifest.size) { done(new Error('Update download is larger than its signed size.')); return; }
          hash.update(chunk);
          if (Date.now() - last > 200) { last = Date.now(); this.change({ progress: Math.floor(received / manifest.size * 100) }); }
          done(null, chunk);
        } });
        await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(archive, { flags: 'wx', mode: 0o600 }), { signal });
        if (received !== manifest.size || hash.digest('hex') !== manifest.sha256) throw new Error('Update checksum verification failed. Nothing was installed.');
        this.change({ message: 'Download verified. Preparing the app…', progress: 100 });
        this.candidate = await extractUpdate(archive, join(this.stage, 'extracted'), signal);
        await rm(archive);
        this.change({ status: 'ready', message: 'Ready. Finish active work, then restart to update.' });
      } catch (error) { await rm(this.stage, { recursive: true, force: true }); this.stage = undefined; throw error; }
    });
  }
  async install() {
    if (this.busy || this.value.status !== 'ready' || !this.candidate || !this.manifest) throw new Error('Download and verify an update first.');
    this.change({ status: 'installing', message: 'Preparing a safe restart…' });
    try { await this.options.install(this.candidate, this.manifest); }
    catch (error) { this.change({ status: 'ready', message: error instanceof Error ? error.message : 'Could not install update.' }); throw error; }
  }
}
