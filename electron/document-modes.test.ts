import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// AEGIR_EDITOR_SMOKE=1 pnpm test electron/document-modes.test.ts
it.skipIf(process.env.AEGIR_EDITOR_SMOKE !== '1')('keeps writing modes in place and centers visual lines across layouts', async () => {
  const server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/release/**'] } }, appType: 'custom' });
  server.middlewares.use('/modes-test', (_req, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<div id="root"></div><script type="module" src="/src/ui/testing/document-modes.tsx"></script>');
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    for (const task of [false, true]) {
      await page.goto(`${server.resolvedUrls!.local[0]}modes-test${task ? '?task=1' : ''}`);
      await page.waitForFunction(() => Boolean((document.querySelector('.tiptap') as any)?.editor));
      await page.evaluate(() => { (window as any).editor = (document.querySelector('.tiptap') as any).editor; });
      const focus = page.getByRole('button', { name: 'Focus mode', exact: true });
      const typewriter = page.getByRole('button', { name: 'Typewriter mode', exact: true });
      const centered = async () => {
        await expect.poll(() => page.evaluate(() => {
          const editor = (window as any).editor;
          const caret = editor.view.coordsAtPos(editor.state.selection.head);
          const scroll = document.querySelector('.ws-document-scroll')!.getBoundingClientRect();
          return Math.abs((caret.top + caret.bottom - scroll.top - scroll.bottom) / 2);
        })).toBeLessThan(2);
      };
      const select = async (position: number | 'end') => {
        await page.evaluate(position => { const editor = (window as any).editor; editor.commands.focus(position); }, position);
        await centered();
      };
      await typewriter.click();
      await select(1); // The first line can reach the center.
      await select(190); // A visual line inside a wrapped paragraph.
      await page.keyboard.type('New words');
      await centered();
      await page.keyboard.press('ArrowDown');
      await centered();
      await select('end');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Last line');
      await centered();
      await focus.click();
      await expect.poll(() => focus.getAttribute('aria-pressed')).toBe('true');
      expect(await page.locator('.ws-document').boundingBox()).toEqual({ x: 0, y: 0, width: 1400, height: 900 });
      expect(await page.locator('.ws-thread').isVisible()).toBe(false);
      expect(await page.locator('.ws-sidebar').isVisible()).toBe(false);
      expect(await page.evaluate(() => (document.querySelector('.tiptap') as any).editor === (window as any).editor)).toBe(true);
      await centered();
      await page.keyboard.press('F6');
      expect(await page.getByRole('textbox', { name: 'Document', exact: true }).evaluate(el => el === document.activeElement)).toBe(true);
      await page.setViewportSize({ width: 900, height: 600 });
      await centered();
      await select(190);
      await page.screenshot({ path: `/tmp/aegir-writing-${task ? 'task' : 'group'}-focus.png` });
      // Manual reading does not snap back; moving the caret resumes centering.
      await page.evaluate(() => { document.querySelector('.ws-document-scroll')!.scrollTop += 180; });
      const manualScroll = await page.locator('.ws-document-scroll').evaluate(el => el.scrollTop);
      await page.waitForTimeout(100);
      expect(await page.locator('.ws-document-scroll').evaluate(el => el.scrollTop)).toBe(manualScroll);
      await page.keyboard.press('ArrowRight');
      await centered();
      // Selecting a passage does not pull the viewport away from the selection.
      const beforeSelection = await page.locator('.ws-document-scroll').evaluate(el => el.scrollTop);
      await page.evaluate(() => (window as any).editor.commands.setTextSelection({ from: 190, to: 240 }));
      await page.waitForTimeout(100);
      expect(await page.locator('.ws-document-scroll').evaluate(el => el.scrollTop)).toBe(beforeSelection);
      await expect.poll(() => focus.getAttribute('aria-pressed')).toBe('true');
      await page.keyboard.press('ArrowRight');
      await centered();
      await page.keyboard.press('Escape');
      await expect.poll(() => focus.getAttribute('aria-pressed')).toBe('false');
      await expect.poll(() => typewriter.getAttribute('aria-pressed')).toBe('true');
      await centered();
      await typewriter.click();
      await expect.poll(() => typewriter.getAttribute('aria-pressed')).toBe('false');
      expect(await page.locator('.ws-document-scroll').evaluate(el => el.style.getPropertyValue('--document-typewriter-space'))).toBe('');
      await page.setViewportSize({ width: 1400, height: 900 });
      expect(await page.getByRole('textbox', { name: 'Message' }).inputValue()).toBe('Keep my chat draft');
      await page.screenshot({ path: `/tmp/aegir-writing-${task ? 'task' : 'group'}-split.png` });
      await page.waitForFunction(() => (window as any).saved().content.includes('Last line'));
      // Legolas leaves typed text as typed: "--" never becomes an em dash (Malcolm's writing rule bans them).
      const prose = page.getByRole('textbox', { name: 'Document', exact: true });
      await page.evaluate(() => { const editor = (window as any).editor; editor.commands.setContent('Existing -- text', { contentType: 'markdown' }); editor.commands.focus('end'); });
      await page.keyboard.type(' --');
      expect(await prose.innerText()).toBe('Existing -- text --');
      // An empty document uses the same modes safely.
      await page.evaluate(() => (window as any).editor.commands.setContent('', { contentType: 'markdown' }));
      await typewriter.click();
      await select(1);
      await page.keyboard.type('A fresh start');
      await centered();
      await page.keyboard.press('Escape');
      await expect.poll(() => page.locator('.ws-document').count()).toBe(0);
      expect(await page.evaluate(() => (window as any).saved().content)).toBe('A fresh start');
    }
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 60000);
