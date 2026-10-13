import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { importDocumentImage, readDocumentImage } from './document-images';
import { documentImageLimit } from '../shared/document-images';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const dirs: string[] = [];
const directory = () => { const path = mkdtempSync(join(tmpdir(), 'aegir-images-')); dirs.push(path); return path; };
afterEach(() => dirs.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

it('copies images beside nested Markdown files and reads their relative links', () => {
  const root = directory(); mkdirSync(join(root, 'docs')); writeFileSync(join(root, 'docs/My plan.md'), '# Plan');
  const src = importDocumentImage(root, 'docs/My plan.md', '../Diagram (draft).png', png);
  expect(src).toMatch(/^My%20plan.assets\/Diagram-draft-[\w-]+\.png$/);
  const source = readDocumentImage(root, 'docs/My plan.md', src);
  expect(source).toBe(`data:image/png;base64,${png.toString('base64')}`);
  expect(readFileSync(join(root, 'docs', decodeURIComponent(src)))).toEqual(png);
  expect(readFileSync(join(root, 'docs/My plan.md'), 'utf8')).toBe('# Plan');
  expect(importDocumentImage(root, 'docs/My plan.md', 'Diagram (draft).png', png)).not.toBe(src);
  expect(readdirSync(join(root, 'docs/My plan.assets'))).toHaveLength(2);
});

it('resolves existing images relative to the document and blocks workspace escapes', () => {
  const root = directory(), outside = directory();
  mkdirSync(join(root, 'docs')); writeFileSync(join(root, 'docs/plan.md'), '# Plan');
  writeFileSync(join(root, 'my image.png'), png); writeFileSync(join(outside, 'secret.png'), png);
  expect(readDocumentImage(root, 'docs/plan.md', '../my%20image.png')).toContain('data:image/png');
  expect(readDocumentImage(root, 'docs/plan.md', pathToFileURL(realpathSync(join(root, 'my image.png'))).href)).toContain('data:image/png');
  symlinkSync(outside, join(root, 'linked')); symlinkSync(join(outside, 'secret.png'), join(root, 'linked.png'));
  for (const src of [join(outside, 'secret.png'), pathToFileURL(join(outside, 'secret.png')).href, '../../outside.png', '../linked/secret.png', '../linked.png', '%2e%2e/%2e%2e/outside.png', 'https://example.com/image.png']) {
    expect(() => readDocumentImage(root, 'docs/plan.md', src)).toThrow();
  }
  symlinkSync(outside, join(root, 'docs/plan.assets'));
  expect(() => importDocumentImage(root, 'docs/plan.md', 'image.png', png)).toThrow('Symbolic');
  expect(readdirSync(outside)).toEqual(['secret.png']);
});

it('checks image bytes and size rather than trusting extensions or MIME claims', () => {
  const root = directory(); writeFileSync(join(root, 'plan.md'), '# Plan');
  writeFileSync(join(root, 'fake.png'), '<script>not an image</script>');
  expect(() => readDocumentImage(root, 'plan.md', 'fake.png')).toThrow('PNG');
  expect(() => importDocumentImage(root, 'plan.md', 'fake.png', Buffer.from('not an image'))).toThrow('PNG');
  expect(() => importDocumentImage(root, 'plan.md', 'empty.png', new Uint8Array())).toThrow('10 MB');
  expect(() => importDocumentImage(root, 'plan.md', 'large.png', Buffer.alloc(documentImageLimit + 1))).toThrow('10 MB');
  expect(() => readDocumentImage(root, 'missing.md', 'fake.png')).toThrow();
});
