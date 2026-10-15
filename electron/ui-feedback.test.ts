import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UiFeedbackStore } from './ui-feedback';
import { feedbackBrief } from '../shared/ui-feedback';

const dirs: string[] = [];
const fixture = () => { const dir = mkdtempSync(join(tmpdir(), 'aegir-feedback-')); dirs.push(dir); return new UiFeedbackStore(join(dir, 'ui-feedback.json')); };
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
const input = { text: 'Make this easier to find', target: { page: '{"view":"tasks","list":"today"}', selector: '#root > button', label: 'Today', tag: 'button', viewport: { width: 950, height: 620 }, bounds: { x: 10, y: 20, width: 100, height: 30 } } };
it('persists context across restarts, resolves and reopens without losing other comments', () => {
  const store = fixture(); expect(store.list().comments).toEqual([]);
  const first = store.add(input).comments[0];
  store.add({ ...input, text: 'Second comment' });
  const reopened = new UiFeedbackStore(store.path);
  expect(reopened.list().comments[0]).toEqual(first);
  reopened.resolve(first.id, true);
  expect(feedbackBrief(reopened.list())).not.toContain(input.text);
  expect(feedbackBrief(reopened.list())).toContain('Second comment');
  reopened.resolve(first.id, false);
  expect(reopened.list().comments).toHaveLength(2);
  expect(feedbackBrief(reopened.list())).toContain(input.text);
  expect(feedbackBrief(reopened.list())).toContain(input.target.selector);
});
it('rejects invalid input and corrupt files without overwriting saved feedback', () => {
  const store = fixture(); store.add(input);
  const before = readFileSync(store.path, 'utf8');
  expect(() => store.add({ ...input, text: '  ' })).toThrow();
  expect(() => store.add({ ...input, text: 'x'.repeat(5001) })).toThrow();
  expect(() => store.resolve('missing', true)).toThrow();
  expect(readFileSync(store.path, 'utf8')).toBe(before);
  writeFileSync(store.path, '{broken');
  expect(() => store.add(input)).toThrow();
  expect(readFileSync(store.path, 'utf8')).toBe('{broken');
});
it('picks up externally resolved comments before appending a new one', () => {
  const store = fixture(); store.add(input);
  const file = JSON.parse(readFileSync(store.path, 'utf8'));
  file.comments[0].resolvedAt = new Date().toISOString();
  writeFileSync(store.path, JSON.stringify(file));
  expect(store.add(input).comments[0].resolvedAt).toBe(file.comments[0].resolvedAt);
});
