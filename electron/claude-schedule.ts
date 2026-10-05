import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ClaudeRoutine, ClaudeRoutines, ClaudeRun } from '../shared/types.js';
import { claudeRoutineName, describeCron } from '../shared/cron.js';

// ---- Claude Code scheduled tasks, mirrored read-only ---------------------------------------
// The Claude desktop app keeps its scheduler in undocumented files under
// ~/Library/Application Support/Claude/claude-code-sessions/<account>/<org>/: scheduled-tasks.json
// lists the tasks, and each run is a local_<session>.json record beside it. Legolas never writes
// these files. Every shape is checked and anything unexpected is skipped, so a format change shows
// an empty list instead of an error.
const RUN_WINDOW_MS = 14 * 86_400_000;
const MAX_RUNS = 50;
type Parsed = { taskId: string; run: ClaudeRun } | null;
export type RunCache = Map<string, { mtimeMs: number; value: Parsed }>;
const defaultCache: RunCache = new Map();

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const iso = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? new Date(value).toISOString() : null;

export async function findRegistry(base: string): Promise<string | null> {
  let best: { path: string; mtimeMs: number } | null = null;
  for (const account of await readdir(base).catch(() => [])) {
    for (const org of await readdir(join(base, account)).catch(() => [])) {
      const path = join(base, account, org, 'scheduled-tasks.json');
      const info = await stat(path).catch(() => null);
      if (info?.isFile() && (!best || info.mtimeMs > best.mtimeMs)) best = { path, mtimeMs: info.mtimeMs };
    }
  }
  return best?.path || null;
}

export function frontMatter(source: string): Record<string, string> {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fields: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  lines.forEach((line, index) => {
    const pair = line.match(/^(\w+):\s*(.*)$/);
    if (!pair) return;
    let value = pair[2].trim();
    if (!value || /^[>|][+-]?$/.test(value)) {
      const rest: string[] = [];
      for (const next of lines.slice(index + 1)) { if (!/^\s+\S/.test(next)) break; rest.push(next.trim()); }
      value = rest.join(' ');
    }
    fields[pair[1]] = value.replace(/^(["'])(.*)\1$/, '$2');
  });
  return fields;
}

export function runStatus(summary: Record<string, unknown> | null, error: string): ClaudeRun['status'] {
  if (text(summary?.needs_action)) return 'needs_action';
  const category = text(summary?.status_category);
  if (error || ['blocked', 'failed', 'error'].includes(category)) return 'failed';
  return ['completed', 'review_ready'].includes(category) ? 'completed' : 'unknown';
}

export function parseRun(raw: unknown): Parsed {
  const value = record(raw);
  const taskId = text(value?.scheduledTaskId);
  const startedAt = iso(value?.createdAt);
  if (!value || !taskId || !startedAt) return null;
  const summary = record(value.postTurnSummary);
  const error = text(value.error);
  return { taskId, run: {
    startedAt, endedAt: iso(value.lastActivityAt),
    status: runStatus(summary, error),
    detail: text(summary?.status_detail) || error || text(value.title),
    needsAction: text(summary?.needs_action) || null,
  } };
}

async function readRuns(dir: string, now: number, cache: RunCache) {
  const names = (await readdir(dir).catch(() => [] as string[])).filter(name => /^local_.+\.json$/.test(name));
  const seen = new Set<string>();
  const runs: Parsed[] = [];
  for (const name of names) {
    const info = await stat(join(dir, name)).catch(() => null);
    if (!info || now - info.mtimeMs > RUN_WINDOW_MS) continue;
    seen.add(name);
    const cached = cache.get(name);
    if (cached && cached.mtimeMs === info.mtimeMs) { runs.push(cached.value); continue; }
    const value = await readFile(join(dir, name), 'utf8').then(source => source.includes('"scheduledTaskId"') ? parseRun(JSON.parse(source)) : null).catch(() => null);
    cache.set(name, { mtimeMs: info.mtimeMs, value });
    runs.push(value);
  }
  for (const name of cache.keys()) if (!seen.has(name)) cache.delete(name);
  return runs.filter((item): item is NonNullable<Parsed> => !!item);
}

export async function readClaudeRoutines(base: string, now = Date.now(), cache = defaultCache): Promise<ClaudeRoutines> {
  try {
    const source = await findRegistry(base);
    if (!source) return { tasks: [], source: null };
    const entries = record(JSON.parse(await readFile(source, 'utf8')))?.scheduledTasks;
    if (!Array.isArray(entries)) return { tasks: [], source };
    const runs = await readRuns(dirname(source), now, cache);
    const tasks: ClaudeRoutine[] = [];
    for (const entry of entries.map(record)) {
      const id = text(entry?.id);
      if (!entry || !id) continue;
      const filePath = text(entry.filePath);
      const meta = filePath ? frontMatter(await readFile(filePath, 'utf8').catch(() => '')) : {};
      const cron = text(entry.cronExpression) || null;
      const lastRunAt = text(entry.lastRunAt) || null;
      tasks.push({
        id, name: meta.name || id, description: meta.description || '',
        schedule: cron ? describeCron(cron) : 'One-off', cron, enabled: entry.enabled !== false,
        lastRunAt: lastRunAt && !Number.isNaN(Date.parse(lastRunAt)) ? lastRunAt : null,
        runs: runs.filter(item => item.taskId === id).map(item => item.run).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, MAX_RUNS),
      });
    }
    tasks.sort((a, b) => Number(b.enabled) - Number(a.enabled) || claudeRoutineName(a.name).localeCompare(claudeRoutineName(b.name)));
    return { tasks, source };
  } catch {
    return { tasks: [], source: null };
  }
}
