import { describe, expect, it } from 'vitest';
import { localMarkdownPath, reviewMirror, reviewRequest, reviewTargets } from './review.js';

describe('review in browser', () => {
  it('asks for human-review on one file, edited in place, mirrored to the brain and polled within the command limit', () => {
    const text = reviewRequest({ path: 'connor-dm.md', mirror: '~/brain/drafts/2026-10-05-connor-dm.md' });
    expect(text).toContain("`connor-dm.md` from this task's folder in human-review");
    expect(text).toContain('`~/brain/drafts/2026-10-05-connor-dm.md`');
    expect(text).toContain('--timeout 540');
    expect(text).toContain('End review');
    expect(text).not.toContain('—');
  });
  it('commits a draft that already lives in the brain without mirroring it', () => {
    const text = reviewRequest({ path: '/Users/m/brain/drafts/memo.md', mirror: null });
    expect(text).toContain('Open `/Users/m/brain/drafts/memo.md` in human-review');
    expect(text).toContain('commit it after each batch');
    expect(text).not.toContain("task's folder");
  });
  it('dates the mirror by the task, once', () => {
    expect(reviewMirror('notes/connor-dm.md', '2026-10-05T19:45:04.588Z')).toBe('~/brain/drafts/2026-10-05-connor-dm.md');
    expect(reviewMirror('2026-09-30-memo.md', '2026-10-05T19:45:04.588Z')).toBe('~/brain/drafts/2026-09-30-memo.md');
    expect(reviewMirror('/Users/m/brain/drafts/memo.md', '2026-10-05T19:45:04.588Z')).toBeNull();
  });
  it('reads a local Markdown attachment and ignores web links and other files', () => {
    expect(localMarkdownPath('file:///Users/m/brain/drafts/My%20memo.md')).toBe('/Users/m/brain/drafts/My memo.md');
    expect(localMarkdownPath('file:///Users/m/deck.pdf')).toBeNull();
    expect(localMarkdownPath('https://example.com/notes.md')).toBeNull();
    expect(localMarkdownPath('not a url')).toBeNull();
  });
  it('lists folder files first, then an attached Markdown file', () => {
    expect(reviewTargets(['a.md', 'notes/b.markdown'], ['file:///tmp/c.md', 'https://x.com/y'], '2026-10-05T00:00:00Z').map(target => target.path))
      .toEqual(['a.md', 'notes/b.markdown', '/tmp/c.md']);
    expect(reviewTargets([], ['file:///tmp/c.pdf'], '2026-10-05T00:00:00Z')).toEqual([]);
  });
});
