import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';
it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('snoozes without changing deadlines and keeps details open after scheduling/list changes', async () => {
  const server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/release/**'] } } });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }); page.setDefaultTimeout(10000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls!.local[0]}design/mockups/task-detail-app.html?personal&notes`);
    await page.getByRole('button', { name: 'Inbox', exact: true }).click();
    const title = page.getByRole('textbox', { name: 'Task title', exact: true });
    await page.getByRole('button', { name: 'Snooze', exact: true }).click();
    await page.screenshot({ path: '/tmp/aegir-snooze-dialog.png', fullPage: true });
    await page.getByRole('dialog', { name: 'Snooze task', exact: true }).getByRole('button', { name: 'Tomorrow', exact: true }).click();
    await expect.poll(() => page.locator('[data-task-row]').count()).toBe(0);
    await title.waitFor(); expect(await title.inputValue()).toBe('Update career framework for PMs');
    expect(await page.evaluate(() => (window as any).fixtureActions.task.dueAt)).toBeNull();
    await page.getByText('This task is outside Inbox. You can finish editing.', { exact: false }).waitFor();
    await title.fill('Continue editing the snoozed task'); await title.press('Tab');
    await expect.poll(() => page.evaluate(() => (window as any).fixtureActions.task.title)).toBe('Continue editing the snoozed task');
    await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
    await expect.poll(() => page.locator('[data-task-row]').count()).toBe(1);
    await page.getByRole('button', { name: /^Snoozed until/ }).click();
    await page.getByRole('dialog', { name: 'Snooze task', exact: true }).getByRole('button', { name: 'Unsnooze', exact: true }).click();
    await expect.poll(() => page.locator('[data-task-row]').count()).toBe(0);
    expect(await title.inputValue()).toBe('Continue editing the snoozed task');
    await page.getByRole('button', { name: 'Back to list', exact: true }).click();
    await expect.poll(() => title.count()).toBe(0);
    await page.getByRole('button', { name: 'Inbox', exact: true }).click(); await title.waitFor();
    // A due-date edit removes the task from Today but retains its detail until the user leaves.
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await page.evaluate(() => { (window as any).aegir.updateTask('task', { dueAt: '2099-12-31' }); });
    await expect.poll(() => page.locator('[data-task-row]').count()).toBe(0);
    await title.waitFor();
    await page.getByRole('button', { name: 'Inbox', exact: true }).click();
    await page.evaluate(async () => {
      const api = (window as any).aegir;
      const snapshot = await api.snapshot(); snapshot.taskLists.push({ id: 'filed', name: 'Filed', createdAt: new Date().toISOString() });
      await api.updateTask('task', { listId: 'filed' });
    });
    await expect.poll(() => page.locator('[data-task-row]').count()).toBe(0);
    await title.waitFor();
    await page.setViewportSize({ width: 900, height: 700 }); await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '/tmp/aegir-task-stay-open.png', fullPage: true });
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 45_000);
