import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('creates and edits repetition with loading, failure, keyboard and compact states', async () => {
  const server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] }, server: { host: '127.0.0.1', port: 0 }, appType: 'custom' });
  server.middlewares.use('/task-recurrence', (_req, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<div id="root"></div><script type="module" src="/src/ui/testing/task-lists.tsx"></script>');
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls!.local[0]}task-recurrence`);
    const repeat = page.getByRole('combobox', { name: 'Repeat task' });
    await repeat.waitFor();
    expect(await repeat.inputValue()).toBe('');
    await page.evaluate(() => { (window as any).fixture.fail = true; });
    await repeat.selectOption('weekly');
    await page.getByRole('alert').filter({ hasText: 'Could not save list' }).waitFor();
    expect(await repeat.inputValue()).toBe('');
    await page.evaluate(() => { (window as any).fixture.fail = false; (window as any).fixture.delay = 400; });
    await repeat.selectOption('weekly');
    await page.getByRole('status').filter({ hasText: 'Saving' }).waitFor();
    expect(await repeat.isDisabled()).toBe(true);
    await expect.poll(() => repeat.inputValue()).toBe('weekly');
    await page.getByLabel('Repeats weekly').waitFor();
    await page.screenshot({ path: '/tmp/aegir-recurring-wide.png' });
    await repeat.selectOption('');
    await expect.poll(() => repeat.inputValue()).toBe('');
    expect(await page.getByLabel('Repeats weekly').count()).toBe(0);
    await page.getByRole('textbox', { name: 'New task' }).fill('Review every month #work');
    await page.keyboard.press('Enter');
    await page.getByLabel('Repeats monthly').waitFor();
    await expect.poll(() => repeat.inputValue()).toBe('monthly');
    await page.setViewportSize({ width: 950, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await repeat.focus();
    expect(await repeat.evaluate(element => element === document.activeElement)).toBe(true);
    await page.screenshot({ path: '/tmp/aegir-recurring-compact.png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('[data-task-row][data-keyboard-current]').focus();
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Completed', exact: true }).click();
    await repeat.waitFor();
    expect(await repeat.isDisabled()).toBe(true);
    await page.getByText('Change future repeats on the next occurrence.').waitFor();
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 60000);
