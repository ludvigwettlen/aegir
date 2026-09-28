import { describe, expect, it } from 'vitest';
import { hasUnsupportedMarkdown, markdownPath, withDocumentReference } from './documents';
describe('document references', () => {
  it('protects embedded HTML, footnotes, and frontmatter while allowing fenced examples', () => {
    expect(hasUnsupportedMarkdown('---\ntitle: Example\n---\n\n# Hello')).toBe(true);
    expect(hasUnsupportedMarkdown('An <abbr>example</abbr>.')).toBe(true);
    expect(hasUnsupportedMarkdown('[^note]: A footnote')).toBe(true);
    expect(hasUnsupportedMarkdown('```html\n<div>Example</div>\n```')).toBe(false);
    expect(hasUnsupportedMarkdown('# Heading\n\n- **List** item')).toBe(false);
  });
  it('distinguishes local files from remote links and unsafe schemes', () => {
    expect(markdownPath('docs/My%20PRD.md#scope')).toBe('docs/My PRD.md');
    expect(markdownPath('file:///tmp/PRD.md')).toBe('/tmp/PRD.md');
    for (const value of ['https://example.com/prd.md', 'javascript:evil.md', 'file://server/prd.md', 'data:text/plain,doc.md', 'bad%zz.md']) expect(markdownPath(value)).toBeNull();
  });
  it('includes the file and quoted passage with the actual user message', () => {
    expect(withDocumentReference('Make this concrete', { path: 'prd.md', text: 'First\nSecond' })).toBe('Selected passage from prd.md:\n\n> First\n> Second\n\nMake this concrete');
    expect(withDocumentReference('Hello', null)).toBe('Hello');
  });
});
