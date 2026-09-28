import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listDocuments, readDocument, saveDocument } from './documents';

const dirs: string[] = [];
const directory = () => { const path = mkdtempSync(join(tmpdir(), 'aegir-documents-')); dirs.push(path); return path; };
afterEach(() => dirs.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

describe('workspace documents', () => {
  it('lists nested Markdown and saves edits without changing other files', () => {
    const root = directory(); mkdirSync(join(root, 'docs')); writeFileSync(join(root, 'docs/prd.md'), '# Vision\n'); writeFileSync(join(root, 'data.txt'), 'keep');
    expect(listDocuments(root)).toEqual(['docs/prd.md']);
    const original = readDocument(root, 'docs/prd.md');
    const saved = saveDocument(root, original.path, original.revision, '# A clearer vision\n');
    expect(readDocument(root, 'docs/prd.md')).toEqual(saved);
    expect(saved.revision).not.toBe(original.revision);
    expect(readFileSync(join(root, 'data.txt'), 'utf8')).toBe('keep');
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
