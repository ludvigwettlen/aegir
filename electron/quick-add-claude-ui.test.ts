import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('adds a task that Claude writes from a dictated note, and keeps the note when Claude fails', async () => {
  const server = await createServer({
    configFile: false, esbuild: { jsx: 'automatic' }, appType: 'custom',
    // node_modules can be a symlink (a git worktree): allow its real folder, keep one React, keep the cache private.
    server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd(), realpathSync('node_modules')] } },
    resolve: { dedupe: ['react', 'react-dom'] }, cacheDir: join(tmpdir(), 'aegir-quick-add-claude-smoke'),
  });
  server.middlewares.use('/quick-add-claude', (_req, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<div id="root"></div><script type="module" src="/src/ui/testing/quick-add-claude.tsx"></script>');
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    // A cold first load makes Vite optimise dependencies and reload the page, so start from a settled second load.
    await page.goto(`${server.resolvedUrls!.local[0]}quick-add-claude`);
    await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor({ timeout: 30_000 }).catch(() => {});
    await page.goto(`${server.resolvedUrls!.local[0]}quick-add-claude`);
    await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor({ timeout: 30_000 });
    errors.length = 0;

    const field = page.getByRole('textbox', { name: 'New task', exact: true });
    const note = "Draft investor memo for September. Schedule for Friday. I'm waiting for the numbers from Tobias";
    expect(await page.getByRole('button', { name: 'Add with Claude' }).count()).toBe(0);
    await field.fill(note);
    await page.evaluate(() => { (window as any).fixture.hold = true; });
    await field.press('Meta+Enter');
    // While Claude writes, the note stays visible and can't be edited or submitted twice.
    await page.getByRole('button', { name: 'Add with Claude' }).getByText('Writing…').waitFor();
    expect(await field.getAttribute('readonly')).not.toBeNull();
    await page.screenshot({ path: '/tmp/legolas-quick-add-claude-writing.png' });
    await field.press('Meta+Enter');
    await page.evaluate(() => (window as any).fixture.release());
    await page.getByText('Added to Upcoming').waitFor();
    expect(await field.inputValue()).toBe('');
    expect(await page.evaluate(() => (window as any).fixture.polished)).toEqual([note]);

    await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
    await page.getByText('Draft September investor memo').first().waitFor();
    await page.screenshot({ path: '/tmp/legolas-quick-add-claude-added.png' });

    // A failed call leaves the note in the field, and Enter still adds it as typed.
    await page.evaluate(() => { const f = (window as any).fixture; f.hold = false; f.fail = true; });
    await field.fill('Book dentist');
    await page.getByRole('button', { name: 'Add with Claude' }).click();
    await page.getByText('Claude is not available', { exact: false }).waitFor();
    expect(await field.inputValue()).toBe('Book dentist');
    await field.press('Enter');
    await page.waitForFunction(() => (document.querySelector('[aria-label="New task"]') as HTMLInputElement).value === '');
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 90000);
