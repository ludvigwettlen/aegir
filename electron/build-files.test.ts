import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The renderer entry point. Without it the packaged app opens a blank window.
describe('build inputs', () => {
  it('has the renderer entry page', () => {
    const page = join(__dirname, '..', 'index.html');
    expect(existsSync(page)).toBe(true);
    const html = readFileSync(page, 'utf8');
    expect(html).toContain('id="root"');
    expect(html).toMatch(/<script[^>]+src="\/src\/main\.tsx"/);
  });
});
