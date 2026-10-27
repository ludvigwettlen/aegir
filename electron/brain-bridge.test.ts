import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from './db.js';
import { BrainBridge, parseInboxFile, parseInboxItem } from './brain-bridge.js';
import { defaultBrainBridgeConfig } from '../shared/brain-bridge.js';
import { providerSetup } from '../shared/provider-setup.js';
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach(fn => fn()));
const suggestion = { title: 'Reply to Sarah', notes: 'She needs a decision.', sourceKey: 'slack:T123:C123:123.456', sourceUrl: 'https://example.com/request', label: 'work', dueAt: '2026-10-22' };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'brain-bridge-')), store = new Store(join(root, 'db'));
  const input = join(root, 'input'), output = join(root, 'output'), filing = join(root, 'filing');
  for (const dir of [input, output, filing]) mkdirSync(dir);
  store.setSetting('providerSetup', JSON.stringify(providerSetup({ preset: 'legolas', brainDir: root, brainId: 'host', sourceId: 'default' })));
  const bridge = new BrainBridge(store, () => {});
  const config = { importEnabled: true, importDir: input, exportEnabled: true, exportDir: output, filingEnabled: true, filingDir: filing };
  const write = (name: string, content: unknown, old = true) => {
    const path = join(input, name); writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
    if (old) utimesSync(path, new Date(Date.now() - 5000), new Date(Date.now() - 5000)); return path;
  };
  cleanup.push(() => { bridge.stop(); store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, store, input, output, filing, bridge, config, write };
}
it('defaults off, does not infer folders and keeps all background work paused during setup', () => {
  const f = fixture(); f.write('suggestion.json', suggestion);
  f.bridge.tick(); expect(f.store.list('tasks')).toHaveLength(0); expect(readdirSync(f.output)).toEqual([]);
  f.bridge.configure(f.config); f.store.setSetting('setupAutomationPaused', 'true'); f.bridge.tick();
  expect(() => f.bridge.run()).toThrow('Finish setup'); expect(f.store.list('tasks')).toHaveLength(0);
  f.store.deleteSetting('setupAutomationPaused'); f.bridge.tick(); expect(f.store.list('tasks')).toHaveLength(1);
});
it('imports stable source identity once, preserving edits/priorities and completion/dismissal/deletion across restarts', () => {
  const f = fixture(); f.bridge.configure(f.config); f.write('one.json', suggestion);
  expect(f.bridge.run().report).toMatchObject({ created: 1, rejected: 0 });
  const task = f.store.list('tasks')[0]; expect(task).toMatchObject({ status: 'proposed', sourceKey: suggestion.sourceKey, sourceUrl: suggestion.sourceUrl });
  f.store.updateTask(task.id, { title: 'My wording', priority: 1, status: 'done' });
  f.write('again.json', suggestion); expect(f.bridge.run().report?.skipped).toBe(1);
  expect(f.store.get('tasks', task.id)).toMatchObject({ title: 'My wording', priority: 1, status: 'done' });
  f.store.updateTask(task.id, { status: 'dismissed' }); f.write('dismissed.json', suggestion); expect(f.bridge.run().report?.skipped).toBe(1);
  f.store.db.prepare('DELETE FROM tasks WHERE id=?').run(task.id);
  const reopened = new BrainBridge(f.store, () => {}); f.write('deleted.json', suggestion);
  expect(reopened.run().report?.skipped).toBe(1); expect(f.store.list('tasks')).toHaveLength(0); reopened.stop();
});
it('recognizes pre-existing sources without overwriting them and remembers them after deletion', () => {
  const f = fixture(); f.bridge.configure(f.config);
  const existing = f.store.createTask({ ...suggestion, status: 'ready' }); f.store.updateTask(existing.id, { priority: 2 });
  f.write('existing.json', { ...suggestion, title: 'External new wording' }); expect(f.bridge.run().report?.skipped).toBe(1);
  expect(f.store.get('tasks', existing.id)).toMatchObject({ title: suggestion.title, priority: 2 });
  f.store.db.prepare('DELETE FROM tasks WHERE id=?').run(existing.id); f.write('retry.json', suggestion); expect(f.bridge.run().report?.skipped).toBe(1);
});
it('validates each entire file before mutations, rejects bad dates/unsupported priorities and preserves young files', () => {
  const f = fixture(); f.bridge.configure(f.config);
  f.write('invalid.json', [suggestion, { ...suggestion, sourceKey: 'bad', dueAt: '2026-02-30' }]);
  f.write('priority.json', { ...suggestion, priority: 1 }); f.write('young.json', { ...suggestion, sourceKey: 'young' }, false);
  const state = f.bridge.run(); expect(state.report).toMatchObject({ created: 0, rejected: 2, deferred: 1 });
  expect(f.store.list('tasks')).toHaveLength(0); expect(readdirSync(f.input)).toContain('young.json');
  expect(readdirSync(join(f.input, 'rejected')).filter(name => name.endsWith('.error.txt'))).toHaveLength(2);
});
it('supports Markdown front matter and atomic readable exports, including completed/dismissed status and workspace results', () => {
  const f = fixture(); f.bridge.configure(f.config);
  f.write('suggestion.md', '---\ntitle: Review output\nsourceKey: routine:review:1\ndueAt: "2026-10-22"\n---\nRead the generated document.');
  expect(f.bridge.run().report).toMatchObject({ created: 1, exported: true });
  const task = f.store.list('tasks')[0]; f.store.updateTask(task.id, { status: 'done', outputDir: '/workspace/result' });
  f.bridge.run(); const json = JSON.parse(readFileSync(join(f.output, 'aegir-tasks.json'), 'utf8'));
  expect(json).toMatchObject({ version: 1, tasks: [{ sourceKey: 'routine:review:1', status: 'done', outputDir: '/workspace/result' }] });
  expect(readFileSync(join(f.output, 'aegir-tasks.md'), 'utf8')).toContain('[x] Review output');
  expect(f.bridge.run().report?.exported).toBe(false);
});
it('requires Legolas for task bridging but preserves configuration and permits explicit filing in Aegir', () => {
  const f = fixture(); f.bridge.configure(f.config); f.store.setSetting('providerSetup', JSON.stringify(providerSetup({ preset: 'aegir', brainDir: '', brainId: 'host', sourceId: 'default' })));
  f.write('pending.json', suggestion); f.bridge.tick(); expect(f.store.list('tasks')).toHaveLength(0);
  expect(() => f.bridge.run()).toThrow('Legolas'); expect(f.bridge.state().importEnabled).toBe(true);
  const source = join(f.root, 'document.md'); writeFileSync(source, '# Kept original');
  const copy = f.bridge.file(source, 'document.md'); expect(readFileSync(copy, 'utf8')).toBe('# Kept original'); expect(readFileSync(source, 'utf8')).toBe('# Kept original');
  const second = f.bridge.file(source, 'document.md'); expect(second).not.toBe(copy);
});
it('rejects symlink inputs, swapped roots, export symlinks and overlapping folder configurations', () => {
  const f = fixture();
  expect(() => f.bridge.configure({ ...f.config, exportDir: f.input })).toThrow('separate');
  f.bridge.configure(f.config);
  const outside = join(f.root, 'outside.json'); writeFileSync(outside, JSON.stringify(suggestion));
  symlinkSync(outside, join(f.input, 'link.json'));
  symlinkSync(outside, join(f.output, 'aegir-tasks.json'));
  expect(f.bridge.run().report?.rejected).toBe(1);
  expect(f.bridge.state().error).toContain('regular file'); expect(readFileSync(outside, 'utf8')).toBe(JSON.stringify(suggestion));
  rmSync(f.input, { recursive: true }); symlinkSync(f.output, f.input);
  f.bridge.run(); expect(f.bridge.state().error).toContain('configured folder changed');
});
it('requires filing opt-in and never follows a symlink source', () => {
  const f = fixture(); const source = join(f.root, 'source.txt'); writeFileSync(source, 'Original');
  expect(() => f.bridge.file(source, 'source.txt')).toThrow('Enable brain filing');
  f.bridge.configure({ ...defaultBrainBridgeConfig(), filingEnabled: true, filingDir: f.filing });
  const link = join(f.root, 'linked.txt'); symlinkSync(source, link); expect(() => f.bridge.file(link, 'source.txt')).toThrow();
});
it('rejects invalid identities, unsafe links and duplicate YAML fields', () => {
  for (const patch of [{ sourceKey: '' }, { sourceKey: '../bad key' }, { sourceUrl: 'file:///private/secrets' }, { dueAt: '2026-02-30' }, { status: 'done' }]) expect(() => parseInboxItem({ ...suggestion, ...patch })).toThrow();
  expect(() => parseInboxFile('a.md', '---\ntitle: First\ntitle: Second\nsourceKey: x\n---\nBody')).toThrow();
});

it('allows turning off a missing import folder and keeps paused choices when saving filing in Aegir', () => {
  const f = fixture(); const initial = f.bridge.configure(f.config); rmSync(f.input, { recursive: true });
  const disabled = f.bridge.configure({ ...initial, importEnabled: false });
  expect(disabled.importEnabled).toBe(false);
  f.store.setSetting('providerSetup', JSON.stringify(providerSetup({ preset: 'aegir', brainDir: '', brainId: 'host', sourceId: 'default' })));
  const saved = f.bridge.configure({ ...disabled, filingEnabled: false });
  expect(saved).toMatchObject({ exportEnabled: true, filingEnabled: false, externalSetup: false });
});
it('imports all labels and includes them in exports while preserving the legacy label', () => {
  const f = fixture(); f.bridge.configure(f.config); f.write('labels.json', { ...suggestion, labels: ['work','board'] });
  expect(f.bridge.run().report?.created).toBe(1);
  expect(f.store.list('tasks')[0]).toMatchObject({ label: 'work', labels: ['work','board'] });
  const exported = readdirSync(f.output).find(name => name.endsWith('.json'))!;
  expect(readFileSync(join(f.output, exported), 'utf8')).toContain('board');
});
