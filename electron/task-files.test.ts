import yaml from 'js-yaml';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TaskFile } from '../shared/types.js';
import {
  chatFilesRoot, filePath, fileToBrain, folderBytes, hideAttachment, readSource, restoreAttachment,
  writeAttachment,
} from './task-files.js';

let dir = '';
let outputRoot = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aegir-files-'));
  outputRoot = join(dir, 'Legolas');
  mkdirSync(outputRoot, { recursive: true });
});
const source = (name: string, content: string | Buffer = 'A memo.\n') => {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
};
const row = (over: Partial<TaskFile> = {}): TaskFile => ({
  id: 'file-1234-abcd', taskId: 'task-1', threadId: 'thread-1', messageId: null, root: 'task',
  path: 'attachments/notes.md', name: 'notes.md', kind: 'text', mime: 'text/markdown', bytes: 8,
  sha256: 'hash', originalPath: '/elsewhere/notes.md', brainPath: null, brainFiledAt: null,
  createdAt: '2026-10-06T09:00:00.000Z', ...over,
});

describe('staging a dropped file', () => {
  it('copies it once into the task folder, named uniquely, with its hash', () => {
    const taskDir = join(outputRoot, 'board-pack-abc123');
    const first = readSource(source('Q3 pack.md', '# Q3\n'));
    expect(first).toMatchObject({ name: 'Q3 pack.md', kind: 'text', mime: 'text/markdown', bytes: 5 });
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(writeAttachment(taskDir, 'attachments', first)).toBe('attachments/Q3 pack.md');
    // A second file of the same name never overwrites the first.
    const second = readSource(source('Q3 pack.md', '# Q3 again\n'));
    expect(writeAttachment(taskDir, 'attachments', second)).toBe('attachments/Q3 pack (2).md');
    expect(readdirSync(join(taskDir, 'attachments')).sort()).toEqual(['Q3 pack (2).md', 'Q3 pack.md']);
    expect(readFileSync(join(taskDir, 'attachments', 'Q3 pack.md'), 'utf8')).toBe('# Q3\n');
    expect(folderBytes(join(taskDir, 'attachments'))).toBe(16);
  });

  it('leaves no temporary file behind', () => {
    const taskDir = join(outputRoot, 'task-1');
    writeAttachment(taskDir, 'attachments', readSource(source('notes.md')));
    expect(readdirSync(join(taskDir, 'attachments'))).toEqual(['notes.md']);
  });

  it('refuses folders, aliases, relative paths, missing files and anything over 50 MB', () => {
    mkdirSync(join(dir, 'folder'));
    symlinkSync(source('real.md'), join(dir, 'alias.md'));
    expect(() => readSource(join(dir, 'folder'))).toThrow(/not a folder or alias/);
    expect(() => readSource(join(dir, 'alias.md'))).toThrow(/not a folder or alias/);
    expect(() => readSource('attachments/notes.md')).toThrow(/Drop a file from Finder/);
    expect(() => readSource(join(dir, 'gone.md'))).toThrow(/no longer there/);
    expect(() => readSource(source('huge.bin', Buffer.alloc(50 * 1024 * 1024 + 1)))).toThrow(/the limit is 50 MB/);
  });

  it('keeps every attachment inside its own root', () => {
    expect(() => writeAttachment(outputRoot, '../escape', readSource(source('notes.md')))).toThrow(/outside its attachment folder/);
    expect(filePath(row(), outputRoot, () => join(outputRoot, 'task-1'))).toBe(join(outputRoot, 'task-1', 'attachments', 'notes.md'));
    expect(filePath(row({ root: 'chat', path: 'mgmt-ab12/slide.png' }), outputRoot, () => null))
      .toBe(join(chatFilesRoot(outputRoot), 'mgmt-ab12', 'slide.png'));
    // A task without a folder yet has nowhere to resolve to, so the run is given no path at all.
    expect(filePath(row(), outputRoot, () => null)).toBeNull();
    expect(() => filePath(row({ path: '../../secrets.md' }), outputRoot, () => join(outputRoot, 'task-1'))).toThrow(/outside/);
  });

  it('hides a removed attachment and puts it back on undo', () => {
    const taskDir = join(outputRoot, 'task-1');
    const file = row({ path: writeAttachment(taskDir, 'attachments', readSource(source('notes.md'))) });
    hideAttachment(taskDir, file);
    expect(existsSync(join(taskDir, 'attachments', 'notes.md'))).toBe(false);
    expect(readdirSync(join(taskDir, 'attachments', 'removed'))).toEqual(['file-123-notes.md']);
    restoreAttachment(taskDir, file);
    expect(readFileSync(join(taskDir, 'attachments', 'notes.md'), 'utf8')).toBe('A memo.\n');
    expect(readdirSync(join(taskDir, 'attachments', 'removed'))).toEqual([]);
  });
});

describe('filing an attachment in the brain', () => {
  const brain = () => { const path = join(dir, 'brain'); mkdirSync(join(path, 'sources'), { recursive: true }); return path; };

  it('tracks text at the top of sources/<slug>/ and keeps binaries in .raw/', () => {
    const brainDir = brain();
    const taskDir = join(outputRoot, 'task-1');
    const memo = row({ path: writeAttachment(taskDir, 'attachments', readSource(source('memo.md', '# Memo\n'))), name: 'memo.md', bytes: 7 });
    const pack = row({
      id: 'file-5678-efgh', name: 'pack.pdf', kind: 'pdf', bytes: 8,
      path: writeAttachment(taskDir, 'attachments', readSource(source('pack.pdf', '%PDF-1.7'))),
    });
    const memoPath = fileToBrain(brainDir, 'q3-close', memo, join(taskDir, memo.path), { taskTitle: 'Close Q3', taskId: 'task-1' });
    const packPath = fileToBrain(brainDir, 'q3-close', pack, join(taskDir, pack.path), { taskTitle: 'Close Q3', taskId: 'task-1' });
    expect(memoPath).toBe(join(brainDir, 'sources', 'q3-close', 'memo.md'));
    expect(packPath).toBe(join(brainDir, 'sources', 'q3-close', '.raw', 'pack.pdf'));
    expect(readFileSync(memoPath, 'utf8')).toBe('# Memo\n');
    expect(readFileSync(join(brainDir, '.gitignore'), 'utf8').trim()).toBe('sources/*/.raw/');
  });

  it('writes index.md with the hash and the todo it came from, then adds a section per later file', () => {
    const brainDir = brain();
    const taskDir = join(outputRoot, 'task-1');
    const file = row({ name: 'memo.md', path: writeAttachment(taskDir, 'attachments', readSource(source('memo.md'))), sha256: 'abc123' });
    fileToBrain(brainDir, 'q3-close', file, join(taskDir, file.path), { taskTitle: 'Close Q3', taskId: 'task-1' });
    const page = readFileSync(join(brainDir, 'sources', 'q3-close', 'index.md'), 'utf8');
    expect(page).toContain('sha256: abc123');
    expect(page).toContain('legolas_task: "Close Q3 (task-1)"');
    expect(page).toContain('original_path: "/elsewhere/notes.md"');
    expect(page).toContain('Raw file: `memo.md`');
    fileToBrain(brainDir, 'q3-close', row({ ...file, name: 'second.md' }), join(taskDir, file.path), { taskTitle: 'Close Q3', taskId: 'task-1' });
    expect(readFileSync(join(brainDir, 'sources', 'q3-close', 'index.md'), 'utf8')).toContain('## second.md');
  });

  it('keeps the front matter valid YAML when the task title has a colon', () => {
    const brainDir = brain();
    const taskDir = join(outputRoot, 'task-2');
    const file = row({ name: 'board: pack.md', path: writeAttachment(taskDir, 'attachments', readSource(source('memo.md'))) });
    fileToBrain(brainDir, 'board-pack', file, join(taskDir, file.path), { taskTitle: 'Legolas prd: allow me to attach files', taskId: 'task-2' });
    const page = readFileSync(join(brainDir, 'sources', 'board-pack', 'index.md'), 'utf8');
    const front = yaml.load(page.split('---')[1]) as Record<string, unknown>;
    expect(front).toMatchObject({ title: 'board: pack.md', legolas_task: 'Legolas prd: allow me to attach files (task-2)', type: 'source' });
  });

  it('refuses a slug that would file outside sources/, and a brain that is not there', () => {
    const brainDir = brain();
    const taskDir = join(outputRoot, 'task-1');
    const file = row({ path: writeAttachment(taskDir, 'attachments', readSource(source('memo.md'))) });
    const at = join(taskDir, file.path);
    for (const slug of ['../escape', '/etc', 'Caps', '', 'a'.repeat(70)])
      expect(() => fileToBrain(brainDir, slug, file, at, { taskTitle: null, taskId: null })).toThrow(/brain slug/);
    expect(() => fileToBrain(join(dir, 'no-brain'), 'q3-close', file, at, { taskTitle: null, taskId: null })).toThrow(/no brain folder/);
  });

  it('writes nothing into the brain while a file is only staged', () => {
    const brainDir = brain();
    const taskDir = join(outputRoot, 'task-1');
    writeAttachment(taskDir, 'attachments', readSource(source('memo.md')));
    expect(readdirSync(join(brainDir, 'sources'))).toEqual([]);
    expect(existsSync(join(brainDir, '.gitignore'))).toBe(false);
    expect(statSync(join(taskDir, 'attachments', 'memo.md')).isFile()).toBe(true);
  });
});
