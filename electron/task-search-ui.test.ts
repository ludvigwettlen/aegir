import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('finds any task from the sidebar search bar, ⌘F or ⌘K, and opens it in its list', async () => {
  const server = await createServer({
    configFile: false, esbuild: { jsx: 'automatic' }, appType: 'custom',
    // node_modules can be a symlink (a git worktree): allow its real folder, keep one React, keep the cache private.
    server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd(), realpathSync('node_modules')] } },
    resolve: { dedupe: ['react', 'react-dom'] }, cacheDir: join(tmpdir(), 'aegir-task-search-smoke'),
  });
  server.middlewares.use('/task-search', (_req, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<div id="root"></div><script type="module" src="/src/ui/testing/task-search.tsx"></script>');
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    // A cold first load makes Vite optimise dependencies and reload the page, so start from a settled second load.
    await page.goto(`${server.resolvedUrls!.local[0]}task-search`);
    await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor({ timeout: 30_000 }).catch(() => {});
    await page.goto(`${server.resolvedUrls!.local[0]}task-search`);
    await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor({ timeout: 30_000 });
    errors.length = 0;
    const field = page.getByRole('combobox', { name: 'Find' });
    const selected = () => page.locator('.ws-task-row.selected .ws-task-title').textContent();

    // The sidebar's search bar opens Find with the open tasks you touched last; a finished one is not among them.
    await page.getByRole('button', { name: /Search tasks/ }).click();
    await field.waitFor();
    expect(await page.getByRole('option').allTextContents()).toEqual([
      expect.stringContaining('Prep board deck'), expect.stringContaining('Draft investor memo'), expect.stringContaining('Prep for Jobbsprånget'),
    ]);
    // No accents needed. Enter opens the task in its list, selected, with its panel.
    await field.fill('jobbspranget');
    await page.getByRole('option', { name: /Prep for Jobbsprånget.*Inbox.*#gtm/ }).waitFor();
    // Find is about all tasks, so the palette doesn't name the selected one.
    expect(await page.locator('.ws-palette-context').count()).toBe(0);
    await page.screenshot({ path: '/tmp/legolas-find-task.png' });
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Inbox', level: 1 }).waitFor();
    await page.waitForFunction(() => document.querySelector('.ws-task-row.selected .ws-task-title')?.textContent === 'Prep for Jobbsprånget');
    expect(await page.getByRole('textbox', { name: 'Task title' }).inputValue()).toBe('Prep for Jobbsprånget');
    // Keyboard focus lands on that row, so J and K carry on from it.
    await page.waitForFunction(() => document.activeElement?.closest('.ws-task-row')?.textContent?.includes('Prep for Jobbsprånget'));

    // ⌘F from the list: a word only in a finished task's context finds it, with that bit of context, and opens Completed.
    // The dismissed "Fjordline dinner" is on no list, so it is not found.
    await page.keyboard.press('Meta+f');
    await field.fill('fjordline');
    await page.getByRole('option', { name: /Close the Q3 renewal.*Completed.*Fjordline asked for the DPA/ }).waitFor();
    expect(await page.getByRole('option').count()).toBe(1);
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Completed', level: 1 }).waitFor();
    await page.waitForFunction(() => document.querySelector('.ws-task-row.selected .ws-task-title')?.textContent === 'Close the Q3 renewal');

    // Every word must match; #label means the label. A dated task opens in Upcoming.
    await page.keyboard.press('Meta+f');
    await field.fill('#board deck');
    await page.getByRole('option', { name: /Prep board deck/ }).waitFor();
    expect(await page.getByRole('option').count()).toBe(1);
    await field.fill('memo september');
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Upcoming', level: 1 }).waitFor();
    await page.waitForFunction(() => document.querySelector('.ws-task-row.selected .ws-task-title')?.textContent === 'Draft investor memo for September');

    // ⌘K lists Find a task with its shortcut; Esc from there goes back, Esc again closes.
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('find');
    const row = page.getByRole('option', { name: /Find a task/ });
    await row.waitFor();
    expect(await row.locator('.ws-palette-keys').textContent()).toBe('⌘F');
    await page.keyboard.press('Enter');
    await field.waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('combobox', { name: 'Search commands' }).waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.ws-palette'));
    expect(await selected()).toBe('Draft investor memo for September');
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 90000);
