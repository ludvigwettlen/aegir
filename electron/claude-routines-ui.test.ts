import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('shows Claude Code scheduled tasks read-only under Routines', async () => {
  const server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0 }, appType: 'custom' });
  server.middlewares.use('/claude-routines', (_req, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<div id="root"></div><script type="module" src="/src/ui/testing/claude-routines.tsx"></script>');
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls!.local[0]}claude-routines`);
    await page.getByText('Claude Code', { exact: true }).waitFor({ timeout: 20000 });
    expect(await page.getByRole('button', { name: 'daily-brief', exact: true }).innerText()).toContain('On');
    expect(await page.getByRole('button', { name: 'queue-reconciler', exact: true }).innerText()).toContain('Paused');
    await page.getByRole('button', { name: 'daily-brief', exact: true }).click();
    await page.getByRole('heading', { name: 'daily-brief' }).waitFor();
    await page.getByText('Runs in Claude Code. Change it there; Legolas only shows it.').waitFor();
    expect(await page.getByRole('button', { name: /Run now|Pause|Resume/ }).count()).toBe(0);
    await page.locator('.ws-claude-needs').getByText('create a new app password').waitFor();
    await page.getByRole('button', { name: 'Failed · 1' }).click();
    expect(await page.locator('.ws-run-item').count()).toBe(1);
    await page.locator('.ws-run-log').getByText('API Error: Connection dropped').waitFor();
    await page.getByRole('button', { name: 'Needs you · 1' }).click();
    expect(await page.locator('.ws-run-item').count()).toBe(1);
    await page.screenshot({ path: '/tmp/aegir-claude-routines.png' });
    await page.getByRole('button', { name: 'queue-reconciler', exact: true }).click();
    await page.getByText('No runs in the last 14 days.').waitFor();
    expect(await page.locator('body').innerText()).not.toContain('—');
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 60000);
