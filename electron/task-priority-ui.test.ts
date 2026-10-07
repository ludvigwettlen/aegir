import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('groups Today by Claude\'s bands, and 1/2/3/0, the panel and ⌘K let the user override them', async () => {
  const server = await createServer({
    configFile: false, esbuild: { jsx: 'automatic' }, appType: 'custom',
    // node_modules can be a symlink (a git worktree): allow its real folder, keep one React, keep the cache private.
    server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd(), realpathSync('node_modules')] } },
    resolve: { dedupe: ['react', 'react-dom'] }, cacheDir: join(tmpdir(), 'aegir-task-priority-smoke'),
  });
  server.middlewares.use('/task-priority', (_req, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<div id="root"></div><script type="module" src="/src/ui/testing/task-priority.tsx"></script>');
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    // A cold first load makes Vite optimise dependencies and reload the page, so start from a settled second load.
    await page.goto(`${server.resolvedUrls!.local[0]}task-priority`);
    await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor({ timeout: 30_000 }).catch(() => {});
    await page.goto(`${server.resolvedUrls!.local[0]}task-priority`);
    await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor({ timeout: 30_000 });
    errors.length = 0;
    const groups = () => page.evaluate(() => [...document.querySelectorAll('.ws-row-group')].map((group) =>
      `${group.querySelector('.ws-group-label')!.firstChild!.textContent}: ${[...group.querySelectorAll('.ws-task-title')].map((title) => title.textContent).join(' | ')}`));
    const calls = () => page.evaluate(() => (window as any).fixture.calls);

    // Today holds every open P1, whatever its date or status: the suggestion and next week's two join today's one.
    expect(await groups()).toEqual([
      'P1: Prep for Jobbsprånget | Answer Tove on the September report | Sign off the board pack | Customer advisory board with Harborlight',
      'P2: Prep Greenfield call with Dana Whitfield',
      'P3: Read the Cognition playbook piece',
      'Not prioritized yet: Map direct reports to level and stage',
    ]);
    // Four P1s: said in the header, not blocked. The sweep's "P1: " prefix shows as a flag, not as a second P1.
    await page.getByText('4 P1s, aim for 3').waitFor();
    expect(await page.locator('.ws-task-row', { hasText: 'Answer Tove' }).locator('.ws-sweep-flag').textContent()).toBe('urgent');
    await page.getByText('Claude prioritized 6 · 09:12').waitFor();
    await page.screenshot({ path: '/tmp/legolas-priority-today.png' });

    // 1 on Claude's P2: it becomes the user's P1, and the panel says what Claude said.
    await page.locator('.ws-task-row', { hasText: 'Prep Greenfield call' }).click();
    await page.getByText('Claude: Investor intro call, prep can wait a day').waitFor();
    await page.keyboard.press('1');
    await page.getByText('P1 · ⌘Z to undo').waitFor();
    expect((await groups())[0]).toBe('P1: Prep for Jobbsprånget | Prep Greenfield call with Dana Whitfield | Answer Tove on the September report | Sign off the board pack | Customer advisory board with Harborlight');
    await page.getByText('5 P1s, aim for 3').waitFor();
    await page.getByText('You set P1. Claude said P2: Investor intro call, prep can wait a day').waitFor();
    expect(await page.getByRole('group', { name: 'Priority' }).getByRole('button', { name: 'P1' }).getAttribute('aria-pressed')).toBe('true');
    await page.screenshot({ path: '/tmp/legolas-priority-override.png' });

    // ⌘Z puts Claude's band back.
    await page.locator('.ws-rows').focus();
    await page.keyboard.press('Meta+z');
    await page.waitForFunction(() => [...document.querySelectorAll('.ws-row-group')].some((group) => group.textContent!.startsWith('P2') && group.textContent!.includes('Prep Greenfield')));

    // A row that moves group keeps keyboard focus, so J carries on from it.
    await page.locator('.ws-task-row', { hasText: 'Read the Cognition' }).click();
    await page.keyboard.press('2');
    await page.waitForFunction(() => [...document.querySelectorAll('.ws-row-group')].some((group) => group.textContent!.startsWith('P2') && group.textContent!.includes('Read the Cognition')));
    expect(await page.evaluate(() => document.activeElement?.textContent?.includes('Read the Cognition'))).toBe(true);
    // 0 hands his own band back to Claude; on Claude's band it does nothing.
    await page.keyboard.press('0');
    await page.getByText('Back to Claude · ⌘Z to undo').waitFor();
    expect((await groups()).at(-1)).toBe('Not prioritized yet: Read the Cognition playbook piece | Map direct reports to level and stage');
    await page.locator('.ws-task-row', { hasText: 'Answer Tove' }).click();
    await page.keyboard.press('0');

    // Digits do nothing while the § hints are held (§ sits next to 1) or straight after G.
    // Playwright has no § key, so the hold is dispatched the way a Swedish keyboard sends it.
    const section = (type: string) => page.evaluate((kind) => window.dispatchEvent(new KeyboardEvent(kind, { key: '§', code: 'IntlBackslash', bubbles: true })), type);
    await section('keydown');
    await page.locator('.ws-hints-panel').waitFor();
    await page.keyboard.press('1');
    await section('keyup');
    await page.keyboard.press('g');
    await page.keyboard.press('3');

    // Demoting a P1 that is not due today takes it off Today; the notice says where it went.
    await page.locator('.ws-task-row', { hasText: 'Customer advisory board' }).click();
    await page.getByRole('group', { name: 'Priority' }).getByRole('button', { name: 'P2' }).click();
    await page.getByText('P2 · moved to Upcoming · ⌘Z to undo').waitFor();
    await page.locator('.ws-task-row', { hasText: 'Map direct reports' }).click();
    await page.getByRole('group', { name: 'Priority' }).getByRole('button', { name: 'P2' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.ws-row-group')].some((group) => group.textContent!.startsWith('P2') && group.textContent!.includes('Map direct reports')));
    expect(await calls()).toEqual([
      ['setTaskPriority', 'greenfield', 1], ['setTaskPriority', 'cognition', 2], ['setTaskPriority', 'cognition', null],
      ['setTaskPriority', 'harborlight', 2], ['setTaskPriority', 'people', 2],
    ]);

    // ⌘K runs Claude's prioritization over everything; quick add takes !1.
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('prioritize');
    await page.getByRole('option', { name: /Prioritize with Claude/ }).waitFor();
    await page.keyboard.press('Enter');
    await page.getByText('Prioritizing 3 tasks…').waitFor();
    const field = page.getByRole('textbox', { name: 'New task', exact: true });
    await field.fill('Send board pack follow-up !1 #board');
    await field.press('Enter');
    await page.waitForFunction(() => (window as any).fixture.calls.some((call: unknown[]) => call[0] === 'createTask'));
    expect((await calls()).find((call: unknown[]) => call[0] === 'createTask')[1]).toMatchObject({ title: 'Send board pack follow-up', label: 'board', priority: 1 });

    // Needs you keeps its status groups and shows the band as a chip.
    await page.getByRole('button', { name: 'Needs you' }).click();
    await page.getByRole('heading', { name: 'Needs you', level: 1 }).waitFor();
    expect(await page.locator('.ws-task-row', { hasText: 'Prep for Jobbsprånget' }).locator('.ws-priority').textContent()).toBe('P1');
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 90000);
