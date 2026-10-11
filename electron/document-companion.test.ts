import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// AEGIR_EDITOR_SMOKE=1 pnpm test electron/document-companion.test.ts
it.skipIf(process.env.AEGIR_EDITOR_SMOKE !== '1')('navigates live headings and preserves separate scratchpad notes', async () => {
  const server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/release/**'] } }, appType: 'custom' });
  server.middlewares.use('/companion-test', (_req, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<div id="root"></div><script type="module" src="/src/ui/testing/document-modes.tsx"></script>');
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = `${server.resolvedUrls!.local[0]}companion-test`;
    // A cold first load makes Vite optimise dependencies and reload the page, so start from a settled second load.
    await page.goto(url);
    await page.waitForFunction(() => Boolean((document.querySelector('.ws-document-prose') as any)?.editor), undefined, { timeout: 30_000 }).catch(() => {});
    const load = async (suffix = '') => {
      await page.goto(url + suffix);
      await page.waitForFunction(() => Boolean((document.querySelector('.ws-document-prose') as any)?.editor));
      await page.evaluate(() => { (window as any).editor = (document.querySelector('.ws-document-prose') as any).editor; });
    };
    await load();
    await page.evaluate(() => localStorage.setItem('aegir-document:modes-test:writing.md:scratchpad', 'Old **literal** notes\n- Keep this line'));
    await load();
    const panel = page.getByRole('complementary', { name: 'Document outline and notes' });
    const contents = page.getByRole('navigation', { name: 'Table of contents' });
    const headings = contents.getByRole('button');
    const toggle = page.getByRole('button', { name: 'Outline and notes', exact: true });
    const scratchpad = page.getByRole('textbox', { name: 'Document scratchpad' });
    const setDocument = async (source: string) => page.evaluate(source => (window as any).editor.commands.setContent(source, { contentType: 'markdown', emitUpdate: false }), source);
    const prose = 'A paragraph of writing. '.repeat(90);
    await setDocument(`# Opening\n\n${prose}\n\n## Repeated heading\n\n${prose}\n\n### A **formatted** heading\n\n${prose}\n\n## Repeated heading\n\n${prose}\n\n###### A deep heading with a long title that wraps onto several lines in the contents panel\n\nLast paragraph`);
    await expect.poll(() => headings.count()).toBe(5);
    expect(await headings.nth(2).innerText()).toContain('A formatted heading');
    const clickHeading = async (index: number, centered = false) => {
      await headings.nth(index).click();
      await expect.poll(() => page.evaluate(({ index, centered }) => {
        const editor = (window as any).editor;
        const dom = document.querySelectorAll('.ws-document-prose h1, .ws-document-prose h2, .ws-document-prose h3, .ws-document-prose h6')[index];
        const scroll = document.querySelector('.ws-document-scroll')!.getBoundingClientRect();
        const caret = editor.view.coordsAtPos(editor.state.selection.head);
        return centered ? Math.abs((caret.top + caret.bottom - scroll.top - scroll.bottom) / 2) : dom.getBoundingClientRect().top - scroll.top;
      }, { index, centered })).toBeLessThan(centered ? 2 : 65);
      expect(await page.evaluate(() => (window as any).editor.state.selection.$from.parent.type.name)).toBe('heading');
    };
    await clickHeading(3); // Duplicate text still navigates to the correct position.
    expect(await page.evaluate(() => (window as any).editor.state.selection.from)).toBeGreaterThan(4000);
    await page.keyboard.type('Updated ');
    await expect.poll(() => headings.nth(3).innerText()).toContain('Updated Repeated heading');
    await page.getByRole('button', { name: 'Focus mode', exact: true }).click();
    await page.getByRole('button', { name: 'Typewriter mode', exact: true }).click();
    await clickHeading(1, true);
    await page.waitForTimeout(200);
    await page.screenshot({ path: '/tmp/aegir-companion-contents.png' });
    // The shared toggle keeps arrow-key navigation within the panel.
    await page.getByRole('radio', { name: 'Contents', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => scratchpad.isVisible()).toBe(true);
    expect(await scratchpad.locator('p').allTextContents()).toEqual(['Old **literal** notes', '- Keep this line']);
    expect(await scratchpad.locator('strong').count()).toBe(0);
    await scratchpad.fill('A rough outline\n\n- Opening idea\n- Questions to explore\n- A stronger ending');
    await page.getByRole('radio', { name: 'Scratchpad', exact: true }).focus();
    await page.keyboard.press('ArrowLeft');
    expect(await contents.isVisible()).toBe(true);
    await page.getByRole('radio', { name: 'Scratchpad', exact: true }).click();
    expect(await scratchpad.innerText()).toContain('A rough outline');
    await page.waitForTimeout(200);
    await page.screenshot({ path: '/tmp/aegir-companion-scratchpad.png' });
    // Notes do not alter the Markdown source, even in read-only documents.
    expect(await page.evaluate(() => (window as any).editor.getMarkdown())).not.toContain('A rough outline');
    await page.evaluate(() => (window as any).editor.setEditable(false));
    await scratchpad.fill('Notes on a read-only document');
    const documentBefore = await page.evaluate(() => (window as any).editor.getMarkdown());
    await scratchpad.press('ControlOrMeta+a');
    await panel.getByRole('button', { name: 'Bold', exact: true }).click();
    expect(await scratchpad.locator('strong').innerText()).toBe('Notes on a read-only document');
    await scratchpad.press('ControlOrMeta+i');
    expect(await scratchpad.locator('em').innerText()).toBe('Notes on a read-only document');
    await panel.getByRole('button', { name: 'Increase indent', exact: true }).click();
    expect(await scratchpad.locator('p').first().getAttribute('data-indent')).toBe('1');
    await scratchpad.press('ControlOrMeta+z');
    expect(await scratchpad.locator('p').first().getAttribute('data-indent')).toBe(null);
    await scratchpad.press('ControlOrMeta+Shift+z');
    expect(await scratchpad.locator('p').first().getAttribute('data-indent')).toBe('1');
    await panel.getByRole('button', { name: 'Decrease indent', exact: true }).click();
    await scratchpad.press('ControlOrMeta+]');
    expect(await scratchpad.locator('p').first().getAttribute('data-indent')).toBe('1');
    await scratchpad.press('ArrowRight');
    await expect.poll(() => scratchpad.evaluate(el => (el as any).editor.state.selection.empty)).toBe(true);
    await scratchpad.press('Enter');
    expect(await scratchpad.locator(':scope > p').count()).toBe(2);
    await panel.getByRole('button', { name: 'Bold', exact: true }).click();
    await panel.getByRole('button', { name: 'Italic', exact: true }).click();
    await panel.getByRole('button', { name: 'Bullet list', exact: true }).click();
    await page.keyboard.type('First idea');
    expect(await scratchpad.locator(':scope > p').first().innerText()).toBe('Notes on a read-only document');
    expect(await scratchpad.locator('li').first().innerText()).toBe('First idea');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Nested idea');
    await scratchpad.press('Tab');
    expect(await scratchpad.locator('ul ul li').innerText()).toBe('Nested idea');
    await scratchpad.press('Shift+Tab');
    expect(await scratchpad.locator('ul ul').count()).toBe(0);
    await panel.getByRole('button', { name: 'Increase indent', exact: true }).click();
    expect(await scratchpad.locator('ul ul li').innerText()).toBe('Nested idea');
    expect(await page.evaluate(() => (window as any).editor.getMarkdown())).toBe(documentBefore);
    const richNotes = await scratchpad.innerHTML();
    await page.screenshot({ path: '/tmp/aegir-scratchpad-formatting.png' });
    await scratchpad.press('Escape');
    expect(await panel.isVisible()).toBe(false);
    expect(await page.locator('.ws-document-focus').count()).toBe(1);
    expect(await toggle.evaluate(el => el === document.activeElement)).toBe(true);
    await toggle.click();
    expect(await scratchpad.innerHTML()).toBe(richNotes);
    // Reopening the same file restores notes; a different file gets its own pad.
    await load();
    await page.getByRole('radio', { name: 'Scratchpad', exact: true }).click();
    expect(await scratchpad.innerHTML()).toBe(richNotes);
    await load('?document=other.md&task=1');
    await page.getByRole('radio', { name: 'Scratchpad', exact: true }).click();
    expect((await scratchpad.innerText()).trim()).toBe('');
    // Storage failure retains the draft and exposes a working retry.
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      (window as any).restoreStorage = () => { Storage.prototype.setItem = original; };
      Storage.prototype.setItem = function(key, value) { if (key.endsWith(':scratchpad')) throw new Error('Storage full'); original.call(this, key, value); };
    });
    await scratchpad.fill('Keep these unsaved notes');
    expect(await panel.getByRole('alert').innerText()).toContain('could not be saved');
    expect(await scratchpad.innerText()).toBe('Keep these unsaved notes');
    await page.evaluate(() => (window as any).restoreStorage());
    await panel.getByRole('button', { name: 'Retry', exact: true }).click();
    expect(await panel.getByRole('status').innerText()).toContain('Saved locally');
    await page.setViewportSize({ width: 900, height: 620 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(200);
    await page.screenshot({ path: '/tmp/aegir-companion-compact.png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Compact overlays close on navigation; empty outlines explain how to begin.
    await page.getByRole('radio', { name: 'Contents', exact: true }).click();
    await page.setViewportSize({ width: 700, height: 620 });
    await expect.poll(() => panel.isVisible()).toBe(false);
    await toggle.click();
    await headings.first().click();
    expect(await panel.isVisible()).toBe(false);
    await toggle.click();
    await setDocument('No headings yet.');
    await expect.poll(() => contents.innerText()).toContain('Add headings');
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 60000);
