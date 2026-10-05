import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Memory } from '../shared/types.js';

export type BrainHit = { slug: string; score: number; snippet: string };

export function findGbrainBinary(configured?: string | null): string | null {
  return [configured, join(homedir(), '.bun', 'bin', 'gbrain'), '/opt/homebrew/bin/gbrain', '/usr/local/bin/gbrain']
    .find((path): path is string => !!path && existsSync(path)) || null;
}

// `gbrain search|query` prints "[score] slug -- snippet" blocks; snippets can span lines.
export function parseGbrainResults(output: string): BrainHit[] {
  const matches = [...output.matchAll(/^\[(\d+(?:\.\d+)?)\] (\S+) -- /gm)];
  return matches.map((match, index) => {
    const start = match.index! + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index! : output.length;
    const snippet = output.slice(start, end).replace(/\s*\(stale\)\s*$/, '').replace(/\s+/g, ' ').trim();
    return { slug: match[2], score: Number(match[1]), snippet };
  });
}

const STOP = new Set(('the and for with that this from about what when where which would could should have has had will your you our can '
  + 'please into just like them they their there here some more than then also reply draft write make need needs want wants help task '
  + 'tasks todo thread message current latest saved details user agent team asked contribute').split(' '));

// Keyword search beats full sentences in gbrain, so recall sends the names and rarer words from the message.
export function brainKeywords(text: string, max = 6): string {
  const seen = new Set<string>();
  const words: { word: string; score: number; order: number }[] = [];
  (text.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || []).forEach((word, order) => {
    const lower = word.toLowerCase();
    if (lower.length < 3 || STOP.has(lower) || seen.has(lower)) return;
    seen.add(lower);
    const named = /^\p{Lu}/u.test(word) && order > 0;
    words.push({ word, order, score: (named ? 2 : 0) + (word.length >= 6 ? 1 : 0) + (/\d/.test(word) ? 1 : 0) });
  });
  return words.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, max).map((item) => item.word).join(' ');
}

// Queue archives and drafts repeat everything and drown out the entity pages.
const SKIP = /^(queues|drafts)\//;

// Memory backed by the user's gbrain (~/brain). Recall is read-only search; remember appends to
// inbox/aegir-memories.md, which the brain's resolver treats as "file this properly later".
export class GbrainMemoryService {
  constructor(private binary: string, private brainDir: string) {}

  private gbrain(args: string[]): Promise<string> {
    const path = [join(homedir(), '.bun', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || '/usr/bin:/bin'].join(':');
    return new Promise((resolve, reject) => {
      execFile(this.binary, args, { timeout: 20_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, PATH: path } }, (error, stdout, stderr) => {
        if (error) reject(new Error(String(stderr).trim() || error.message));
        else resolve(stdout);
      });
    });
  }

  private async hits(text: string, limit: number): Promise<BrainHit[]> {
    const keywords = brainKeywords(text);
    if (!keywords) return [];
    let output: string;
    try { output = await this.gbrain(['query', keywords, '--limit', String(limit * 2)]); }
    catch { output = await this.gbrain(['search', keywords, '--limit', String(limit * 2)]); }
    return parseGbrainResults(output).filter((hit) => !SKIP.test(hit.slug)).slice(0, limit);
  }

  migrateLegacy(): Promise<void> { return Promise.resolve(); }

  async recall(query: string): Promise<string> {
    try {
      return (await this.hits(query, 5)).map((hit) => `[brain:${hit.slug}] ${hit.snippet.slice(0, 300)}`).join('\n');
    } catch (error) {
      console.warn('gbrain recall failed:', error);
      return '';
    }
  }

  async search(query: string): Promise<Memory[]> {
    if (!query.trim()) return [];
    return (await this.hits(query, 20)).map((hit) => ({ id: hit.slug, scope: 'brain', content: hit.snippet, sourceUrl: null, createdAt: '' }));
  }

  async remember(scope: string, content: string, sourceUrl: string | null): Promise<Memory> {
    if (scope !== 'shared' && !/^agent-[0-9a-f-]+$/i.test(scope)) throw new Error('Invalid memory scope');
    const text = content.trim().replace(/\s+/g, ' ');
    if (!text || text.length > 2000) throw new Error('Memory must be 1–2000 characters');
    const file = join(this.brainDir, 'inbox', 'aegir-memories.md');
    if (!existsSync(file)) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, '---\ntitle: Aegir memories\ntype: inbox\n---\n\n# Aegir memories\n\nThings Aegir\'s agents chose to remember. File the ones that matter onto the right brain page.\n\n');
    }
    const createdAt = new Date().toISOString();
    const who = scope === 'shared' ? 'shared' : 'agent';
    appendFileSync(file, `- ${createdAt.slice(0, 10)} (${who}): ${text}${sourceUrl ? ` [source](${sourceUrl})` : ''}\n`);
    return { id: `inbox/aegir-memories#${createdAt}`, scope, content: text, sourceUrl, createdAt };
  }

  async forget(): Promise<void> {
    throw new Error('Brain pages are edited in Obsidian or with brain-ops, not from Aegir.');
  }

  async correct(): Promise<void> {
    throw new Error('Brain pages are edited in Obsidian or with brain-ops, not from Aegir.');
  }
}
