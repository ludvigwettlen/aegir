import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { reviewMirror, reviewRequest } from '../shared/review.js';

it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('asks the agent to open a task draft in human-review from the panel, R, the palette and Files', async () => {
  const server = await createServer({
    configFile: false, esbuild: { jsx: 'automatic' }, appType: 'custom',
    // node_modules can be a symlink (a git worktree): allow its real folder, keep one React, keep the cache private.
    server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd(), realpathSync('node_modules')] } },
    resolve: { dedupe: ['react', 'react-dom'] }, cacheDir: join(tmpdir(), 'aegir-review-in-browser-smoke'),
  });
  server.middlewares.use('/review-in-browser', (_req, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<div id="root"></div><script type="module" src="/src/ui/testing/review-in-browser.tsx"></script>');
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    // A cold first load makes Vite optimise dependencies and reload the page, so start from a settled second load.
    await page.goto(`${server.resolvedUrls!.local[0]}review-in-browser`);
    await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor({ timeout: 30_000 }).catch(() => {});
    await page.goto(`${server.resolvedUrls!.local[0]}review-in-browser`);
    const row = (title: string) => page.locator('[data-task-row]', { hasText: title });
    const reviewButton = page.getByRole('button', { name: 'Review in browser', exact: true });
    const calls = () => page.evaluate(() => (window as any).fixture.calls as unknown[][]);
    const sent = (count: number) => page.waitForFunction(n => (window as any).fixture.calls.length >= n, count);
    const notice = page.locator('.ws-notice');
    const go = async (letter: string, heading: string) => {
      await page.keyboard.press('g'); await page.keyboard.press(letter);
      await page.getByRole('heading', { name: heading, level: 1 }).waitFor();
    };
    const focusRow = (title: string) => row(title).click();
    // Fixture tasks were created today, so the brain mirror carries today's date.
    const created = new Date().toISOString();
    const request = (path: string) => reviewRequest({ path, mirror: reviewMirror(path, created) });

    // One draft: the panel button asks for it by name, and the task stays in front of you.
    await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor();
    await go('n', 'Needs you');
    await focusRow('Draft the DM to Connor');
    await reviewButton.waitFor();
    await page.screenshot({ path: '/tmp/aegir-review-button.png' });
    await reviewButton.click();
    await sent(1);
    expect((await calls())[0]).toEqual(['sendMessage', 'dm-thread', request('connor-dm.md')]);
    await row('Draft the DM to Connor').getByText('working').waitFor();
    await page.screenshot({ path: '/tmp/aegir-review-in-browser.png' });

    // Claude is on it now: no button, and R says so.
    expect(await reviewButton.count()).toBe(0);
    await focusRow('Draft the DM to Connor');
    await page.keyboard.press('r');
    await notice.filter({ hasText: 'Claude is already working on this task' }).waitFor();

    // Several drafts: R opens ⌘K at a picker; typing narrows it and Enter sends that file.
    await focusRow('Write the board memo');
    await page.keyboard.press('r');
    const picker = page.getByRole('combobox', { name: 'Review in browser' });
    await picker.waitFor();
    expect(await page.getByRole('option').allInnerTexts()).toEqual(['memo.md', 'notes/sources.md', 'status.md']);
    await page.keyboard.type('sources');
    await page.keyboard.press('Enter');
    await sent(2);
    expect((await calls())[1]).toEqual(['sendMessage', 'memo-thread', request('notes/sources.md')]);

    // Files lists each draft with its own review icon.
    await focusRow('Brief the new designer');
    await page.getByRole('button', { name: 'Files' }).click();
    await page.getByRole('button', { name: 'Review appendix.md in your browser' }).click();
    await sent(3);
    expect((await calls())[2]).toEqual(['sendMessage', 'brief-thread', request('appendix.md')]);

    // No draft: no button, and R explains.
    await focusRow('Look up the venue');
    expect(await reviewButton.count()).toBe(0);
    await page.keyboard.press('r');
    await notice.filter({ hasText: 'No Markdown draft in this task yet' }).waitFor();

    // An attached local draft on a task with no conversation starts one; ⌘K shows the row with its key.
    await go('i', 'Inbox');
    await focusRow('Polish the offsite agenda');
    await page.keyboard.press('Meta+K');
    await page.keyboard.type('review');
    const option = page.getByRole('option', { name: /Review in browser/ });
    expect(await option.locator('kbd').allInnerTexts()).toEqual(['R']);
    await page.keyboard.press('Escape');
    await reviewButton.click();
    await sent(4);
    expect((await calls())[3]).toEqual(['handOff', 'attached', request('/Users/m/brain/drafts/offsite agenda.md')]);
    await row('Polish the offsite agenda').getByText('working').waitFor();

    // On the Codex engine there's no human-review skill, so no button and R explains.
    await page.goto(`${server.resolvedUrls!.local[0]}review-in-browser?codex`);
    await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor();
    await go('n', 'Needs you');
    await focusRow('Draft the DM to Connor');
    await page.getByRole('button', { name: 'Mark done' }).waitFor();
    expect(await reviewButton.count()).toBe(0);
    await page.keyboard.press('r');
    await notice.filter({ hasText: 'needs the Claude Code engine' }).waitFor();
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    await server.close();
  }
}, 60_000);
