import { describe, expect, it } from 'vitest';
import { normalizeTaskLink } from './task-links.js';

describe('task links', () => {
  it('accepts web URLs and supported app deep links', () => {
    expect(normalizeTaskLink(' https://example.com/path ')).toBe('https://example.com/path');
    expect(normalizeTaskLink('obsidian://open?vault=Work&file=Report')).toBe('obsidian://open?vault=Work&file=Report');
    expect(normalizeTaskLink('x-github-client://openRepo/owner/name')).toBe('x-github-client://openRepo/owner/name');
  });
  it('rejects executable, local-file, and malformed URLs', () => {
    for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'https://', 'some text', 'https://example.com/has space'])
      expect(normalizeTaskLink(value)).toBeNull();
  });
});
