import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { Store } from './db.js';

function run(binary: string, args: string[], bank: string, dataDir?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MNEMOSYNE_BANK: bank, ...(dataDir ? { MNEMOSYNE_DATA_DIR: dataDir } : {}) } });
    let output = ''; let error = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Mnemosyne timed out')); }, 30000);
    child.on('error', () => clearTimeout(timeout));
    child.on('close', () => clearTimeout(timeout));
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { error += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(error || `Mnemosyne exited ${code}`)));
  });
}

export class MemoryService {
  constructor(private store: Store) {}
  binary() {
    const configured = this.store.getSetting('mnemosyneBinary');
    if (configured) return configured;
    const hermes = join(homedir(), '.hermes', 'hermes-agent', 'venv', 'bin', 'mnemosyne');
    return existsSync(hermes) ? hermes : 'mnemosyne';
  }
  private async search(query: string, bank: string, dataDir?: string): Promise<string> {
    const output = await run(this.binary(), ['recall', query, '5', '--json'], bank, dataDir);
    const payload = JSON.parse(output) as { results?: { content?: unknown }[] };
    if (!Array.isArray(payload.results)) throw new Error('Invalid Mnemosyne recall response');
    return payload.results.map(result => typeof result.content === 'string' ? result.content.trim() : '').filter(Boolean).join('\n');
  }
  private bank(scope: string) { return `aegir-${scope.replace(/[^a-z0-9-]/gi, '-')}`; }
  private async sync(id: string, scope: string, content: string, sourceUrl: string | null) {
    const bank = this.bank(scope);
    try { await run(this.binary(), ['bank', 'create', bank], bank); } catch { /* An existing bank is expected. */ }
    const output = await run(this.binary(), ['store', `${content}${sourceUrl ? ` Source: ${sourceUrl}` : ''}`], bank);
    const providerId = output.match(/^Stored:\s*([0-9a-f-]+)\s*$/im)?.[1];
    if (providerId) this.store.setSetting(`memoryProviderId:${id}`, providerId);
    this.store.setSetting(`memorySynced:${id}`, 'true');
  }
  async remember(scope: string, content: string, sourceUrl: string | null) {
    if (scope !== 'shared' && !/^agent-[0-9a-f-]+$/i.test(scope)) throw new Error('Invalid memory scope');
    if (!content.trim() || content.length > 2000) throw new Error('Memory must be 1–2000 characters');
    const existing = this.store.db.prepare('SELECT id FROM memories WHERE scope=? AND content=?').get(scope, content) as { id: string } | undefined;
    if (existing) return this.store.list<{ id: string }>('memories').find(x => x.id === existing.id);
    const row = this.store.remember(scope, content, sourceUrl);
    try { await this.sync(row.id, scope, content, sourceUrl); }
    catch { this.store.setSetting(`memorySynced:${row.id}`, 'false'); }
    return row;
  }
  async recall(query: string, agentId?: string): Promise<string> {
    const scopes = ['shared', ...(agentId ? [`agent-${agentId}`] : [])];
    const recalled: string[] = [];
    const recalledScopes = new Set<string>();
    for (const scope of scopes) {
      try {
        const result = await this.search(query, this.bank(scope));
        if (result) { recalled.push(`[${scope}] ${result}`); recalledScopes.add(scope); }
      }
      catch { /* Use the local mirror below. */ }
    }
    // The external Hermes bank is a retrieval source only. All writes above and
    // below remain in aegir-* banks; source memories never enter the local mirror.
    const hermesDataDir = this.store.getSetting('hermesMemoryDataDir');
    if (hermesDataDir) {
      try {
        const result = await this.search(query, 'default', hermesDataDir);
        if (result) recalled.push(`[hermes] ${result}`);
      } catch (error) { console.warn('Hermes memory recall failed:', error); }
    }
    const terms = query.toLowerCase().split(/\W+/).filter(x => x.length > 3);
    const local = this.store.list<{ id: string; scope: string; content: string }>('memories')
      .filter(x => scopes.includes(x.scope) && (!recalledScopes.has(x.scope) || this.store.getSetting(`memorySynced:${x.id}`) === 'false') && terms.some(term => x.content.toLowerCase().includes(term)))
      .slice(0, 8).map(x => `[${x.scope}] ${x.content}`);
    return [...recalled, ...local].join('\n');
  }
  async forget(id: string) {
    const row = this.store.db.prepare('SELECT scope FROM memories WHERE id=?').get(id) as { scope: string } | undefined;
    if (!row) return;
    const providerId = this.store.getSetting(`memoryProviderId:${id}`);
    if (this.store.getSetting(`memorySynced:${id}`) === 'true') {
      if (!providerId) throw new Error('Mnemosyne did not return an ID for this memory; cannot safely forget it in both stores');
      await run(this.binary(), ['delete', providerId], this.bank(row.scope));
    }
    this.store.forgetMemory(id);
    this.store.db.prepare('DELETE FROM settings WHERE key IN (?,?)').run(`memoryProviderId:${id}`, `memorySynced:${id}`);
  }
  async correct(id: string, content: string) {
    const row = this.store.db.prepare('SELECT scope,sourceUrl,content FROM memories WHERE id=?').get(id) as { scope: string; sourceUrl: string | null; content: string } | undefined;
    if (!row) throw new Error('Memory not found');
    if (!content.trim() || content.length > 2000) throw new Error('Memory must be 1–2000 characters');
    if (content.trim() === row.content) return;
    await this.forget(id);
    await this.remember(row.scope, content.trim(), row.sourceUrl);
  }
  async retryPending() {
    for (const row of this.store.list<{ id: string; scope: string; content: string; sourceUrl: string | null }>('memories')) {
      if (this.store.getSetting(`memorySynced:${row.id}`) === 'false') {
        try { await this.sync(row.id, row.scope, row.content, row.sourceUrl); }
        catch { break; }
      }
    }
  }
}
