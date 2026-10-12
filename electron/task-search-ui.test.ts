import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('finds any task in ⌘K and the sidebar search bar, by its title, context, conversation or documents, and opens it in its list', async () => {
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
    const field = page.getByRole('combobox', { name: 'Search tasks and commands' });
    const selected = () => page.locator('.ws-task-row.selected .ws-task-title').textContent();
    const sections = () => page.locator('.ws-palette-section').allTextContents();

    // The sidebar's search bar opens ⌘K and says so. No accents needed. Enter opens the task in its list, selected,
    // with its panel.
    expect(await page.getByRole('button', { name: /Search tasks/ }).locator('kbd').textContent()).toBe('⌘K');
    await page.getByRole('button', { name: /Search tasks/ }).click();
    await field.fill('jobbspranget');
    await page.getByRole('option', { name: /Prep for Jobbsprånget.*Inbox.*#gtm/ }).waitFor();
    await page.screenshot({ path: '/tmp/legolas-find-task.png' });
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Inbox', level: 1 }).waitFor();
    await page.waitForFunction(() => document.querySelector('.ws-task-row.selected .ws-task-title')?.textContent === 'Prep for Jobbsprånget');
    expect(await page.getByRole('textbox', { name: 'Task title' }).inputValue()).toBe('Prep for Jobbsprånget');
    // Keyboard focus lands on that row, so J and K carry on from it.
    await page.waitForFunction(() => document.activeElement?.closest('.ws-task-row')?.textContent?.includes('Prep for Jobbsprånget'));

    // ⌘F no longer opens anything.
    await page.keyboard.press('Meta+f');
    await page.waitForTimeout(200);
    expect(await page.locator('.ws-palette').count()).toBe(0);

    // ⌘K from the list: a word only in a finished task's context finds it, with that bit of context, and opens Completed.
    // The dismissed "Fjordline dinner" is on no list, so it is not found.
    await page.keyboard.press('Meta+k');
    await field.fill('fjordline');
    await page.getByRole('option', { name: /Close the Q3 renewal.*Completed.*Fjordline asked for the DPA/ }).waitFor();
    await page.waitForTimeout(400);
    expect(await page.getByRole('option').count()).toBe(1);
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Completed', level: 1 }).waitFor();
    await page.waitForFunction(() => document.querySelector('.ws-task-row.selected .ws-task-title')?.textContent === 'Close the Q3 renewal');

    // Every word must match; #label means the label. A dated task opens in Upcoming.
    await page.keyboard.press('Meta+k');
    await field.fill('#board deck');
    await page.getByRole('option', { name: /Prep board deck/ }).waitFor();
    expect(await page.getByRole('option', { name: /Prep board deck/ }).count()).toBe(1);
    await field.fill('memo september');
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Upcoming', level: 1 }).waitFor();
    await page.waitForFunction(() => document.querySelector('.ws-task-row.selected .ws-task-title')?.textContent === 'Draft investor memo for September');

    // Words that are only in a task's conversation find it too, a moment later, with who said what. While the app is
    // still searching, the box says so instead of "Nothing matches".
    await page.evaluate(() => { (window as any).fixture.hold = true; });
    await page.keyboard.press('Meta+k');
    await field.fill('fjelltek');
    await page.getByText('Searching conversations and documents…').waitFor();
    await page.waitForFunction(() => (window as any).fixture.waiting);
    await page.evaluate(() => (window as any).fixture.release());
    await page.getByRole('option', { name: /Draft investor memo for September.*Upcoming.*Claude: “Fjelltek signed the renewal/ }).waitFor();
    await page.screenshot({ path: '/tmp/legolas-find-conversation.png' });
    await page.evaluate(() => { (window as any).fixture.hold = false; });
    // The words can be in different places: "memo" in the title, "fjelltek" in the conversation.
    await field.fill('memo fjelltek');
    await page.getByRole('option', { name: /Draft investor memo for September.*Claude: “Fjelltek signed/ }).waitFor();
    // And in a document Claude wrote in the task's folder, named in the row.
    await field.fill('deck cohort');
    await page.getByRole('option', { name: /Prep board deck.*board-deck-outline\.md: “.*churn by cohort/ }).waitFor();
    await page.screenshot({ path: '/tmp/legolas-find-document.png' });
    // A task found by its title is listed once, even when its conversation matches as well.
    await field.fill('deck');
    await page.waitForTimeout(400);
    expect(await page.getByRole('option', { name: /Prep board deck/ }).count()).toBe(1);
    await field.fill('churn slide');
    await page.getByRole('option', { name: /Prep board deck.*You: “Put the churn slide last/ }).waitFor();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor();
    await page.waitForFunction(() => document.querySelector('.ws-task-row.selected .ws-task-title')?.textContent === 'Prep board deck');

    // Commands named by what was typed come first, then the tasks, each under its heading. Esc closes.
    await page.keyboard.press('Meta+k');
    await field.fill('set');
    await page.getByRole('option', { name: /Set up the Harborlight offsite/ }).waitFor();
    expect((await page.getByRole('option').first().textContent())).toMatch(/^Set (due date|label|priority)/);
    expect((await sections()).slice(0, 2)).toEqual(['Commands', 'Tasks']);
    await page.screenshot({ path: '/tmp/legolas-find-mixed.png' });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.ws-palette'));
    expect(await selected()).toBe('Prep board deck');
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 90000);
