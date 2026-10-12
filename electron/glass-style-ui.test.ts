import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Glass step 1 (11 Oct 2026): Apple's system font, the neutral palette with lime as the accent, the sidebar and the
// working area as rounded panes. Guards against the old Lime Glass greys, the slate blue and the old fonts creeping back.
const oldColours = ['rgb(89, 103, 83)', 'rgb(107, 120, 102)', 'rgb(69, 82, 63)', 'rgb(51, 65, 47)', 'rgb(124, 136, 118)',
  'rgb(212, 220, 203)', 'rgb(83, 107, 145)', 'rgb(237, 248, 210)', 'rgb(252, 253, 249)'];
const oldFonts = ['inter', 'manrope', 'dm sans', 'onest'];

it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('draws every screen in the system font and the new palette, with floating panes', async () => {
  const server = await createServer({
    configFile: false, esbuild: { jsx: 'automatic' }, appType: 'custom',
    // node_modules can be a symlink (a git worktree): allow its real folder, keep one React, keep the cache private.
    server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd(), realpathSync('node_modules')] } },
    resolve: { dedupe: ['react', 'react-dom'] }, cacheDir: join(tmpdir(), 'aegir-glass-style-smoke'),
  });
  server.middlewares.use('/glass-mockup', (_req, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<div id="root"></div><script type="module" src="/src/ui/testing/glass-mockup.tsx"></script>');
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const url = `${server.resolvedUrls!.local[0]}glass-mockup`;
    // A cold first load makes Vite optimise dependencies and reload the page, so start from a settled second load.
    await page.goto(url);
    await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor({ timeout: 30_000 }).catch(() => {});
    await page.goto(url);
    await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor({ timeout: 30_000 });
    errors.length = 0;

    // Every visible element: no old colour in its text, fill or border, and no old font first in its stack.
    const leftovers = () => page.evaluate(({ colours, fonts }) => [...document.querySelectorAll('body *')].flatMap((element) => {
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height) return [];
      const style = getComputedStyle(element);
      const used = [style.color, style.backgroundColor, style.borderTopColor, style.borderLeftColor];
      const first = style.fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
      const name = `${element.tagName.toLowerCase()}.${[...element.classList].join('.')}`;
      return [...used.filter((colour) => colours.includes(colour)).map((colour) => `${name} ${colour}`),
        ...(fonts.includes(first) ? [`${name} font ${first}`] : [])];
    }), { colours: oldColours, fonts: oldFonts });

    expect(await leftovers()).toEqual([]);
    // The panes: the sidebar floats inside an 8 px frame with large corners; the working area is one white pane.
    const panes = await page.evaluate(() => {
      const sidebar = document.querySelector('.ws-sidebar')!; const main = document.querySelector('.ws-main')!;
      const s = sidebar.getBoundingClientRect(); const m = main.getBoundingClientRect();
      return { sidebar: [s.x, s.y, getComputedStyle(sidebar).borderTopLeftRadius], main: [m.x, m.y, getComputedStyle(main).backgroundColor],
        frame: getComputedStyle(document.querySelector('.ws-shell')!).backgroundColor };
    });
    expect(panes).toEqual({ sidebar: [8, 8, '18px'], main: [260, 8, 'rgb(255, 255, 255)'], frame: 'rgb(232, 232, 237)' });

    // The same with a task open, ⌘K, the date picker and a document open.
    await page.locator('[data-task-row]', { hasText: 'Follow up with Nordvik' }).click();
    await page.getByRole('article', { name: /Email draft/ }).first().waitFor();
    expect(await leftovers()).toEqual([]);
    // Glass step 3: the message box is glass and floats over the end of the conversation.
    const surface = (selector: string) => page.evaluate((target) => {
      const style = getComputedStyle(document.querySelector(target)!);
      return { blur: style.backdropFilter, alpha: Number((style.backgroundColor.match(/rgba?\(([^)]*)\)/)![1].split(',')[3] ?? '1').trim()) };
    }, selector);
    expect(await surface('.ws-composer')).toMatchObject({ blur: expect.stringContaining('blur('), alpha: expect.any(Number) });
    expect((await surface('.ws-composer')).alpha).toBeLessThan(1);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.ws-messages + .ws-composer-wrap')!).marginTop)).toBe('-36px');
    await page.keyboard.press('Meta+K');
    await page.getByRole('dialog', { name: 'Command palette' }).waitFor();
    expect(await leftovers()).toEqual([]);
    // ⌘K is glass: blurred, see-through. With macOS Reduce transparency it turns solid.
    const palette = await surface('.ws-palette');
    expect(palette.blur).toContain('blur(');
    expect(palette.alpha).toBeLessThan(1);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
    expect(await surface('.ws-palette')).toEqual({ blur: 'none', alpha: 1 });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] });
    await page.keyboard.press('Escape');
    await page.locator('[data-task-row]', { hasText: 'Answer Tove' }).click();
    await page.keyboard.press('Escape');
    await page.locator('[data-task-row]', { hasText: 'Answer Tove' }).focus();
    await page.keyboard.press('d');
    await page.getByRole('dialog', { name: 'Set due date' }).waitFor();
    expect(await leftovers()).toEqual([]);
    expect((await surface('.ws-modal .ws-popover')).blur).toContain('blur(');
    await page.getByRole('textbox', { name: 'When' }).press('Escape');
    await page.getByRole('dialog', { name: 'Set due date' }).waitFor({ state: 'detached' });
    await page.locator('[data-task-row]', { hasText: 'Follow up with Nordvik' }).click();
    await page.locator('[data-document-files]').click();
    await page.locator('.ws-document-file-open').first().click();
    await page.locator('.document-open').waitFor();
    expect(await leftovers()).toEqual([]);
    // Document mode: the toolbar sits on the window frame, and search in the narrow rail is an icon.
    expect(await page.evaluate(() => [getComputedStyle(document.querySelector('.ws-editing-head')!).backgroundColor,
      (document.querySelector('.ws-sidebar-search') as HTMLElement).scrollWidth <= (document.querySelector('.ws-sidebar-search') as HTMLElement).clientWidth]))
      .toEqual(['rgb(232, 232, 237)', true]);

    // Glass step 2: in a macOS glass window (html.ws-vibrant) the page and the frame are transparent so the native
    // material shows; the sidebar is a light tint over it, and the working area stays solid white.
    await page.evaluate(() => document.documentElement.classList.add('ws-vibrant'));
    const glass = await page.evaluate(() => {
      const bg = (selector: string) => getComputedStyle(document.querySelector(selector)!).backgroundColor;
      return { html: bg('html'), body: bg('body'), shell: bg('.ws-shell'), toolbar: bg('.ws-editing-head'), sidebar: bg('.ws-sidebar'), main: bg('.ws-main'),
        blur: getComputedStyle(document.querySelector('.ws-sidebar')!).backdropFilter };
    });
    expect(glass).toMatchObject({ html: 'rgba(0, 0, 0, 0)', body: 'rgba(0, 0, 0, 0)', shell: 'rgba(0, 0, 0, 0)', toolbar: 'rgba(0, 0, 0, 0)', main: 'rgb(255, 255, 255)', blur: 'none' });
    expect(glass.sidebar).toMatch(/^rgba\(255, 255, 255, 0\.12/);
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 90000);
