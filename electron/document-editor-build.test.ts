import { expect, it } from 'vitest';
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('opens, focuses and edits empty Markdown pages in the production bundle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aegir-editor-build-'));
  let server: Awaited<ReturnType<typeof preview>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const input = resolve('index.html');
    const outDir = join(directory, 'dist');
    await build({ configFile: false, logLevel: 'error', esbuild: { jsx: 'automatic', jsxDev: false },
      plugins: [{ name: 'document-fixture', transformIndexHtml: { order: 'pre', handler: html => html.replace('/src/main.tsx', '/src/ui/testing/window-header.tsx') } }],
      define: { 'process.env.NODE_ENV': '"production"' },
      build: { target: 'esnext', outDir, emptyOutDir: true, rollupOptions: { input } } });
    server = await preview({ configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(7000);
    const errors: string[] = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    await page.goto(server.resolvedUrls!.local[0]);
    await page.getByRole('button', { name: 'Needs you', exact: true }).click();
    await page.getByRole('button', { name: 'Open pm-level-boundaries-proposal.md', exact: true }).click();
    const prose = page.getByRole('textbox', { name: 'Document', exact: true });
    await expect.poll(() => prose.innerText()).toContain('PM level boundaries');
    await prose.press('ControlOrMeta+End');
    await prose.press('Enter');
    await prose.pressSequentially('Saved from the production editor');
    await expect.poll(() => page.evaluate(() => (window as any).fixtureActions.files[0].content)).toContain('Saved from the production editor');
    // Reopen a blank file as created by an agent. Opening it must allow immediate typing.
    await page.getByRole('button', { name: 'Back to list', exact: true }).click();
    await page.evaluate(() => { (window as any).fixtureActions.files[0].content = ''; });
    await page.getByRole('button', { name: 'Open pm-level-boundaries-proposal.md', exact: true }).click();
    await prose.waitFor();
    await expect.poll(() => prose.evaluate(element => element === document.activeElement)).toBe(true);
    await page.getByRole('button', { name: 'Copy document', exact: true }).focus();
    // Click the blank page itself: locator.press/fill would focus even a collapsed editor.
    const viewport = page.locator('.ws-document-scroll');
    const box = (await viewport.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect(await prose.evaluate(element => element === document.activeElement)).toBe(true);
    await page.keyboard.type('A fresh document');
    await expect.poll(() => page.evaluate(() => (window as any).fixtureActions.files[0].content)).toBe('A fresh document');
    await page.keyboard.press('Shift+Home');
    expect(await page.evaluate(() => getSelection()?.toString())).toBe('A fresh document');
    await page.keyboard.press('Backspace');
    await expect.poll(() => page.evaluate(() => (window as any).fixtureActions.files[0].content)).toBe('');
    await page.setViewportSize({ width: 900, height: 650 });
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    const compact = (await viewport.boundingBox())!;
    await page.mouse.click(compact.x + compact.width / 2, compact.y + compact.height / 2);
    expect(await prose.evaluate(element => element === document.activeElement)).toBe(true);
    await page.keyboard.type('Ready to write');
    await expect.poll(() => page.evaluate(() => (window as any).fixtureActions.files[0].content)).toBe('Ready to write');
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server) await new Promise<void>((resolve, reject) => server!.httpServer.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);
