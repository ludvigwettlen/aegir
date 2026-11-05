import { describe, expect, it } from 'vitest';
import { normalizeTaskAttachment, normalizeTaskLink, taskLinkLabel } from './task-links.js';

describe('task links', () => {
  it('accepts web URLs', () => {
    expect(normalizeTaskLink(' https://example.com/path ')).toBe('https://example.com/path');
  });
  it('rejects executable, local-file, and malformed URLs', () => {
    for (const value of ['vscode://file/tmp/example', 'obsidian://open?vault=Work', 'x-github-client://openRepo/owner/name', 'unknown://action', 'https://user:secret@example.com', 'javascript:alert(1)', 'file:///etc/passwd', 'https://', 'some text', 'https://example.com/has space'])
      expect(normalizeTaskLink(value)).toBeNull();
  });
  it('attaches local paths with spaces, quotes, Unicode, and URL punctuation', () => {
    const path = '/Users/me/My files/Ägir #1? 100%.md';
    const expected = 'file:///Users/me/My%20files/%C3%84gir%20%231%3F%20100%25.md';
    expect(normalizeTaskAttachment(path)).toBe(expected);
    expect(normalizeTaskAttachment(`"${path}"`)).toBe(expected);
    expect(normalizeTaskAttachment(expected)).toBe(expected);
    expect(taskLinkLabel(expected)).toBe('Ägir #1? 100%.md');
    expect(normalizeTaskAttachment('~/Documents/My file.pdf', '/Users/me')).toBe('file:///Users/me/Documents/My%20file.pdf');
    expect(normalizeTaskAttachment('https://example.com')).toBe('https://example.com/');
  });
  it('rejects ambiguous paths, remote file hosts, and encoded control characters', () => {
    for (const value of ['relative/file.md', '//server/file.md', 'file://server/file.md', 'file:///tmp/%00file', 'file:///tmp/%0afile', 'file:///tmp/%zz', 'javascript:alert(1)', 'file:///tmp/file?query']) expect(normalizeTaskAttachment(value)).toBeNull();
  });
});
