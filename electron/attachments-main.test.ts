import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Store } from './db.js';
import type { Snapshot, StagedAttachment, Task, TaskFile } from '../shared/types.js';

// Boots main.ts against a mocked Electron and drives the attachment IPC the way the renderer does, so the
// whole path is covered: a dropped file reaches the task folder, the task, the brain and the export.
const fixture = vi.hoisted(() => ({
  root: '',
  app: null as unknown as EventEmitter,
  store: null as unknown as Store,
  handlers: new Map<string, (...args: any[]) => unknown>(),
  opened: [] as string[],
  revealed: [] as string[],
  started: vi.fn(),
}));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  const { mkdtempSync, mkdirSync: makeDir } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: path } = await import('node:path');
  fixture.root = mkdtempSync(path(tmpdir(), 'aegir-attachments-'));
  // A brain of its own, never the developer's: filing and the export write here.
  process.env.AEGIR_BRAIN_DIR = path(fixture.root, 'brain');
  makeDir(path(fixture.root, 'brain', 'sources'), { recursive: true });
  makeDir(path(fixture.root, 'brain', 'queues'), { recursive: true });
  fixture.app = Object.assign(new EventEmitter(), {
    getPath: () => fixture.root,
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    getLoginItemSettings: () => ({}),
    setBadgeCount: () => true,
  });
  class BrowserWindow extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), { send: () => {}, isDestroyed: () => false, setWindowOpenHandler: () => {} });
    isDestroyed() { return false; }
    async loadFile() {}
    async loadURL() {}
  }
  class Tray extends EventEmitter { setToolTip() {} setContextMenu() {} }
  class Notification extends EventEmitter { static isSupported() { return false; } show() {} }
  return {
    app: fixture.app, BrowserWindow, Tray, Notification,
    ipcMain: { handle: (channel: string, handler: (...args: any[]) => unknown) => fixture.handlers.set(channel, handler) },
    powerMonitor: new EventEmitter(),
    Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
    nativeImage: { createFromDataURL: () => ({}) },
    clipboard: { read: async () => [], readText: async () => '' },
    dialog: {},
    shell: {
      openPath: async (path: string) => { fixture.opened.push(path); return ''; },
      showItemInFolder: (path: string) => { fixture.revealed.push(path); },
    },
  };
});
vi.mock('./engine.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./engine.js')>()), findClaudeBinary: () => null }));
vi.mock('./gbrain-memory.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./gbrain-memory.js')>()), findGbrainBinary: () => null }));
vi.mock('./codex.js', async () => {
  const { EventEmitter } = await import('node:events');
  return { CodexProvider: class extends EventEmitter {
    setToolHandler() {}
    async start() { fixture.started(); }
    close() {}
  } };
});
vi.mock('./connectors.js', async () => {
  const { EventEmitter } = await import('node:events');
  return { ConnectorManager: class extends EventEmitter {
    states = {};
    composioConfigured() { return false; }
    slackConfigured() { return false; }
    start() {}
    close() {}
  } };
});
// The runtime is not under test here; its constructor hands over the store the IPC works on.
vi.mock('./runtime.js', () => ({ Runtime: class {
  constructor(store: Store) { fixture.store = store; }
  skills = { proposals: () => [], library: () => ({}) };
  start() {}
  stop() {}
} }));
vi.mock('./memory.js', () => ({ MemoryService: class { async migrateLegacy() {} } }));

const call = <T>(channel: string, ...args: unknown[]) => fixture.handlers.get(channel)!({}, ...args) as Promise<T>;
const snapshot = () => call<Snapshot>('snapshot');
let dropped = '';
let brainDir = '';
let outputRoot = '';

beforeAll(async () => {
  await import('./main.js');
  await vi.waitFor(() => expect(fixture.started).toHaveBeenCalled());
  brainDir = join(fixture.root, 'brain');
  outputRoot = join(fixture.root, 'Legolas');
  dropped = join(fixture.root, 'Downloads');
  mkdirSync(dropped, { recursive: true });
});
afterAll(() => {
  fixture.app.emit('before-quit');
  rmSync(fixture.root, { recursive: true, force: true });
});

const drop = (name: string, content = '# A memo\n') => { const path = join(dropped, name); writeFileSync(path, content); return path; };
const taskThread = (title: string) => {
  const task = fixture.store.createTask({ title });
  const thread = fixture.store.createThread(fixture.store.groups()[0].id, title, 'task', task.id);
  fixture.store.updateTask(task.id, { threadId: thread.id });
  return { task, thread };
};

it('copies a dropped file into the task folder, puts it on the task, and lists it in the export', async () => {
  const { task, thread } = taskThread('Read the Q3 board pack');
  const staged = await call<StagedAttachment[]>('stage-files', thread.id, [drop('Q3 pack.md'), drop('Q3 pack.md')]);
  // The task folder is made on the first drop, even before the task is handed off.
  const dir = (await snapshot()).tasks.find(item => item.id === task.id)!.outputDir!;
  expect(dir.startsWith(outputRoot)).toBe(true);
  expect(staged.map(item => item.error)).toEqual([null, null]);
  // The same bytes dropped twice point at the one copy.
  expect(staged[0].file!.id).toBe(staged[1].file!.id);
  expect(readdirSync(join(dir, 'attachments'))).toEqual(['Q3 pack.md']);
  expect(staged[0].file).toMatchObject({ taskId: task.id, root: 'task', path: 'attachments/Q3 pack.md', kind: 'text', bytes: 9 });
  expect((await snapshot()).taskFiles.map(file => file.id)).toEqual([staged[0].file!.id]);

  await call('reveal-task-file', staged[0].file!.id);
  await call('open-task-file', staged[0].file!.id);
  expect(fixture.revealed.at(-1)).toBe(join(dir, 'attachments', 'Q3 pack.md'));
  expect(fixture.opened.at(-1)).toBe(join(dir, 'attachments', 'Q3 pack.md'));

  // The brain copy of the task list carries the attachment, with the path a skill can read. The export is
  // written a couple of seconds after the change, so wait for it rather than quitting the app.
  const exportPath = join(brainDir, 'queues', 'legolas-tasks.json');
  await vi.waitFor(() => expect(existsSync(exportPath)).toBe(true), { timeout: 6000, interval: 100 });
  const exported = JSON.parse(readFileSync(exportPath, 'utf8')) as (Task & { files?: unknown[] })[];
  expect(exported.find(item => item.id === task.id)?.files).toEqual([
    { name: 'Q3 pack.md', path: join(dir, 'attachments', 'Q3 pack.md'), bytes: 9, brainPath: null },
  ]);
}, 20_000);

it('refuses a folder, an alias and more than ten files in one message, and copies the rest', async () => {
  const { thread } = taskThread('Reshape the CSV');
  mkdirSync(join(dropped, 'folder'), { recursive: true });
  if (!existsSync(join(dropped, 'alias.md'))) symlinkSync(drop('real.md'), join(dropped, 'alias.md'));
  const paths = [drop('rows.csv', 'a,b\n'), join(dropped, 'folder'), join(dropped, 'alias.md'), join(dropped, 'gone.md')];
  const staged = await call<StagedAttachment[]>('stage-files', thread.id, paths);
  expect(staged.map(item => item.name)).toEqual(['rows.csv', 'folder', 'alias.md', 'gone.md']);
  expect(staged[0].error).toBeNull();
  expect(staged[1].error).toMatch(/not a folder or alias/);
  expect(staged[2].error).toMatch(/not a folder or alias/);
  expect(staged[3].error).toMatch(/no longer there/);
  const over = await call<StagedAttachment[]>('stage-files', thread.id, Array.from({ length: 12 }, (_, index) => drop(`file-${index}.md`)));
  expect(over.slice(0, 10).every(item => !item.error)).toBe(true);
  expect(over.slice(10).map(item => item.error)).toEqual([
    'Attach at most 10 files to one message', 'Attach at most 10 files to one message',
  ]);
});

it('copies a chat file into a task folder when it is attached to a todo, and both rows agree', async () => {
  const chat = fixture.store.createThread(fixture.store.groups()[0].id, 'Mgmt');
  const [staged] = await call<StagedAttachment[]>('stage-files', chat.id, [drop('slide notes.md', 'one slide\n')]);
  expect(staged.file).toMatchObject({ root: 'chat', taskId: null, path: `mgmt-${chat.id.slice(0, 6)}/slide notes.md` });
  expect(existsSync(join(outputRoot, 'Chat files', `mgmt-${chat.id.slice(0, 6)}`, 'slide notes.md'))).toBe(true);
  const { task } = taskThread('Fix the slide');
  const copy = await call<TaskFile>('attach-file-to-task', staged.file!.id, task.id);
  const dir = (await snapshot()).tasks.find(item => item.id === task.id)!.outputDir!;
  expect(copy).toMatchObject({ taskId: task.id, root: 'task', path: 'attachments/slide notes.md', sha256: staged.file!.sha256 });
  expect(readFileSync(join(dir, 'attachments', 'slide notes.md'), 'utf8')).toBe('one slide\n');
  // The chat keeps its own copy, so the conversation's history still has the file.
  expect(fixture.store.taskFile(staged.file!.id)).toMatchObject({ root: 'chat', taskId: null });
});

it('files an attachment in the brain on request, and nothing before it', async () => {
  const { task, thread } = taskThread('Close Q3');
  const [memo] = await call<StagedAttachment[]>('stage-files', thread.id, [drop('Q3 memo.md', '# Q3\n')]);
  const [pack] = await call<StagedAttachment[]>('stage-files', thread.id, [drop('Q3 pack.pdf', '%PDF-1.7 pack')]);
  expect(readdirSync(join(brainDir, 'sources'))).toEqual([]);
  const filedMemo = await call<TaskFile>('file-to-brain', memo.file!.id, 'q3-close');
  const filedPack = await call<TaskFile>('file-to-brain', pack.file!.id, 'q3-close');
  expect(filedMemo.brainPath).toBe(join(brainDir, 'sources', 'q3-close', 'Q3 memo.md'));
  expect(filedPack.brainPath).toBe(join(brainDir, 'sources', 'q3-close', '.raw', 'Q3 pack.pdf'));
  expect(filedPack.brainFiledAt).toBeTruthy();
  const page = readFileSync(join(brainDir, 'sources', 'q3-close', 'index.md'), 'utf8');
  expect(page).toContain(`legolas_task: "Close Q3 (${task.id})"`);
  expect(page).toContain(`sha256: ${memo.file!.sha256}`);
  expect(readFileSync(join(brainDir, '.gitignore'), 'utf8')).toContain('sources/*/.raw/');
  // The staged copy stays until the task ages out; the brain copy is the one that opens.
  const dir = fixture.store.get('tasks', task.id)!.outputDir!;
  expect(existsSync(join(dir, 'attachments', 'Q3 memo.md'))).toBe(true);
  await call('open-task-file', memo.file!.id);
  expect(fixture.opened.at(-1)).toBe(filedMemo.brainPath);
  await expect(call('file-to-brain', memo.file!.id, '../escape')).rejects.toThrow(/brain slug/);
});

it('removes an attachment without losing the bytes, and undo brings both back', async () => {
  const { task, thread } = taskThread('Look at the slide');
  const [staged] = await call<StagedAttachment[]>('stage-files', thread.id, [drop('slide.md', 'a slide\n')]);
  const dir = fixture.store.get('tasks', task.id)!.outputDir!;
  await call('remove-task-file', staged.file!.id);
  expect(existsSync(join(dir, 'attachments', 'slide.md'))).toBe(false);
  expect(readdirSync(join(dir, 'attachments', 'removed')).length).toBe(1);
  expect((await snapshot()).taskFiles.some(file => file.id === staged.file!.id)).toBe(false);
  expect(await call('undo-task-action')).toEqual({ taskId: task.id, action: 'attachment removal' });
  expect(readFileSync(join(dir, 'attachments', 'slide.md'), 'utf8')).toBe('a slide\n');
  expect((await snapshot()).taskFiles.some(file => file.id === staged.file!.id)).toBe(true);
  await expect(call('open-task-file', 'no-such-file')).rejects.toThrow(/no longer exists/);
});
