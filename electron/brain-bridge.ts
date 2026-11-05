import { normalizeLabels, taskLabels } from '../shared/task-labels.js';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { JSON_SCHEMA, load } from 'js-yaml';
import type { Store } from './db.js';
import type { Task } from '../shared/types.js';
import { defaultBrainBridgeConfig, type BrainBridgeConfig, type BrainBridgeReport, type BrainBridgeState } from '../shared/brain-bridge.js';
import { readProviderSetup } from '../shared/provider-setup.js';
import { validTaskDate } from '../shared/tasks.js';
import { normalizeTaskLink } from '../shared/task-links.js';

const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_PASS_BYTES = 8 * MAX_INPUT_BYTES;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const inside = (parent: string, child: string) => { const path = relative(parent, child); return !path || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)); };
function folder(path: unknown, saved = false): string {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) throw new Error('Choose an existing absolute folder path.');
  const canonical = realpathSync(path);
  if (!lstatSync(canonical).isDirectory() || (saved && canonical !== path)) throw new Error('The configured folder changed. Select it again in Settings.');
  return canonical;
}
function subfolder(root: string, name: string) {
  folder(root, true);
  const path = join(root, name);
  if (!existsSync(path)) mkdirSync(path);
  if (lstatSync(path).isSymbolicLink() || realpathSync(path) !== path || !lstatSync(path).isDirectory()) throw new Error('Bridge subfolders must stay inside the configured folder.');
  return path;
}
export type InboxItem = { title: string; notes: string; sourceKey: string; sourceUrl: string | null; label: string | null; labels?: string[]; dueAt: string | null };
export function parseInboxItem(raw: unknown): InboxItem {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Each suggestion must be an object.');
  const value = raw as Record<string, unknown>;
  const allowed = ['title', 'notes', 'sourceKey', 'sourceUrl', 'label', 'labels', 'dueAt'];
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unsupported suggestion fields. Existing tasks, priorities and statuses cannot be changed through intake.');
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  if (!title || title.length > 240) throw new Error('title must be 1–240 characters.');
  if (value.notes !== undefined && typeof value.notes !== 'string') throw new Error('notes must be text.');
  const notes = (value.notes as string | undefined) || '';
  if (notes.length > 20_000) throw new Error('notes must be at most 20,000 characters.');
  if (typeof value.sourceKey !== 'string' || !/^[\w:.\-/]{1,200}$/.test(value.sourceKey)) throw new Error('A stable sourceKey is required (letters, numbers, colon, dot, dash, underscore or slash).');
  let sourceUrl: string | null = null;
  if (value.sourceUrl !== undefined && value.sourceUrl !== null && value.sourceUrl !== '') {
    if (typeof value.sourceUrl !== 'string' || !/^https?:\/\//i.test(value.sourceUrl) || !(sourceUrl = normalizeTaskLink(value.sourceUrl))) throw new Error('sourceUrl must be an HTTP or HTTPS link.');
  }
  if (value.label !== undefined && value.label !== null && (typeof value.label !== 'string' || value.label.length > 40)) throw new Error('label must be text up to 40 characters.');
  const label = typeof value.label === 'string' ? value.label.trim().replace(/^#/, '').toLowerCase() || null : null;
  const dueAt = value.dueAt === undefined || value.dueAt === null || value.dueAt === '' ? null : value.dueAt;
  if (dueAt !== null && (typeof dueAt !== 'string' || !validTaskDate(dueAt))) throw new Error('dueAt must be a valid YYYY-MM-DD date.');
  return { title, notes, sourceKey: value.sourceKey, sourceUrl, label, ...(value.labels !== undefined ? { labels: normalizeLabels(value.labels) } : {}), dueAt };
}
export function parseInboxFile(name: string, text: string): InboxItem[] {
  let raw: unknown;
  if (/\.md$/i.test(name)) {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) throw new Error('Markdown suggestions need YAML front matter and a body.');
    const header: unknown = load(match[1], { schema: JSON_SCHEMA, json: false });
    if (!header || typeof header !== 'object' || Array.isArray(header)) throw new Error('Invalid Markdown front matter.');
    raw = { ...header, notes: match[2].trim() };
  } else raw = JSON.parse(text);
  const entries = Array.isArray(raw) ? raw : [raw];
  if (!entries.length || entries.length > 100) throw new Error('Use 1–100 suggestions per file.');
  return entries.map(parseInboxItem);
}
function archive(root: string, path: string, category: 'processed' | 'rejected', error?: string, expected?: { ino: number; dev: number; mtimeMs: number; size: number }) {
  const destination = join(subfolder(root, category), `${Date.now()}-${randomUUID()}-${basename(path)}`);
  // Never replace an archive with the same name. Preserve the producer's file on any failure.
  linkSync(path, destination);
  const archived = lstatSync(destination), current = lstatSync(path);
  const stable = archived.ino === current.ino && archived.dev === current.dev && (!expected || (archived.ino === expected.ino && archived.dev === expected.dev && archived.mtimeMs === expected.mtimeMs && archived.size === expected.size));
  if (!stable) { unlinkSync(destination); throw new Error('The intake file changed while importing. Its replacement is kept for the next check.'); }
  unlinkSync(path);
  if (error) writeFileSync(`${destination}.error.txt`, `${error}\n`, { flag: 'wx', mode: 0o600 });
}
function atomicWrite(root: string, name: string, content: string) {
  folder(root, true); const target = join(root, name);
  if (existsSync(target)) {
    if (lstatSync(target).isSymbolicLink() || !lstatSync(target).isFile()) throw new Error('Export target must be a regular file.');
    if (readFileSync(target, 'utf8') === content) return false;
  }
  const temp = join(root, `.aegir-${randomUUID()}.tmp`);
  try { writeFileSync(temp, content, { flag: 'wx', mode: 0o600 }); renameSync(temp, target); }
  finally { if (existsSync(temp)) unlinkSync(temp); }
  return true;
}
export function taskExport(tasks: Task[]) {
  const rows = tasks.map(({ id, title, notes, status, priority, label, labels, dueAt, listId, sourceKey, sourceUrl, outputDir, snoozedUntil, createdAt, updatedAt, completedAt }) => ({ id, title, notes, status, priority, label, labels, dueAt, listId, sourceKey, sourceUrl, outputDir, snoozedUntil, createdAt, updatedAt, completedAt }));
  const escape = (text: string) => text.replace(/[\r\n]+/g, ' ').replace(/([\\`*_[\]<>])/g, '\\$1');
  return {
    json: `${JSON.stringify({ version: 1, tasks: rows }, null, 2)}\n`,
    markdown: `# Aegir tasks\n\nGenerated by Aegir. Edit tasks in the app; this file is replaced on export.\n\n${rows.map(task => `- [${task.status === 'done' ? 'x' : ' '}] ${escape(task.title)} · ${task.status}${task.priority ? ` · P${task.priority}` : ''}${taskLabels(task).map(label => ` · #${escape(label)}`).join('')}${task.dueAt ? ` · due ${task.dueAt}` : ''}\n  ID: ${task.id}${task.sourceKey ? ` · Source key: ${escape(task.sourceKey)}` : ''}${task.sourceUrl ? `\n  Source: ${task.sourceUrl}` : ''}${task.notes ? `\n  ${escape(task.notes)}` : ''}`).join('\n\n')}\n`,
  };
}
export class BrainBridge {
  private stopped = false;
  private running = false;
  get hasActiveWork() { return this.running; }
  constructor(private store: Store, private refresh: () => void) {
    store.db.exec('CREATE TABLE IF NOT EXISTS external_task_receipts(sourceKey TEXT PRIMARY KEY,taskId TEXT NOT NULL,importedAt TEXT NOT NULL)');
  }
  private config(): BrainBridgeConfig {
    const raw = this.store.getSetting('brainBridge');
    if (!raw) return defaultBrainBridgeConfig();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid saved bridge configuration.');
    const config = { ...defaultBrainBridgeConfig(), ...value } as BrainBridgeConfig;
    for (const key of ['importEnabled', 'exportEnabled', 'filingEnabled'] as const) if (typeof config[key] !== 'boolean') throw new Error('Invalid saved bridge switches.');
    for (const key of ['importDir', 'exportDir', 'filingDir'] as const) if (typeof config[key] !== 'string' || config[key].length > 4096) throw new Error('Invalid saved bridge folder.');
    return config;
  }
  state(): BrainBridgeState {
    try { return { ...this.config(), externalSetup: readProviderSetup(this.store.getSetting('providerSetup')).intake === 'external', paused: this.store.getSetting('setupAutomationPaused') === 'true', lastRunAt: this.store.getSetting('brainBridgeLastRun') || null, error: this.store.getSetting('brainBridgeError') || '', report: JSON.parse(this.store.getSetting('brainBridgeReport') || 'null') }; }
    catch (error) { return { ...defaultBrainBridgeConfig(), externalSetup: false, paused: true, lastRunAt: null, error: String(error), report: null }; }
  }
  configure(value: BrainBridgeConfig) {
    this.active();
    const next = defaultBrainBridgeConfig();
    const previous = this.config();
    const external = readProviderSetup(this.store.getSetting('providerSetup')).intake === 'external';
    for (const key of ['importEnabled', 'exportEnabled', 'filingEnabled'] as const) {
      if (typeof value?.[key] !== 'boolean') throw new Error('Choose whether each integration is enabled.');
      next[key] = value[key];
    }
    for (const key of ['importDir', 'exportDir', 'filingDir'] as const) {
      if (typeof value[key] !== 'string' || value[key].length > 4096) throw new Error('Choose valid folder paths.');
      const path = value[key].trim();
      const enabled = key === 'importDir' ? next.importEnabled && external : key === 'exportDir' ? next.exportEnabled && external : next.filingEnabled;
      if (!path) next[key] = '';
      else if (!enabled && path === previous[key]) next[key] = path;
      else next[key] = folder(path);
    }
    for (const [enabled, dir] of [[next.importEnabled, next.importDir], [next.exportEnabled, next.exportDir], [next.filingEnabled, next.filingDir]]) if (enabled && !dir) throw new Error('Choose a folder before enabling an integration.');
    if (next.importDir && [next.exportDir, next.filingDir].some(path => path && (inside(next.importDir, path) || inside(path, next.importDir)))) throw new Error('Keep task intake separate from export and brain filing folders.');
    if (readProviderSetup(this.store.getSetting('providerSetup')).intake !== 'external') {
      if ((next.importEnabled && (!previous.importEnabled || next.importDir !== previous.importDir)) || (next.exportEnabled && (!previous.exportEnabled || next.exportDir !== previous.exportDir))) throw new Error('Task import/export requires the Legolas setup. Brain filing is available in either setup.');
    }
    this.store.setSetting('brainBridge', JSON.stringify(next)); this.store.deleteSetting('brainBridgeError'); this.store.deleteSetting('brainBridgeLastRun'); this.store.deleteSetting('brainBridgeReport'); this.refresh(); return this.state();
  }
  private active() { if (this.stopped || !this.store.isOpen) throw new Error('The external workflow bridge is stopped.'); }
  run(): BrainBridgeState {
    this.active(); if (this.running) throw new Error('The workflow bridge is already running.');
    const config = this.config();
    if (this.state().paused) throw new Error('Finish setup before importing or exporting tasks.');
    if (readProviderSetup(this.store.getSetting('providerSetup')).intake !== 'external') throw new Error('Task import/export requires the Legolas setup.');
    this.running = true;
    const report: BrainBridgeReport = { created: 0, skipped: 0, rejected: 0, exported: false, deferred: 0 };
    const errors: string[] = [];
    try {
      if (config.importEnabled) {
        try { this.importInbox(folder(config.importDir, true), report, errors); } catch (error) { errors.push(`Import: ${String(error)}`); }
      }
      if (config.exportEnabled) {
        try {
          const root = folder(config.exportDir, true), output = taskExport(this.store.list('tasks'));
          const json = atomicWrite(root, 'aegir-tasks.json', output.json);
          const markdown = atomicWrite(root, 'aegir-tasks.md', output.markdown); report.exported = json || markdown;
        } catch (error) { errors.push(`Export: ${String(error)}`); }
      }
      this.store.setSetting('brainBridgeLastRun', new Date().toISOString());
      this.store.setSetting('brainBridgeReport', JSON.stringify(report));
      if (errors.length) this.store.setSetting('brainBridgeError', errors.slice(0, 5).join('\n')); else this.store.deleteSetting('brainBridgeError');
      this.refresh(); return this.state();
    } finally { this.running = false; }
  }
  private importInbox(root: string, report: BrainBridgeReport, errors: string[]) {
    const names = readdirSync(root).filter(name => /\.(json|md)$/i.test(name)).sort();
    report.deferred += Math.max(0, names.length - 50); let total = 0;
    for (const name of names.slice(0, 50)) {
      const path = join(root, name);
      let imported = false;
      let identity: { ino: number; dev: number; mtimeMs: number; size: number } | undefined;
      try {
        const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        let text: string;
        try {
          const stat = fstatSync(fd);
          if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) throw new Error('Use regular files up to 1 MB.');
          if (Date.now() - stat.mtimeMs < 2000 || total + stat.size > MAX_PASS_BYTES) { report.deferred++; continue; }
          total += stat.size;
          const bytes = Buffer.alloc(stat.size); let offset = 0;
          while (offset < bytes.length) { const count = readSync(fd, bytes, offset, bytes.length - offset, offset); if (!count) break; offset += count; }
          text = bytes.subarray(0, offset).toString('utf8'); identity = stat;
          const after = fstatSync(fd);
          if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) { report.deferred++; continue; }
        } finally { closeSync(fd); }
        const items = parseInboxFile(name, text);
        let created = 0, skipped = 0;
        this.store.db.transaction(() => {
          for (const item of items) {
            if (this.store.db.prepare('SELECT 1 FROM external_task_receipts WHERE sourceKey=?').get(item.sourceKey)) { skipped++; continue; }
            const existing = this.store.db.prepare('SELECT id FROM tasks WHERE sourceKey=?').get(item.sourceKey) as { id: string } | undefined;
            if (existing) {
              this.store.db.prepare('INSERT INTO external_task_receipts VALUES (?,?,?)').run(item.sourceKey, existing.id, new Date().toISOString()); skipped++; continue;
            }
            const task = this.store.createTask({ ...item, status: 'proposed' });
            this.store.db.prepare('INSERT INTO external_task_receipts VALUES (?,?,?)').run(item.sourceKey, task.id, new Date().toISOString()); created++;
          }
        })();
        report.created += created; report.skipped += skipped;
        imported = true; archive(root, path, 'processed', undefined, identity);
      } catch (error) {
        report.rejected++; errors.push(`${name}: ${String(error)}`);
        try {
          if (!imported && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink()) archive(root, path, 'rejected', String(error), identity);
        } catch (archiveError) { errors.push(`Could not archive ${name}: ${String(archiveError)}`); }
      }
    }
  }
  tick() {
    if (this.stopped || !this.store.isOpen || this.running) return;
    const state = this.state();
    if (state.paused || !state.externalSetup || (!state.importEnabled && !state.exportEnabled)) return;
    try { this.run(); } catch (error) { this.store.setSetting('brainBridgeError', String(error)); this.refresh(); }
  }
  file(source: string, displayName: string): string {
    this.active(); const config = this.config();
    if (!config.filingEnabled) throw new Error('Enable brain filing and choose its destination folder in Settings.');
    const root = folder(config.filingDir, true);
    const fd = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > 50 * 1024 * 1024) throw new Error('Choose a regular file up to 50 MB.');
      const safeName = basename(displayName.replace(/\\/g, '/')).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(-150) || 'file';
      const target = join(root, `${hash(source).slice(0, 12)}-${randomUUID().slice(0, 8)}-${safeName}`);
      // Exclusive create never overwrites a brain file. Read the already-open validated source.
      const bytes = Buffer.alloc(stat.size);
      let read = 0;
      while (read < bytes.length) { const count = readSync(fd, bytes, read, bytes.length - read, read); if (!count) throw new Error('The source file changed. Try filing it again.'); read += count; }
      const after = fstatSync(fd);
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('The source file changed. Try filing it again.');
      writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
      return target;
    } finally { closeSync(fd); }
  }
  stop() { this.stopped = true; }
}
