import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';
it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('files saved documents in personal and delegated workspaces and blocks copies when saving fails', async () => {
  const server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/release/**'] } } });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }); page.setDefaultTimeout(10000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    for (const personal of [false, true]) {
      await page.goto(`${server.resolvedUrls!.local[0]}design/mockups/task-detail-app.html?files=0&brainFiling${personal ? '&personal' : ''}`);
      await page.getByRole('button', { name: personal ? 'Inbox' : 'Needs you', exact: true }).click();
      await page.getByRole('button', { name: 'New document', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'New document', exact: true });
      await dialog.getByRole('textbox', { name: 'Filename', exact: true }).fill('Brain notes');
      await dialog.getByRole('textbox', { name: 'Filename', exact: true }).press('Enter');
      await dialog.waitFor({ state: 'hidden' });
      const prose = page.locator('.ws-document-prose[contenteditable="true"]');
      await page.evaluate(() => { (window as any).fixtureActions.failSave = true; });
      await prose.fill('Edited before filing');
      await page.getByRole('button', { name: 'File to brain', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Save the document before filing' }).waitFor();
      expect(await page.evaluate(() => (window as any).fixtureActions.filed)).toEqual([]);
      await page.evaluate(() => { (window as any).fixtureActions.failSave = false; });
      await page.getByRole('button', { name: 'File to brain', exact: true }).click();
      await page.getByText('Copied to /mock/brain/files/copied.md', { exact: true }).waitFor();
      const filed = await page.evaluate(() => (window as any).fixtureActions.filed);
      expect(filed).toHaveLength(1); expect(filed[0]).toMatchObject({ id: personal ? 'task' : 'thread', path: 'Brain notes.md', kind: 'document', content: expect.stringContaining('Edited before filing') });
      await page.setViewportSize({ width: 900, height: 700 }); await page.emulateMedia({ reducedMotion: 'reduce' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/aegir-brain-filing-${personal ? 'personal' : 'delegated'}.png`, fullPage: true });
    }
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 45_000);
