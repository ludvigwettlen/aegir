import { constants, existsSync, lstatSync, realpathSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { Memory } from '../shared/types.js';
import type { ProviderSetup } from '../shared/provider-setup.js';
import type { MemoryProvider } from './memory-provider.js';
import { setupCommand } from './setup-install.js';
import { claudeEnvironment } from './claude.js';

export function findGbrainBinary(configured?: string) {
  if (configured) return configured;
  return [join(homedir(), '.bun/bin/gbrain'), join(homedir(), '.local/bin/gbrain'), '/opt/homebrew/bin/gbrain', '/usr/local/bin/gbrain']
    .find(path => existsSync(path)) || 'gbrain';
}
export function parseBrainHits(output: string): Array<{ slug: string; snippet: string }> {
  const matches = [...output.matchAll(/^\[(\d+(?:\.\d+)?)\] (\S+) -- /gm)];
  if (!matches.length && output.trim() && !/no (?:results|matches|pages|documents)/i.test(output)) throw new Error('Unrecognized gbrain search response. Check your gbrain version.');
  return matches.map((match, i) => ({ slug: match[2], snippet: output.slice(match.index! + match[0].length, matches[i + 1]?.index ?? output.length).trim() }));
}
export class GbrainMemoryService implements MemoryProvider {
  constructor(private binary: string, private setup: ProviderSetup, private command = setupCommand) {}
  private folder() {
    if (!this.setup.brainDir || !isAbsolute(this.setup.brainDir)) throw new Error('Choose an existing absolute path for your Obsidian brain.');
    const folder = realpathSync(this.setup.brainDir);
    if (!lstatSync(folder).isDirectory()) throw new Error('Choose a brain folder.');
    return folder;
  }
  private run(args: string[], signal?: AbortSignal) {
    return this.command(this.binary, [...args, '--brain', this.setup.brainId], {
      cwd: this.folder(), env: claudeEnvironment(), signal, timeout: 30000,
    });
  }
  private async verifySource(signal?: AbortSignal) {
    const folder = this.folder();
    const payload = JSON.parse(await this.run(['sources', 'list', '--json'], signal));
    const source = payload.sources?.find((row: { id?: string }) => row.id === this.setup.sourceId);
    if (!source || source.mirror_read_only === true || typeof source.local_path !== 'string' || realpathSync(source.local_path) !== folder) {
      throw new Error('The selected gbrain source is not registered to this folder. Configure its brain/source mapping in gbrain, then check again.');
    }
  }
  async check(signal?: AbortSignal) {
    await this.search('Aegir setup availability', signal);
    return 'gbrain is ready. Searches use the selected brain and source; new memories go to its inbox.';
  }
  migrateLegacy() { return Promise.resolve(); } // Switching never migrates or deletes Mnemosyne data.
  async search(query: string, signal?: AbortSignal): Promise<Memory[]> {
    if (!query.trim()) return [];
    await this.verifySource(signal);
    const output = await this.run(['search', query.trim(), '--limit', '20', '--source', this.setup.sourceId], signal);
    return parseBrainHits(output).map(hit => ({ id: hit.slug, scope: 'brain', content: hit.snippet, sourceUrl: null, createdAt: '' }));
  }
  async recall(query: string, _agentId?: string, options?: { excludeDiscoveryReports?: boolean }) {
    return (await this.search(query)).filter(row => !options?.excludeDiscoveryReports || !/\bhourly discovery\b|\bdiscovery (?:run|report|findings)\b/i.test(row.content))
      .slice(0, 5).map(row => `[brain:${row.id}] ${row.content}`).join('\n');
  }
  async remember(scope: string, content: string, sourceUrl: string | null): Promise<Memory> {
    if (scope !== 'shared' && !/^agent-[0-9a-f-]+$/i.test(scope)) throw new Error('Invalid memory scope.');
    const text = content.trim().replace(/\s+/g, ' ');
    if (!text || text.length > 2000) throw new Error('Memory must be 1–2000 characters.');
    if (sourceUrl && !/^https?:\/\/[^\s]+$/.test(sourceUrl)) throw new Error('Invalid memory source URL.');
    await this.verifySource();
    const folder = this.folder();
    const inbox = join(folder, 'inbox');
    await mkdir(inbox, { recursive: true });
    if (lstatSync(inbox).isSymbolicLink() || realpathSync(inbox) !== inbox) throw new Error('The brain inbox must be inside the selected folder.');
    const file = await open(join(inbox, 'aegir-memories.md'), constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    const createdAt = new Date().toISOString();
    try {
      if (!(await file.stat()).isFile()) throw new Error('The memory inbox must be a regular file.');
      await file.write(`- ${createdAt} (${scope}): ${text}${sourceUrl ? ` Source: ${sourceUrl}` : ''}\n`);
    } finally { await file.close(); }
    return { id: `inbox/aegir-memories#${createdAt}`, scope: 'brain', content: text, sourceUrl, createdAt };
  }
  async correct(): Promise<void> { throw new Error('Edit brain memories in Obsidian. Aegir does not rewrite indexed brain pages.'); }
  async forget(): Promise<void> { throw new Error('Delete brain memories in Obsidian and refresh your gbrain index.'); }
}
