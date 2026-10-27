import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';
it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('edits, recovers and sends an inline email with one explicit approval in wide and compact layouts', async () => {
  const server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] }, server: { host: '127.0.0.1', port: 0 }, appType: 'custom' });
  server.middlewares.use('/email-fixture', (_req, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<div id="root"></div><script type="module" src="/src/ui/testing/gmail.tsx"></script>'); });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } }); page.setDefaultTimeout(8000);
    const errors: string[] = []; page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    await page.goto(`${server.resolvedUrls!.local[0]}email-fixture`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByText('Sending in 5 seconds…', { exact: true }).waitFor();
    expect(await page.getByLabel('Message', { exact: true }).isDisabled()).toBe(true);
    expect(await page.evaluate(() => (window as any).fixture.sendCalls)).toEqual([]);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(await page.getByLabel('Message', { exact: true }).isDisabled()).toBe(false);

    await page.getByLabel('Message', { exact: true }).fill('Hello\n\nThis is my edited reply.');
    await page.reload(); expect(await page.getByLabel('Message', { exact: true }).inputValue()).toBe('Hello\n\nThis is my edited reply.');
    await page.evaluate(() => { (window as any).fixture.fail = true; });
    await page.getByRole('button', { name: 'Save draft', exact: true }).click(); await page.getByRole('alert').filter({ hasText: 'Could not save' }).waitFor();
    expect(await page.getByLabel('Message', { exact: true }).inputValue()).toContain('edited reply');
    await page.evaluate(() => { (window as any).fixture.fail = false; });
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect.poll(() => page.getByRole('button', { name: 'Save draft', exact: true }).isDisabled()).toBe(true);
    await page.screenshot({ path: '/tmp/aegir-gmail-wide.png' });
    await page.getByLabel('To', { exact: true }).fill('another@example.com');
    await page.evaluate(() => { (window as any).fixture.compact(); });
    await expect.poll(() => page.locator('main').evaluate(element => element.clientWidth)).toBe(430); await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.screenshot({ path: '/tmp/aegir-gmail-compact.png' });
    expect(await page.evaluate(() => document.querySelector('main')!.scrollWidth <= 430)).toBe(true);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    expect(await page.getByLabel('To', { exact: true }).isDisabled()).toBe(true);
    expect(await page.getByRole('button', { name: 'Approve', exact: true }).count()).toBe(0);
    await page.getByText('Gmail confirmed sending.', { exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Send', exact: true }).count()).toBe(0);
    expect(await page.evaluate(() => (window as any).fixture.sendCalls)).toEqual([{ id: 'email-test', revision: 3, fields: { to: 'another@example.com', cc: '', bcc: '', subject: 'A draft with a longer subject to check narrow email layouts', body: 'Hello\n\nThis is my edited reply.' } }]);

    await page.reload();
    await page.getByLabel('Message', { exact: true }).fill('I sent this separately.');
    await page.getByRole('button', { name: 'I sent it myself', exact: true }).click();
    await page.getByText('You marked this as sent yourself. Aegir did not send it.', { exact: true }).waitFor();
    expect(await page.evaluate(() => (window as any).fixture.draft)).toMatchObject({ state: 'sent-manually', body: 'I sent this separately.' });
    expect(await page.evaluate(() => (window as any).fixture.sendCalls)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 45_000);
