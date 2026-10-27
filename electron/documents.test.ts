import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDocument, documentLocation, listDocuments, readDocument, saveDocument } from './documents';

const dirs: string[] = [];
const directory = () => { const path = mkdtempSync(join(tmpdir(), 'aegir-documents-')); dirs.push(path); return path; };
afterEach(() => dirs.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

describe('workspace documents', () => {
  it('creates empty Markdown files, adds the extension and opens them for editing', () => {
    const root = directory();
    const file = createDocument(root, '  Meeting notes  ');
    expect(file).toEqual(readDocument(root, 'Meeting notes.md'));
    expect(file.content).toBe('');
    expect(readFileSync(join(root, file.path), 'utf8')).toBe('');
    expect(saveDocument(root, file.path, file.revision, '# My notes').content).toBe('# My notes');
    expect(createDocument(root, 'Plan.MD').path).toBe('Plan.MD');
    expect(createDocument(root, 'Draft.markdown').path).toBe('Draft.markdown');
  });
  it('rejects duplicate names, paths and symlinks without changing existing content', () => {
    const root = directory(), outside = directory();
    writeFileSync(join(root, 'notes.md'), 'Keep this');
    writeFileSync(join(outside, 'private.md'), 'Private');
    symlinkSync(join(outside, 'private.md'), join(root, 'linked.md'));
    symlinkSync(join(outside, 'missing.md'), join(root, 'dangling.md'));
    mkdirSync(join(root, 'folder.md'));
    for (const name of ['notes.md', 'linked.md', 'dangling.md', 'folder.md'])
      expect(() => createDocument(root, name)).toThrow('already exists');
    for (const name of ['', ' ', '../escape.md', '/tmp/escape.md', 'nested/file.md', 'nested\\file.md', '.hidden.md', 'bad\0.md', 'line\nbreak.md', 'x'.repeat(241), null as unknown as string])
      expect(() => createDocument(root, name)).toThrow();
    expect(readFileSync(join(root, 'notes.md'), 'utf8')).toBe('Keep this');
    expect(readFileSync(join(outside, 'private.md'), 'utf8')).toBe('Private');
  });
  it('lists nested Markdown and saves edits without changing other files', () => {
    const root = directory(); mkdirSync(join(root, 'docs')); writeFileSync(join(root, 'docs/prd.md'), '# Vision\n'); writeFileSync(join(root, 'data.txt'), 'keep');
    expect(listDocuments(root)).toEqual([{ path: 'docs/prd.md', modifiedAt: expect.any(String) }]);
    expect(documentLocation(root, 'docs/prd.md')).toBe(realpathSync(join(root, 'docs/prd.md')));
    expect(() => documentLocation(root, 'missing.md')).toThrow();
    mkdirSync(join(root, 'directory.md'));
    expect(() => documentLocation(root, 'directory.md')).toThrow('Choose a Markdown file');
    const original = readDocument(root, 'docs/prd.md');
    const saved = saveDocument(root, original.path, original.revision, '# A clearer vision\n');
    expect(readDocument(root, 'docs/prd.md')).toEqual(saved);
    expect(saved.revision).not.toBe(original.revision);
    expect(readFileSync(join(root, 'data.txt'), 'utf8')).toBe('keep');
  });
  it('orders documents by modification time, with paths breaking ties', () => {
    const root = directory();
    for (const name of ['a.md', 'b.md', 'c.md', 'd.md']) {
      writeFileSync(join(root, name), name);
      const date = new Date(name === 'd.md' ? '2026-10-13T10:00:00Z' : '2026-10-12T10:00:00Z');
      utimesSync(join(root, name), date, date);
    }
    const files = listDocuments(root);
    expect(files.map(file => file.path)).toEqual(['d.md', 'a.md', 'b.md', 'c.md']);
    expect(files[0].modifiedAt).toBe('2026-10-13T10:00:00.000Z');
  });
  it('rejects stale saves after an agent writes to the file', () => {
    const root = directory(); writeFileSync(join(root, 'prd.md'), 'original');
    const original = readDocument(root, 'prd.md'); writeFileSync(join(root, 'prd.md'), 'agent edits');
    expect(() => saveDocument(root, 'prd.md', original.revision, 'user edits')).toThrow('changed on disk');
    expect(readFileSync(join(root, 'prd.md'), 'utf8')).toBe('agent edits');
  });
  it('blocks traversal, absolute external paths, and symlink escapes for reading and writing', () => {
    const root = directory(), outside = directory(); writeFileSync(join(outside, 'secret.md'), 'private');
    symlinkSync(outside, join(root, 'linked')); symlinkSync(join(outside, 'secret.md'), join(root, 'linked.md'));
    for (const path of [join(outside, 'secret.md'), '../secret.md', 'linked/secret.md', 'linked.md']) {
      expect(() => readDocument(root, path)).toThrow();
      expect(() => saveDocument(root, path, 'any', 'changed')).toThrow();
      expect(() => documentLocation(root, path)).toThrow();
    }
    expect(listDocuments(root)).toEqual([]);
    expect(readFileSync(join(outside, 'secret.md'), 'utf8')).toBe('private');
  });
  it('rejects oversized files and non-UTF8 content', () => {
    const root = directory(); writeFileSync(join(root, 'large.md'), Buffer.alloc(2 * 1024 * 1024 + 1));
    writeFileSync(join(root, 'binary.md'), Buffer.from([0xff, 0xfe]));
    expect(() => readDocument(root, 'large.md')).toThrow('2 MB');
    expect(() => readDocument(root, 'binary.md')).toThrow();
  });
});
