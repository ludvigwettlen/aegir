import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

it.skipIf(process.env.AEGIR_EDITOR_SMOKE !== '1')('shows heading markers and inserts formatting with keyboard commands', async () => {
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
    await reset('### Heading');
    await page.locator('h3').click();
    await page.locator('h3[data-heading-marker="###"]').waitFor();
    expect((await source()).trim()).toBe('### Heading');
    await page.screenshot({ path: '/tmp/aegir-heading-marker.png' });
    await reset(''); await page.keyboard.type('/table');
    await page.getByRole('listbox', { name: 'Insert formatting' }).waitFor();
    await page.keyboard.press('Enter');
    expect(await page.locator('table tr').count()).toBe(3);
    expect(await page.locator('table th').count()).toBe(3);
    expect(await source()).not.toContain('/table');
    await page.waitForFunction(() => (window as any).saved().content === (window as any).editor.getMarkdown());
    await reset(''); await page.keyboard.type('/link'); await page.keyboard.press('Tab');
    const form = page.getByRole('dialog', { name: 'Insert link' });
    await form.getByLabel('Text', { exact: true }).fill('Aegir');
    await form.getByLabel('Destination').fill('https://example.com');
    await form.getByRole('button', { name: 'Insert link' }).click();
    expect(await source()).toContain('[Aegir](https://example.com)');
    await reset('Selected text');
    await page.evaluate(() => (window as any).editor.commands.setTextSelection({ from: 1, to: 14 }));
    await page.keyboard.press('Meta+k');
    expect(await form.getByLabel('Text', { exact: true }).inputValue()).toBe('Selected text');
    await form.getByLabel('Destination').fill('javascript:alert(1)');
    await form.getByRole('button', { name: 'Insert link' }).click();
    await form.getByRole('alert').waitFor();
    expect((await source()).trim()).toBe('Selected text');
    await page.keyboard.press('Escape'); await form.waitFor({ state: 'detached' });
    await reset(''); await page.keyboard.type('/');
    await page.setViewportSize({ width: 460, height: 740 });
    await page.getByRole('listbox').waitFor();
    await page.screenshot({ path: '/tmp/aegir-formatting-menu.png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.type('missing'); await page.keyboard.press('Escape');
    expect(await page.getByRole('listbox').count()).toBe(0);
    expect((await source()).trim()).toBe('/missing');
    await reset('```\ncode\n```'); await page.locator('pre').click(); await page.keyboard.type('/table');
    expect(await page.getByRole('listbox').count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 60000);
