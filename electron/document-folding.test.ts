import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

it.skipIf(process.env.AEGIR_EDITOR_SMOKE !== '1')('folds headings with disclosure buttons and Tab without changing Markdown', async () => {
  const server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0 }, appType: 'custom' });
  server.middlewares.use('/commands-test', (_req, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<style>body{margin:0;font-family:system-ui}#host{height:100vh;display:flex}*{box-sizing:border-box}</style><div id="host"></div><script type="module" src="/src/ui/testing/document-tables.tsx"></script>');
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls!.local[0]}commands-test`);
    await page.waitForFunction(() => Boolean((document.querySelector('.ws-document-prose') as any)?.editor));
    await page.evaluate(() => { (window as any).editor = (document.querySelector('.ws-document-prose') as any).editor; });
    const reset = async (content: string) => {
      await page.evaluate(content => { const editor = (window as any).editor; editor.commands.setContent(content, { contentType: 'markdown' }); editor.commands.focus('end'); }, content);
      await page.waitForFunction(() => (window as any).editor.isFocused);
    };
    const source = () => page.evaluate(() => (window as any).editor.getMarkdown());
    await reset('# Parent\n\nVisible body\n\n## Child\n\nNested body\n\n# Peer\n\nPeer body');
    const original = await source();
    const parent = page.getByRole('button', { name: 'Collapse section: Parent', exact: true });
    await parent.click();
    await expect.poll(() => page.locator('p').filter({ hasText: 'Visible body' }).isVisible()).toBe(false);
    expect(await page.locator('h2').isVisible()).toBe(false);
    expect(await page.locator('p').filter({ hasText: 'Peer body' }).isVisible()).toBe(true);
    await page.keyboard.press('Tab');
    await expect.poll(() => page.locator('h2').isVisible()).toBe(true);
    expect(await source()).toBe(original);
    await page.keyboard.press('Tab');
    expect(await page.locator('h2').isVisible()).toBe(false);
    expect(await source()).toBe(original);
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 60000);
