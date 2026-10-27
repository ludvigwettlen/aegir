import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('finds filed/completed tasks, runs context actions, restores focus and handles delayed/failed searches', async () => {
  const server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0 }, appType: 'custom' });
  server.middlewares.use('/palette-test', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<div id="root"></div><script type="module" src="/src/ui/testing/command-palette.tsx"></script>'); });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }); page.setDefaultTimeout(10000);
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${server.resolvedUrls!.local[0]}palette-test`);
    const launcher = page.getByRole('button', { name: 'Search tasks and commands', exact: true });
    await launcher.click();
    const input = page.getByRole('combobox', { name: 'Search tasks and commands' });
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await input.fill('asne');
    await page.getByRole('option', { name: /Åsne annual renewal/ }).waitFor();
    await page.screenshot({ path: '/tmp/aegir-palette-wide.png' });
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
    expect(await page.locator('[data-keyboard-current][data-task-row]').getAttribute('data-feedback-context')).toBe('task-row:filed');
    await page.keyboard.press('Meta+k'); await input.fill('mark task done'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => (window as any).fixture.changes.includes('filed'));
    await launcher.click(); await input.fill('archived'); await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Completed', exact: true }).waitFor();
    await expect.poll(() => page.locator('[data-keyboard-current][data-task-row]').getAttribute('data-feedback-context')).toBe('task-row:done');
    await launcher.click(); await input.fill('contract');
    await page.getByRole('option', { name: /Research memo.*memo.md/ }).waitFor();
    await input.fill('old');
    await page.waitForFunction(() => (window as any).fixture.queries.includes('old'));
    await input.fill('zzzz');
    await page.waitForFunction(() => (window as any).fixture.queries.includes('zzzz'));
    await page.waitForTimeout(800);
    expect(await page.getByRole('option', { name: /Research memo/ }).count()).toBe(0);
    await page.evaluate(() => { (window as any).fixture.fail = true; });
    await input.fill('current');
    await page.getByText('Could not search conversations and documents.', { exact: false }).waitFor();
    expect(await page.getByRole('option', { name: /Current work/ }).count()).toBe(1);
    await page.setViewportSize({ width: 560, height: 650 }); await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.screenshot({ path: '/tmp/aegir-palette-compact.png' });
    const bounds = await dialog.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(560);
    await page.keyboard.press('Escape'); expect(await dialog.count()).toBe(0);
    expect(await launcher.evaluate(el => el === document.activeElement)).toBe(true);
    // Other dialogs own the shortcut, and editors keep it for inserting links.
    await page.evaluate(() => { const el = document.createElement('div'); el.contentEditable = 'true'; el.id = 'editor'; document.body.append(el); el.focus(); });
    await page.keyboard.press('Meta+k'); expect(await dialog.count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 60000);
