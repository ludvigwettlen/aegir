import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('guides setup, recovers failures, cancels login, and fits compact windows', async () => {
  const server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'zod'] }, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/release/**', '**/build/**'] } }, appType: 'custom' });
  server.middlewares.use('/setup-fixture', (_req, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<div id="root"></div><script type="module" src="/src/ui/testing/onboarding.tsx"></script>'); });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(7000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls!.local[0]}setup-fixture`);
    await page.getByRole('heading', { name: 'Connect your AI' }).waitFor();
    await page.screenshot({ path: '/tmp/aegir-onboarding-codex.png' });
    await page.getByRole('button', { name: 'Install Codex', exact: true }).click();
    expect(await page.getByRole('button', { name: 'Set up later' }).isDisabled()).toBe(true);
    await page.getByRole('button', { name: 'Sign in with ChatGPT' }).click();
    await page.getByText('Finish signing in in your browser, then return to Aegir.').waitFor();
    await page.getByRole('button', { name: 'Cancel sign-in' }).click();
    await page.getByRole('button', { name: 'Sign in with ChatGPT' }).click();
    await page.evaluate(() => (window as any).fixture.loginComplete());
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('heading', { name: 'Give it a memory' }).waitFor();
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('setup-heading');
    await page.getByRole('button', { name: 'Set up memory', exact: true }).click();
    await page.getByText('Setup could not finish.', { exact: false }).waitFor();
    await page.screenshot({ path: '/tmp/aegir-onboarding-memory-error.png' });
    await page.evaluate(() => { (window as any).fixture.failMemory = false; });
    await page.getByRole('button', { name: 'Set up memory', exact: true }).click();
    await page.getByText('Memory is installed and tested.').waitFor();
    await page.screenshot({ path: '/tmp/aegir-onboarding-memory.png' });
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Connect Notion' }).click();
    expect(await page.evaluate(() => (window as any).fixture.connected)).toEqual(['notion']);
    await page.setViewportSize({ width: 950, height: 620 }); await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.screenshot({ path: '/tmp/aegir-onboarding-connections.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByText('Composio connection options', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Expected Composio Slack account ID (optional)', exact: true }).fill('office-workspace');
    expect(await page.getByRole('textbox', { name: 'Slack client ID', exact: true }).count()).toBe(0);
    expect(await page.getByRole('textbox', { name: 'Slack client secret', exact: true }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Connect office Slack app' }).count()).toBe(0);
    await page.getByRole('button', { name: 'Connect Slack', exact: true }).click();
    expect(await page.evaluate(() => (window as any).fixture.connected)).toEqual(['notion', 'composio']);
    await page.getByText('Composio connection options', { exact: true }).click();
    await page.setViewportSize({ width: 680, height: 700 });
    await page.screenshot({ path: '/tmp/aegir-onboarding-compact.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Start using Aegir' }).click();
    expect(await page.evaluate(() => (window as any).fixture.closed)).toBe(true);
    expect(await page.evaluate(() => (window as any).fixture.state.completed)).toBe(true);

    {
      await page.goto(`${server.resolvedUrls!.local[0]}setup-fixture?memory=mnemosyne`);
      await page.getByRole('textbox', { name: 'Search memories', exact: true }).fill('decision');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await page.getByText('A remembered decision', { exact: true }).waitFor();
      expect(await page.getByRole('button', { name: 'Correct', exact: true }).count()).toBe(1);
      expect(await page.getByRole('button', { name: 'Forget memory', exact: true }).count()).toBe(1);
      expect(await page.getByText(/earlier memories are waiting/).count()).toBe(1);
    }
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 60000);
