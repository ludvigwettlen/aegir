import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// A real contenteditable is required to exercise caret movement and native clicks.
// AEGIR_EDITOR_SMOKE=1 pnpm test electron/document-links.test.ts
it.skipIf(process.env.AEGIR_EDITOR_SMOKE !== '1')('opens document links and edits their Markdown inline', async () => {
  const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0 }, appType: 'custom' });
  server.middlewares.use('/editor-test', async (_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<div id="host"></div><script type="module" src="/src/ui/testing/document-links.ts"></script>');
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const browserErrors: string[] = [];
    page.on('pageerror', error => browserErrors.push(error.message));
    await page.goto(`${server.resolvedUrls!.local[0]}editor-test`);
    await page.waitForFunction(() => Boolean((window as any).editor));
    const markdown = () => page.evaluate(() => (window as any).editor.getMarkdown());
    await page.locator('a').click();
    expect(await page.evaluate(() => (window as any).opened)).toEqual(['https://example.com']);
    expect(await page.locator('[data-link-source]').count()).toBe(0);
    // Enter the link using an actual arrow key from the preceding text.
    await page.evaluate(() => (window as any).editor.commands.focus(7));
    await page.waitForFunction(() => (window as any).editor.isFocused);
    await page.keyboard.press('ArrowRight');
    expect(await page.locator('[data-link-source]').textContent()).toBe('[Example](https://example.com)');
    expect(await markdown()).toBe('Before [Example](https://example.com) after.');
    await page.evaluate(() => {
      const editor = (window as any).editor;
      editor.state.doc.descendants((node: any, pos: number) => {
        if (node.type.name === 'documentLinkSource') editor.commands.setTextSelection({ from: pos + 1, to: pos + node.nodeSize - 1 });
      });
    });
    await page.keyboard.insertText('[Changed](https://example.org/new)');
    expect(await markdown()).toBe('Before [Changed](https://example.org/new) after.');
    await page.keyboard.press('ArrowRight');
    await page.locator('[data-link-source]').waitFor({ state: 'detached' });
    expect(await page.locator('[data-link-source]').count()).toBe(0);
    expect(await page.locator('a').textContent()).toBe('Changed');
    expect(await page.locator('a').getAttribute('href')).toBe('https://example.org/new');
    await page.keyboard.press('Meta+z');
    expect(await markdown()).toBe('Before [Example](https://example.com) after.');
    await page.evaluate(() => { const editor = (window as any).editor; editor.commands.setTextSelection(1); editor.setEditable(false); });
    await page.locator('a').click();
    expect(await page.evaluate(() => (window as any).opened)).toEqual(['https://example.com', 'https://example.com']);
    expect(await page.locator('[data-link-source]').count()).toBe(0);
    // Labels with formatting, titles, and parentheses survive entering source.
    const rich = 'Before [**Bold** label](https://example.com/a_(b) "Title") after.';
    await page.evaluate(source => {
      const editor = (window as any).editor;
      editor.setEditable(true);
      editor.commands.setContent(source, { contentType: 'markdown' });
      editor.commands.focus(9);
    }, rich);
    await page.locator('[data-link-source]').waitFor();
    expect(await markdown()).toBe(rich);
    await page.setViewportSize({ width: 420, height: 500 });
    await page.screenshot({ path: '/tmp/aegir-link-source.png' });
    await page.evaluate(() => (window as any).editor.commands.setTextSelection(1));
    expect(await page.locator('a strong').textContent()).toBe('Bold');
    expect(await page.locator('a').getAttribute('title')).toBe('Title');
    await page.locator('a').click();
    expect(await page.evaluate(() => (window as any).opened.at(-1))).toBe('https://example.com/a_(b)');
    expect(browserErrors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 60000);
