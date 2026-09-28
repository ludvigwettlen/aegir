import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { Memory } from '../shared/types.js';
import type { Store } from './db.js';

type RecallResult = { id?: unknown; content?: unknown; source?: unknown; timestamp?: unknown };

function run(binary: string, args: string[], bank: string, dataDir?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MNEMOSYNE_BANK: bank, MNEMOSYNE_DEFAULT_SCOPE: 'global', ...(dataDir ? { MNEMOSYNE_DATA_DIR: dataDir } : {}) } });
    let output = ''; let error = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Mnemosyne timed out')); }, 30000);
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { error += chunk.toString(); });
    child.on('error', cause => { clearTimeout(timeout); reject(new Error(`Mnemosyne is unavailable: ${cause.message}`)); });
    child.on('close', code => { clearTimeout(timeout); code === 0 ? resolve(output) : reject(new Error(error.trim() || `Mnemosyne exited ${code}`)); });
  });
}

export class MemoryService {
  private migration: Promise<void> | null = null;
  constructor(private store: Store) {}
  binary() {
    const configured = this.store.getSetting('mnemosyneBinary');
    if (configured) return configured;
    const aegir = join(homedir(), '.local', 'share', 'aegir', 'mnemosyne-venv', 'bin', 'mnemosyne');
    if (existsSync(aegir)) return aegir;
    const hermes = join(homedir(), '.hermes', 'hermes-agent', 'venv', 'bin', 'mnemosyne');
    return existsSync(hermes) ? hermes : 'mnemosyne';
  }
  private bank(scope: string) { return `aegir-${scope.replace(/[^a-z0-9-]/gi, '-')}`; }
  private validateScope(scope: string) {
    if (scope !== 'shared' && !/^agent-[0-9a-f-]+$/i.test(scope)) throw new Error('Invalid memory scope');
  }
  private validateContent(content: string) {
    if (!content.trim() || content.length > 2000) throw new Error('Memory must be 1–2000 characters');
  }
  private async storeRemote(scope: string, content: string, sourceUrl: string | null): Promise<string> {
    const bank = this.bank(scope);
    try { await run(this.binary(), ['bank', 'create', bank], bank); } catch { /* Existing banks cannot be created again; store still verifies availability. */ }
    const output = await run(this.binary(), ['store', content, sourceUrl || 'aegir'], bank);
    const id = output.match(/^Stored:\s*([0-9a-f-]{8,80})\s*$/im)?.[1];
    if (!id) throw new Error('Mnemosyne did not confirm the memory was saved');
    return id;
  }
  private async results(query: string, scope: string, dataDir?: string): Promise<Memory[]> {
    const output = await run(this.binary(), ['recall', query, '20', '--json'], dataDir ? 'default' : this.bank(scope), dataDir);
    const payload = JSON.parse(output) as { results?: RecallResult[] };
    if (!Array.isArray(payload.results)) throw new Error('Invalid Mnemosyne recall response');
    return payload.results.flatMap(result => {
      if (typeof result.id !== 'string' || typeof result.content !== 'string') return [];
      const sourceUrl = typeof result.source === 'string' && /^https?:\/\//i.test(result.source) ? result.source : null;
      return [{ id: result.id, scope, content: result.content, sourceUrl, createdAt: typeof result.timestamp === 'string' ? result.timestamp : '' }];
    });
  }
  // This table is read only for the one-time transfer from old Ägir builds.
  // Each successful remote write removes its legacy row; a failed write leaves it intact.
  migrateLegacy(): Promise<void> {
    if (this.migration) return this.migration;
    this.migration = (async () => {
      for (const row of this.store.legacyMemories()) {
        this.validateScope(row.scope);
        const oldId = this.store.getSetting(`memoryProviderId:${row.id}`);
        if (this.store.getSetting(`memorySynced:${row.id}`) === 'true' && oldId && /^[0-9a-f-]{8,80}$/i.test(oldId)) {
          try {
            // A successful update confirms that the existing Mnemosyne copy is present.
            await run(this.binary(), ['update', oldId, `${row.content}${row.sourceUrl ? ` Source: ${row.sourceUrl}` : ''}`], this.bank(row.scope));
            this.store.deleteLegacyMemory(row.id);
            continue;
          } catch (error) {
            if (!String(error).includes('Memory not found')) throw error;
          }
        }
        await this.storeRemote(row.scope, row.content, row.sourceUrl);
        this.store.deleteLegacyMemory(row.id);
      }
    })().finally(() => { this.migration = null; });
    return this.migration;
  }
  async remember(scope: string, content: string, sourceUrl: string | null): Promise<Memory> {
    this.validateScope(scope); this.validateContent(content);
    await this.migrateLegacy();
    const id = await this.storeRemote(scope, content.trim(), sourceUrl);
    return { id, scope, content: content.trim(), sourceUrl, createdAt: new Date().toISOString() };
  }
  async search(query: string): Promise<Memory[]> {
    if (!query.trim()) return [];
    await this.migrateLegacy();
    const scopes = ['shared', ...this.store.list('agents').map(agent => `agent-${agent.id}`)];
    const rows = (await Promise.all(scopes.map(scope => this.results(query.trim(), scope)))).flat();
    return rows.filter((row, index) => rows.findIndex(other => other.id === row.id && other.scope === row.scope) === index);
  }
  async recall(query: string, agentId?: string): Promise<string> {
    await this.migrateLegacy();
    const scopes = ['shared', ...(agentId ? [`agent-${agentId}`] : [])];
    const recalled = (await Promise.all(scopes.map(scope => this.results(query, scope)))).flat().map(row => `[${row.scope}] ${row.content}`);
    const hermesDataDir = this.store.getSetting('hermesMemoryDataDir');
    if (hermesDataDir) {
      try { recalled.push(...(await this.results(query, 'hermes', hermesDataDir)).map(row => `[hermes] ${row.content}`)); }
      catch (error) { console.warn('Hermes memory recall failed:', error); }
    }
    return recalled.join('\n');
  }
  async forget(id: string, scope: string): Promise<void> {
    this.validateScope(scope);
    if (!/^[0-9a-f-]{8,80}$/i.test(id)) throw new Error('Invalid memory ID');
    await this.migrateLegacy();
    await run(this.binary(), ['delete', id], this.bank(scope));
  }
  async correct(id: string, scope: string, content: string): Promise<void> {
    this.validateScope(scope); this.validateContent(content);
    if (!/^[0-9a-f-]{8,80}$/i.test(id)) throw new Error('Invalid memory ID');
    await this.migrateLegacy();
    await run(this.binary(), ['update', id, content.trim()], this.bank(scope));
  }
}
