import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';
it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('uses floating Glass panes, native transparency and an accessible solid fallback without replacing fonts', async () => {
  const server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/release/**'] } }, appType: 'custom' });
  server.middlewares.use('/glass-test', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<div id="root"></div><script type="module" src="/src/ui/testing/legolas-integration.tsx"></script>'); });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }); page.setDefaultTimeout(10000);
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${server.resolvedUrls!.local[0]}glass-test`);
    await page.getByRole('button', { name: 'Needs you', exact: true }).click();
    const surface = (selector: string) => page.locator(selector).evaluate(el => {
      const s = getComputedStyle(el), box = el.getBoundingClientRect();
      return { x: box.x, y: box.y, radius: s.borderTopLeftRadius, bg: s.backgroundColor, blur: s.backdropFilter, font: s.fontFamily };
    });
    expect(await surface('.ws-sidebar')).toMatchObject({ x: 8, y: 8, radius: '18px' });
    expect(await surface('.ws-main')).toMatchObject({ x: 260, y: 8, bg: 'rgb(255, 255, 255)' });
    expect((await surface('.ws-shell')).bg).toBe('rgb(232, 232, 237)');
    expect((await surface('.ws-shell')).font).toContain('Inter');
    expect((await surface('.ws-composer')).blur).toContain('blur(');
    await page.screenshot({ path: '/tmp/aegir-glass-workspace.png' });
    await page.getByRole('button', { name: 'Search tasks and commands', exact: true }).click();
    await page.getByRole('dialog', { name: 'Command palette' }).waitFor();
    expect((await surface('.ws-palette')).bg).toMatch(/^rgba\(/);
    expect((await surface('.ws-palette')).blur).toContain('blur(');
    await page.screenshot({ path: '/tmp/aegir-glass-palette.png' });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
    expect(await surface('.ws-palette')).toMatchObject({ bg: 'rgb(250, 250, 252)', blur: 'none' });
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.documentElement.classList.add('ws-vibrant'));
    expect((await surface('.ws-shell')).bg).toBe('rgb(232, 232, 237)');
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] });
    expect((await surface('.ws-shell')).bg).toBe('rgba(0, 0, 0, 0)');
    expect((await surface('.ws-sidebar')).blur).toBe('none');
    expect((await surface('.ws-main')).bg).toBe('rgb(255, 255, 255)');
    await page.getByRole('button', { name: 'Open pm-level-boundaries-proposal.md', exact: true }).click();
    expect((await surface('.ws-document-workspace-head')).bg).toBe('rgba(0, 0, 0, 0)');
    await page.setViewportSize({ width: 950, height: 650 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '/tmp/aegir-glass-document.png' });
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 60000);
