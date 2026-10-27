import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('marks reviewed through the toolbar and palette, preserves open work, supports undo and handles failures', async () => {
  const server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] }, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/release/**'] } } });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }); page.setDefaultTimeout(10000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls!.local[0]}design/mockups/task-detail-app.html?notes&files=1`);
    await page.getByRole('button', { name: 'Needs you', exact: true }).click();
    const review = page.getByRole('button', { name: 'Mark reviewed', exact: true });
    const row = page.locator('[data-task-row]');
    await review.waitFor();
    await page.screenshot({ path: '/tmp/aegir-mark-reviewed.png' });
    await page.evaluate(() => { const fixture = (window as any).fixtureActions; fixture.failReview = true; fixture.reviewDelay = 300; });
    await review.click(); expect(await review.isDisabled()).toBe(true);
    await page.getByRole('alert').filter({ hasText: 'Could not mark reviewed' }).waitFor();
    expect(await row.count()).toBe(1); expect(await review.isEnabled()).toBe(true);
    await page.evaluate(() => { (window as any).fixtureActions.failReview = false; });
    await review.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await expect.poll(() => row.count()).toBe(0);
    expect(await page.evaluate(() => (window as any).fixtureActions.reviewCalls)).toBe(2);
    await page.getByText('Marked reviewed · task stays open · ⌘Z to undo', { exact: true }).waitFor();
    await page.keyboard.press('ControlOrMeta+z');
    await review.waitFor(); expect(await row.count()).toBe(1);
    const palette = async () => {
      await page.getByRole('button', { name: 'Search tasks and commands', exact: true }).click();
      await page.getByRole('combobox', { name: 'Search tasks and commands' }).fill('Mark reviewed');
    };
    await palette();
    await page.getByRole('option', { name: /^Mark reviewed/ }).click();
    await expect.poll(() => row.count()).toBe(0);
    await page.getByRole('button', { name: 'Delegated', exact: true }).click();
    await row.waitFor();
    expect(await page.evaluate(() => (window as any).fixtureActions.task.status)).toBe('ready');
    expect(await page.getByRole('textbox', { name: 'Task title', exact: true }).inputValue()).toBe('Update career framework for PMs');
    expect(await page.locator('.ws-task-notes-preview').textContent()).toContain('Revamp candidate');
    expect(await page.getByRole('button', { name: 'Open pm-level-boundaries-proposal.md', exact: true }).isVisible()).toBe(true);
    expect(await page.getByRole('textbox', { name: 'Message', exact: true }).isVisible()).toBe(true);
    expect(await review.count()).toBe(0);
    await palette(); expect(await page.getByRole('option', { name: /^Mark reviewed/ }).count()).toBe(0); await page.keyboard.press('Escape');
    await page.evaluate(() => (window as any).fixtureActions.setTaskStatus('blocked'));
    await page.setViewportSize({ width: 900, height: 650 }); await page.emulateMedia({ reducedMotion: 'reduce' });
    await review.waitFor(); await review.focus();
    expect(await review.evaluate(el => document.activeElement === el)).toBe(true);
    expect(await page.locator('.ws-conversation-head').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: '/tmp/aegir-mark-reviewed-compact.png' });
    await review.press('Enter');
    await expect.poll(() => page.evaluate(() => (window as any).fixtureActions.task.status)).toBe('ready');
    for (const status of ['running', 'proposed']) {
      await page.evaluate(status => (window as any).fixtureActions.setTaskStatus(status), status);
      expect(await review.count()).toBe(0);
    }
    // A palette opened for a review must not clear a newer running state.
    await page.evaluate(() => (window as any).fixtureActions.setTaskStatus('review'));
    await palette();
    await page.getByRole('option', { name: /^Mark reviewed/ }).waitFor();
    await page.evaluate(() => (window as any).fixtureActions.setTaskStatus('running'));
    await page.getByRole('option', { name: /^Mark reviewed/ }).click();
    await page.getByRole('alert').filter({ hasText: 'no longer waiting for your review' }).waitFor();
    expect(await page.evaluate(() => (window as any).fixtureActions.task.status)).toBe('running');
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 90000);
