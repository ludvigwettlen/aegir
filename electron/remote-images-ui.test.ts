import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('requests chat images only after a click and requires consent for changed sources and reloads', async () => {
  let requests = 0;
  const server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0 }, appType: 'custom' });
  server.middlewares.use('/remote-images-test', (_req, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<html><body><div id="root"></div><script type="module" src="/src/ui/testing/remote-images.tsx"></script></body></html>');
  });
  server.middlewares.use((request, response, next) => {
    if (!/^\/(first|second)\.png$/.test(request.url || '')) return next();
    requests++;
    response.setHeader('Content-Type', 'image/png');
    response.setHeader('Cache-Control', 'no-store');
    response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/r8AAAAASUVORK5CYII=', 'base64'));
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage(); page.setDefaultTimeout(5000);
    await page.goto(`${server.resolvedUrls!.local[0]}remote-images-test`);
    await page.getByRole('button', { name: 'Load remote image' }).waitFor();
    expect(requests).toBe(0);
    expect(await page.locator('img').count()).toBe(0);
    await page.getByRole('button', { name: 'Load remote image' }).click();
    await expect.poll(() => requests).toBe(1);
    await page.getByRole('button', { name: 'Change image' }).click();
    await page.getByRole('button', { name: 'Load remote image' }).waitFor();
    expect(requests).toBe(1);
    expect(await page.locator('img').count()).toBe(0);
    await page.getByRole('button', { name: 'Load remote image' }).click();
    await expect.poll(() => requests).toBe(2);
    await page.getByRole('button', { name: 'Change image' }).click();
    await page.getByRole('button', { name: 'Load remote image' }).waitFor();
    expect(await page.locator('img').count()).toBe(0);
    expect(requests).toBe(2);
    await page.reload();
    await page.getByRole('button', { name: 'Load remote image' }).waitFor();
    expect(requests).toBe(2);
  } finally { await browser?.close(); await server.close(); }
}, 30_000);
