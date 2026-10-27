import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('creates and edits task documents, preserving work on failures in personal and delegated tasks', async () => {
  const server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/release/**'] } } });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }); page.setDefaultTimeout(10000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    for (const personal of [false, true]) {
      await page.goto(`${server.resolvedUrls!.local[0]}design/mockups/task-detail-app.html?files=0${personal ? '&personal' : ''}`);
      await page.getByRole('button', { name: personal ? 'Inbox' : 'Needs you', exact: true }).click();
      const create = page.getByRole('button', { name: 'New document', exact: true });
      await create.click();
      const dialog = page.getByRole('dialog', { name: 'New document', exact: true });
      const filename = dialog.getByRole('textbox', { name: 'Filename', exact: true });
      await expect.poll(() => filename.evaluate(el => el === document.activeElement)).toBe(true);
      await page.keyboard.press('Escape');
      await expect.poll(() => create.evaluate(el => el === document.activeElement)).toBe(true);
      // The empty picker offers the same creation flow and transfers keyboard focus.
      await page.getByRole('button', { name: 'Files', exact: true }).click();
      await page.getByRole('dialog', { name: 'Documents', exact: true }).getByRole('button', { name: 'New document' }).click();
      await expect.poll(() => filename.evaluate(el => el === document.activeElement)).toBe(true);
      await filename.fill('My notes');
      await page.evaluate(() => { (window as any).fixtureCreation.fail = true; });
      await filename.press('Enter');
      await dialog.getByRole('alert').filter({ hasText: 'Could not create document' }).waitFor();
      expect(await filename.inputValue()).toBe('My notes');
      await page.evaluate(() => { (window as any).fixtureCreation.fail = false; (window as any).fixtureCreation.delay = 500; });
      await filename.press('Enter');
      await dialog.getByRole('status').filter({ hasText: 'Creating document' }).waitFor();
      expect(await dialog.getByRole('button', { name: 'Creating…', exact: true }).isDisabled()).toBe(true);
      await page.keyboard.press('Escape');
      expect(await dialog.isVisible()).toBe(true);
      await dialog.waitFor({ state: 'hidden' });
      const prose = page.locator('.ws-document-prose[contenteditable="true"]');
      await expect.poll(() => prose.evaluate(el => el === document.activeElement)).toBe(true);
      expect(await page.evaluate(() => (window as any).fixtureActions.files[0].content)).toBe('');
      await prose.fill('My manually written notes.');
      await page.getByRole('button', { name: personal ? 'Back to task' : 'Back to list', exact: true }).click();
      await page.getByRole('button', { name: 'Open My notes.md', exact: true }).waitFor();
      expect(await page.evaluate(() => (window as any).fixtureActions.files[0].content)).toContain('My manually written notes.');
      expect(await page.evaluate(() => (window as any).fixtureActions.sent)).toEqual([]);
      if (personal) {
        await page.getByRole('button', { name: 'Hand off to the team', exact: true }).waitFor();
        expect(await page.evaluate(() => (window as any).fixtureActions.task.threadId)).toBeNull();
      }
      await create.click(); await filename.fill('My notes.md'); await filename.press('Enter');
      await dialog.getByRole('alert').filter({ hasText: 'already exists' }).waitFor();
      expect(await page.evaluate(() => (window as any).fixtureActions.files.length)).toBe(1);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Open My notes.md', exact: true }).click();
      // A failed save blocks creation of another file and retains the current edit.
      await page.evaluate(() => { (window as any).fixtureActions.failSave = true; });
      await prose.fill('Unsaved work to preserve');
      await create.click(); await filename.fill('Second'); await filename.press('Enter');
      await dialog.getByRole('alert').filter({ hasText: 'Save the current document' }).waitFor();
      expect(await page.evaluate(() => (window as any).fixtureActions.files.length)).toBe(1);
      await page.evaluate(() => { (window as any).fixtureActions.failSave = false; });
      await filename.press('Enter'); await dialog.waitFor({ state: 'hidden' });
      await expect.poll(() => prose.evaluate(el => el === document.activeElement)).toBe(true);
      expect(await page.evaluate(() => (window as any).fixtureActions.files.find((file: any) => file.path === 'My notes.md').content)).toContain('Unsaved work to preserve');
      await page.setViewportSize({ width: 900, height: 650 }); await page.emulateMedia({ reducedMotion: 'reduce' });
      await create.click();
      await filename.fill('A long filename for notes about the task and its planned next steps.md');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/aegir-create-document-${personal ? 'personal' : 'delegated'}.png` });
      await filename.press('Enter'); await dialog.waitFor({ state: 'hidden' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.evaluate(() => (window as any).fixtureCreation.calls.every((call: any) => call.id === ((window as any).fixtureActions.task.threadId || 'task')))).toBe(true);
      await page.setViewportSize({ width: 1400, height: 900 });
    }
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 90000);
