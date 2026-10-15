import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium, type Locator } from 'playwright';

it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('clips narrow panes without crushing content and preserves drafts while resizing', async () => {
  const server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] }, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/release/**'] } }, appType: 'custom' });
  server.middlewares.use('/pane-test', (_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<div id="root"></div><script type="module" src="/src/ui/testing/window-header.tsx"></script>');
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(7000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const width = (locator: Locator) => locator.evaluate(element => element.getBoundingClientRect().width);
    const drag = async (divider: Locator, x: number) => {
      const box = (await divider.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + 180);
      await page.mouse.down(); await page.mouse.move(x, box.y + 180, { steps: 8 }); await page.mouse.up();
    };
    await page.goto(`${server.resolvedUrls!.local[0]}pane-test?files=2&long`);
    await page.getByRole('button', { name: 'Needs you', exact: true }).click();
    const taskDivider = page.getByRole('separator', { name: 'Resize task details' });
    await drag(taskDivider, 1395);
    expect(await taskDivider.getAttribute('aria-valuenow')).toBe('24');
    await expect.poll(() => width(page.locator('.ws-task-detail-clip'))).toBe(25);
    await expect.poll(() => width(page.locator('.ws-task-detail'))).toBeGreaterThanOrEqual(340);
    await page.screenshot({ path: '/tmp/aegir-task-pane-sliver.png' });
    await page.reload(); await page.getByRole('button', { name: 'Needs you', exact: true }).click();
    expect(await taskDivider.getAttribute('aria-valuenow')).toBe('24');
    await taskDivider.press('Home');
    await expect.poll(() => width(page.locator('.ws-task-list-clip'))).toBe(24);
    await expect.poll(() => width(page.locator('.ws-task-list'))).toBeGreaterThanOrEqual(280);
    await taskDivider.press('Enter');
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill('Keep this draft through resizing');
    await page.getByLabel('Task documents', { exact: true }).getByRole('button', { name: 'Open pm-level-boundaries-proposal.md', exact: true }).click();
    const prose = page.getByRole('textbox', { name: 'Document', exact: true });
    await prose.waitFor();
    await page.evaluate(() => { (window as any).originalEditor = (document.querySelector('.ws-document-prose') as any).editor; });
    const chatToggle = page.getByRole('button', { name: 'Chat', exact: true });
    expect((await chatToggle.boundingBox())!.x).toBeLessThan((await page.locator('.ws-document-title').boundingBox())!.x);
    expect(await page.locator('.ws-document-more').count()).toBe(0);
    for (const name of ['Copy document', 'Insert image', 'Typewriter mode']) expect(await page.getByRole('button', { name, exact: true }).isVisible()).toBe(true);
    await chatToggle.click();
    const divider = page.getByRole('separator', { name: 'Resize conversation' });
    await drag(divider, 0);
    expect(await divider.getAttribute('aria-valuenow')).toBe('24');
    await expect.poll(() => width(page.locator('.ws-chat-clip'))).toBe(24);
    await expect.poll(() => width(page.locator('.ws-thread'))).toBe(320);
    expect(await composer.inputValue()).toBe('Keep this draft through resizing');
    await page.screenshot({ path: '/tmp/aegir-document-chat-sliver.png' });
    await divider.press('Shift+ArrowRight');
    expect(await divider.getAttribute('aria-valuenow')).toBe('74');
    await divider.press('Enter');
    await page.setViewportSize({ width: 900, height: 700 });
    await expect.poll(() => divider.getAttribute('aria-valuenow')).toBe('324');
    expect(await divider.isVisible()).toBe(true);
    await drag(divider, 0);
    await expect.poll(() => width(page.locator('.ws-thread'))).toBe(320);
    await expect.poll(() => width(page.locator('.ws-chat-clip'))).toBe(24);
    await page.screenshot({ path: '/tmp/aegir-document-toolbar-compact.png' });
    for (const name of ['Copy document', 'Insert image', 'Typewriter mode']) {
      const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(900);
    }
    await prose.press('F6');
    await expect.poll(() => width(page.locator('.ws-chat-clip'))).toBe(320);
    expect(await composer.evaluate(element => element === document.activeElement)).toBe(true);
    await divider.press('End');
    await expect.poll(() => width(page.locator('.ws-document'))).toBe(24);
    await expect.poll(() => width(page.locator('.ws-document-viewport'))).toBe(360);
    await composer.press('F6');
    await expect.poll(() => width(page.locator('.ws-document'))).toBeGreaterThanOrEqual(360);
    expect(await page.evaluate(() => (document.querySelector('.ws-document-prose') as any).editor === (window as any).originalEditor)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Typewriter mode', exact: true }).click();
    expect(await page.getByRole('button', { name: 'Typewriter mode', exact: true }).getAttribute('aria-pressed')).toBe('true');
    await page.getByRole('button', { name: 'Insert image', exact: true }).click();
    await page.getByRole('dialog', { name: 'Insert image' }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Back to list', exact: true }).click();
    expect(await composer.inputValue()).toBe('Keep this draft through resizing');
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 60000);
