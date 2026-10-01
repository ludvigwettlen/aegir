import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Real pointer capture, table selections, Markdown reload, and autosave.
// AEGIR_EDITOR_SMOKE=1 pnpm test electron/document-tables.test.ts
it.skipIf(process.env.AEGIR_EDITOR_SMOKE !== '1')('edits tables with edge controls and preserves header choice through save/reopen', async () => {
  const server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0 }, appType: 'custom' });
  server.middlewares.use('/table-test', async (_req, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<style>body{margin:0;font-family:system-ui;color:#1f2b1d}#host{height:100vh;display:flex}*{box-sizing:border-box}</style><div id="host"></div><script type="module" src="/src/ui/testing/document-tables.tsx"></script>');
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls!.local[0]}table-test`);
    await page.waitForFunction(() => Boolean((document.querySelector('.ws-document-prose') as any)?.editor));
    await page.evaluate(() => { (window as any).editor = (document.querySelector('.ws-document-prose') as any).editor; });
    const table = page.locator('.ws-editable-table').first();
    const rows = () => table.locator('tr').count();
    const columns = () => table.locator('tr').first().locator('td, th').count();
    const source = () => page.evaluate(() => (window as any).editor.getMarkdown());
    const original = await source();
    const undo = () => page.evaluate(() => (window as any).editor.commands.undo());
    const drag = async (axis: 'row' | 'column', distance: number, cancel = false) => {
      const control = table.getByRole('button', { name: `Add ${axis}`, exact: true });
      await control.scrollIntoViewIfNeeded();
      const box = (await control.boundingBox())!;
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x + (axis === 'column' ? distance : 0), y + (axis === 'row' ? distance : 0), { steps: 5 });
      if (!cancel && distance > 0) expect(await table.locator('.ws-table-drag-hint').textContent()).toBe(`Add ${Math.ceil(distance / (axis === 'row' ? 36 : 96))} ${axis}s`);
      if (cancel) await page.keyboard.press('Escape');
      await page.mouse.up();
    };
    expect(await rows()).toBe(3);
    await table.hover();
    await table.getByRole('button', { name: 'Add row', exact: true }).click();
    expect(await rows()).toBe(4);
    await table.getByRole('button', { name: 'Add column', exact: true }).click();
    expect(await columns()).toBe(4);
    expect(await page.locator('table').nth(1).locator('tr').count()).toBe(2);
    expect(await page.locator('table').nth(1).innerText()).toContain('Untouched');
    await undo(); expect(await columns()).toBe(3);
    await undo(); expect(await rows()).toBe(3);
    await drag('row', 90); expect(await rows()).toBe(6);
    await undo(); expect(await rows()).toBe(3); // One gesture is one undo step.
    expect(await columns()).toBe(3);
    await drag('column', 150); expect(await columns()).toBe(5);
    expect(await table.locator('tr').nth(2).locator('td').first().innerText()).toBe('Writing');
    expect(await page.locator('table').count()).toBe(2);
    await undo(); expect(await columns()).toBe(3);
    expect((await source()).trimEnd()).toBe(original.trimEnd());
    await drag('row', 75, true); expect(await rows()).toBe(3);
    await drag('column', -40); expect(await columns()).toBe(3);
    // Keyboard activation of the same controls requires no drag.
    const addRow = table.getByRole('button', { name: 'Add row', exact: true });
    await addRow.focus(); await page.keyboard.press('Enter'); expect(await rows()).toBe(4);
    await undo();
    await table.getByRole('button', { name: 'Select first row' }).click();
    expect(await table.locator('tr').first().locator('.selectedCell').count()).toBe(3);
    const toggle = table.getByRole('button', { name: 'Toggle header row' });
    expect(await toggle.getAttribute('aria-pressed')).toBe('true');
    await toggle.click();
    expect(await table.locator('th').count()).toBe(0);
    expect(await toggle.getAttribute('aria-pressed')).toBe('false');
    expect(await source()).toContain('<!-- aegir:table-header=off -->');
    expect(await source()).toContain('**Research**');
    await page.waitForFunction(() => (window as any).saved().content.includes('<!-- aegir:table-header=off -->'));
    await page.evaluate(() => (window as any).editor.commands.setContent((window as any).saved().content, { contentType: 'markdown', emitUpdate: false }));
    expect(await table.locator('th').count()).toBe(0); expect(await rows()).toBe(3);
    expect(await table.locator('tr').first().innerText()).toContain('Workstream');
    await table.getByRole('button', { name: 'Select first row' }).click();
    await toggle.click();
    expect(await table.locator('th').count()).toBe(3);
    expect(await source()).not.toContain('<!-- aegir:table-header=off -->');
    // Narrow panes keep wide tables and their controls inside a scroll area.
    await page.setViewportSize({ width: 460, height: 740 });
    await table.hover();
    await table.getByRole('button', { name: 'Add column', exact: true }).click();
    expect(await columns()).toBe(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '/tmp/aegir-table-compact.png' });
    await page.setViewportSize({ width: 1000, height: 800 });
    await table.getByRole('button', { name: 'Select first row' }).click();
    await page.screenshot({ path: '/tmp/aegir-table-wide.png' });
    // Reload through the real component, including unsupported/read-only transitions.
    await page.waitForFunction(() => (window as any).saved().content === (window as any).editor.getMarkdown());
    await page.evaluate(() => { (window as any).changeDisk((window as any).initial + '\n\n<div>Unsupported HTML</div>'); window.dispatchEvent(new Event('focus')); });
    await page.waitForFunction(() => !(window as any).editor.isEditable);
    expect(await table.locator('.ws-table-add-row').isVisible()).toBe(false);
    await page.evaluate(() => { (window as any).changeDisk((window as any).initial); window.dispatchEvent(new Event('focus')); });
    await page.waitForFunction(() => (window as any).editor.isEditable);
    expect(await rows()).toBe(3);
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 60000);
