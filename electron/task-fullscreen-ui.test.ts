import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium, type Page } from 'playwright';

// Electron drags the window from elements marked -webkit-app-region: drag. Chromium adds each marked element's box
// (drag) or removes it (no-drag) in document order, so the last marked box under a point decides. This replays that.
const draggable = (page: Page, points: [number, number][]) => page.evaluate((list) => {
  const regions = [...document.querySelectorAll('*')].flatMap((el) => {
    const mode = getComputedStyle(el).getPropertyValue('-webkit-app-region');
    if (mode !== 'drag' && mode !== 'no-drag') return [];
    const r = el.getBoundingClientRect();
    return [{ drag: mode === 'drag', r }];
  });
  return list.map(([x, y]) => regions.reduce((on, { drag, r }) => (x >= r.left && x < r.right && y >= r.top && y < r.bottom ? drag : on), false));
}, points);
const centre = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => {
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2] as [number, number];
});
const layout = (page: Page) => page.evaluate(() => {
  const detail = document.querySelector<HTMLElement>('.ws-task-detail')!;
  const head = document.querySelector<HTMLElement>('.ws-task-detail .ws-detail-head')!;
  const title = document.querySelector<HTMLElement>('.ws-task-title-input')!.getBoundingClientRect();
  const style = getComputedStyle(head);
  return {
    window: window.innerWidth, detail: Math.round(detail.getBoundingClientRect().width), overflow: detail.scrollWidth - detail.clientWidth,
    left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight), titleRight: Math.round(title.right),
  };
});

it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('drags the window from the task header, and keeps a full-screen task centred at any window width', async () => {
  const server = await createServer({
    configFile: false, esbuild: { jsx: 'automatic' }, appType: 'custom',
    // node_modules can be a symlink (a git worktree): allow its real folder, keep one React, keep the cache private.
    server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd(), realpathSync('node_modules')] } },
    resolve: { dedupe: ['react', 'react-dom'] }, cacheDir: join(tmpdir(), 'aegir-task-fullscreen-smoke'),
  });
  server.middlewares.use('/task-fullscreen', (_req, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<div id="root"></div><script type="module" src="/src/ui/testing/task-fullscreen.tsx"></script>');
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    // A cold first load makes Vite optimise dependencies and reload the page, so start from a settled second load.
    await page.goto(`${server.resolvedUrls!.local[0]}task-fullscreen`);
    await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor({ timeout: 30_000 }).catch(() => {});
    await page.goto(`${server.resolvedUrls!.local[0]}task-fullscreen`);
    await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor({ timeout: 30_000 });
    errors.length = 0;
    await page.locator('.ws-task-row', { hasText: 'Raise the bar' }).click();
    await page.locator('.ws-task-detail .ws-detail-head').waitFor();

    // Beside the list, the task panel's header drags too: its top edge and the gap in its top row.
    const [panelTop] = await draggable(page, [[1300, 4]]);
    expect(panelTop).toBe(true);

    await page.locator('.ws-rows').focus();
    await page.keyboard.press('f');
    await page.getByRole('button', { name: /Exit full screen/ }).waitFor();
    await page.screenshot({ path: '/tmp/legolas-fullscreen-wide.png' });

    // Full screen: the whole top edge drags, corners included, and so does the gap between the top row's controls.
    const link = (await page.locator('.ws-task-thread-link').boundingBox())!;
    const toggle = (await page.locator('.ws-focus-toggle').boundingBox())!;
    const gap: [number, number] = [(link.x + link.width + toggle.x) / 2, toggle.y + toggle.height / 2];
    expect(await draggable(page, [[20, 4], [400, 4], [720, 4], [1100, 4], [1420, 4], [20, 40], [1432, 60], [1420, 20], gap])).toEqual(Array(9).fill(true));
    // Controls and fields stay clickable.
    const controls = await Promise.all(['.ws-task-thread-link', '.ws-focus-toggle', '.ws-task-title-input', '.ws-priority-choice', '.ws-detail-actions .ws-btn, .ws-detail-controls button', '.ws-context summary']
      .map((selector) => centre(page, selector)));
    expect(await draggable(page, controls)).toEqual(Array(controls.length).fill(false));

    // Centred: the panel is the window's width, the reading column sits in the middle, nothing spills over.
    expect(await layout(page)).toMatchObject({ window: 1440, detail: 1440, overflow: 0, left: 200, right: 200 });
    // Narrower than the longest line (the one-line context, 7 Oct 2026): the panel shrinks with the window, down to its
    // 950 px minimum.
    await page.setViewportSize({ width: 960, height: 900 });
    await page.waitForTimeout(100);
    const narrow = await layout(page);
    expect(narrow).toMatchObject({ window: 960, detail: 960, overflow: 0, left: 24, right: 24 });
    expect(narrow.titleRight).toBeLessThanOrEqual(960 - 24 + 7);
    await page.screenshot({ path: '/tmp/legolas-fullscreen-narrow.png' });
    expect(await draggable(page, [[20, 4], [480, 4], [940, 4]])).toEqual([true, true, true]);
    await page.setViewportSize({ width: 1700, height: 900 });
    await page.waitForTimeout(100);
    expect(await layout(page)).toMatchObject({ window: 1700, detail: 1700, overflow: 0, left: 330, right: 330 });
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 90000);
