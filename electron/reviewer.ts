import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Store } from './db.js';
import type { ConnectorManager } from './connectors.js';
import type { CodexProvider } from './codex.js';
import type { MemoryService } from './memory.js';

type Finding = { title: string; notes: string; sourceUrl: string; sourceKey: string };
type Extracted = { tasks?: Finding[]; memories?: { content: string; sourceUrl: string }[] };
const queries = [
  'recent decisions and commitments from the past day',
  'action items, follow-ups, or things someone promised to do in the past day',
  'recent meeting notes and transcripts with decisions or next steps'
];
function contentText(result: unknown): string {
  const value = result as { content?: Array<{ type?: string; text?: string }> };
  return value.content?.filter(x => x.type === 'text').map(x => x.text || '').join('\n').slice(0, 60000) || JSON.stringify(result).slice(0, 60000);
}
export function jsonObject(text: string): Extracted {
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  try { return JSON.parse(text.slice(start, end + 1)) as Extracted; } catch { return {}; }
}
export function searchArguments(schema: Record<string, unknown>, query: string): Record<string, unknown> {
  const properties = (schema.properties || {}) as Record<string, { type?: string }>;
  const names = Object.keys(properties);
  const key = ['query', 'search_query', 'searchQuery', 'q', 'text'].find(name => names.includes(name)) || names.find(name => /query|search|text/i.test(name));
  if (!key) throw new Error(`Search tool has no query field: ${names.join(', ') || 'empty schema'}`);
  return { [key]: query };
}
export function taskSourceKey(provider: string, sourceUrl: string, title: string): string {
  return createHash('sha256').update(`${provider}|${sourceUrl.trim()}|${title.toLowerCase().replace(/\s+/g, ' ').trim()}`).digest('hex');
}

export class Reviewer extends EventEmitter {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  constructor(private store: Store, private connectors: ConnectorManager, private model: CodexProvider, private memory: MemoryService, private cwd: string) { super(); }
  start() { this.timer = setInterval(() => void this.run(), 60 * 60 * 1000); }
  stop() { if (this.timer) clearInterval(this.timer); }
  async run() {
    if (this.running) return; this.running = true;
    try {
      for (const provider of ['slack', 'notion'] as const) {
        if (this.connectors.states[provider].status !== 'connected') continue;
        const available = this.connectors.states[provider].tools;
        const search = available.find(name => /search.*(message|notion|page|content)/i.test(name)) || available.find(name => /search/i.test(name));
        if (!search) {
          const scan = this.store.createScan(provider, 'Tool discovery'); this.store.finishScan(scan.id, 'failed', 0, 0, 'No search tool was exposed by this connection'); this.emit('change'); continue;
        }
        for (const query of queries) {
          const scan = this.store.createScan(provider, query); this.emit('change');
          try {
            const schema = this.connectors.toolInfo(provider, search)?.inputSchema || {};
            const result = await this.connectors.call(provider, search, searchArguments(schema, query));
            const raw = contentText(result);
            if (!raw || raw === '[]') { this.store.finishScan(scan.id, 'complete', 0, 0, null); continue; }
            const instructions = `You review exploratory ${provider} search results for one person's agent workspace. Return ONLY a JSON object with tasks and memories arrays. Tasks must have title, notes, sourceUrl, sourceKey. Memories must have content, sourceUrl. Only include clear commitments, actionable follow-ups, decisions, or durable facts. Never invent a source URL or fact. If source links are absent, omit the item. Keep at most 8 tasks and 8 memories. Memory instructions: ${this.store.getSetting('memoryInstructions') || ''}`;
            const response = await this.model.run({ cwd: this.cwd, instructions, prompt: `Search query: ${query}\nSearch results:\n${raw}`, tools: [], modelTier: 'lightweight', onDelta: () => {} });
            const extracted = jsonObject(response.text);
            let created = 0;
            for (const task of extracted.tasks || []) {
              if (!task.title || !task.sourceUrl || !/^https?:\/\//.test(task.sourceUrl) || !raw.includes(task.sourceUrl)) continue;
              const key = taskSourceKey(provider, task.sourceUrl, task.title);
              const exists = this.store.db.prepare('SELECT id FROM tasks WHERE sourceKey=?').get(key);
              if (!exists) { this.store.createTask(task.title.slice(0, 240), task.notes || '', 'proposed', task.sourceUrl, key); created++; }
            }
            for (const item of extracted.memories || []) {
              if (!item.content || !item.sourceUrl || !/^https?:\/\//.test(item.sourceUrl) || !raw.includes(item.sourceUrl)) continue;
              const exists = this.store.db.prepare('SELECT id FROM memories WHERE content=? AND sourceUrl=?').get(item.content, item.sourceUrl);
              if (!exists) await this.memory.remember('shared', item.content, item.sourceUrl);
            }
            this.store.finishScan(scan.id, 'complete', (extracted.tasks?.length || 0) + (extracted.memories?.length || 0), created, null);
          } catch (error) { this.store.finishScan(scan.id, 'failed', 0, 0, String(error)); }
          this.emit('change');
        }
      }
      await this.memory.retryPending();
    } finally { this.running = false; this.emit('change'); }
  }
}
