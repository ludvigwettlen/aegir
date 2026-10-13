import { expect, it } from 'vitest';
import { imageMarkdown, imageSourceKind } from './document-images';
import { hasUnsupportedMarkdown } from './documents';

it('writes portable Markdown for filenames, descriptions and titles with punctuation', () => {
  const source = imageMarkdown('plan.assets/my diagram(1).png', 'An [example]', 'A "title"');
  expect(source).toBe('![An \\[example\\]](plan.assets/my%20diagram%281%29.png "A \\"title\\"")');
  expect(hasUnsupportedMarkdown(source)).toBe(false);
});
it('limits display sources to local files and HTTP images', () => {
  expect(imageSourceKind('https://example.com/a.png')).toBe('remote');
  expect(imageSourceKind('../images/a.png')).toBe('local');
  expect(imageSourceKind('file:///workspace/a.png')).toBe('local');
  for (const source of ['', 'javascript:alert(1)', 'data:text/html,hello', 'file://server/a.png', '//server/a.png', 'https://user:password@example.com/a.png']) expect(imageSourceKind(source)).toBeNull();
});
