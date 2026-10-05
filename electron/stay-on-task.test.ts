import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('keeps you on a task after you send it to the agent, until you move on', async () => {
  const server = await createServer({
    configFile: false, esbuild: { jsx: 'automatic' }, appType: 'custom',
    // node_modules can be a symlink (a git worktree): allow its real folder, keep one React, keep the cache private.
    server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd(), realpathSync('node_modules')] } },
    resolve: { dedupe: ['react', 'react-dom'] }, cacheDir: join(tmpdir(), 'aegir-stay-on-task-smoke'),
  });
  server.middlewares.use('/stay-on-task', (_req, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<div id="root"></div><script type="module" src="/src/ui/testing/stay-on-task.tsx"></script>');
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    // A cold first load makes Vite optimise dependencies and reload the page, so start from a settled second load.
    await page.goto(`${server.resolvedUrls!.local[0]}stay-on-task`);
    await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor({ timeout: 30_000 });
    await page.goto(`${server.resolvedUrls!.local[0]}stay-on-task`);
    const row = (title: string) => page.locator('[data-task-row]', { hasText: title });
    const selected = () => page.locator('[data-task-row][aria-current="true"]').innerText();
    const panelTitle = () => page.getByRole('textbox', { name: 'Task title' }).inputValue();
    const calls = () => page.evaluate(() => (window as any).fixture.calls as unknown[][]);
    const go = async (letter: string, heading: string) => {
      await page.keyboard.press('g'); await page.keyboard.press(letter);
      await page.getByRole('heading', { name: heading, level: 1 }).waitFor();
    };
    const ask = async (instruction: string) => {
      await page.keyboard.press('a');
      await page.getByRole('dialog', { name: 'Ask Claude' }).waitFor();
      await page.keyboard.type(instruction);
      await page.keyboard.press('Enter');
      await page.getByRole('dialog', { name: 'Ask Claude' }).waitFor({ state: 'detached' });
    };

    // Asking Claude from the Inbox keeps the task where it was, working, with its panel open.
    await row('Plan offsite').waitFor();
    await go('i', 'Inbox');
    await row('Prep board deck').click();
    await ask('Draft the outline');
    await page.waitForFunction(() => (window as any).fixture.calls.some((call: unknown[]) => call[0] === 'handOff'));
    await row('Prep board deck').getByText('working').waitFor();
    expect(await selected()).toContain('Prep board deck');
    expect(await panelTitle()).toBe('Prep board deck');
    await page.screenshot({ path: '/tmp/aegir-stay-on-task.png' });

    // The palette acts on the live task: Claude is working, so it offers Stop and no Delete.
    await page.keyboard.press('Meta+K');
    const titles = await page.getByRole('option').allInnerTexts();
    expect(titles.some(text => text.includes('Stop Claude'))).toBe(true);
    expect(titles.some(text => text.includes('Delete task'))).toBe(false);
    await page.keyboard.press('Escape');

    // The agent finishing doesn't move it either, and neither does a second reply.
    const position = () => page.locator('[data-task-row]').evaluateAll(rows => rows.findIndex(item => item.textContent?.includes('Prep board deck')));
    const before = await position();
    await page.evaluate(() => (window as any).fixture.finish('deck'));
    await row('Prep board deck').getByText('review').waitFor();
    expect(await selected()).toContain('Prep board deck');
    await page.keyboard.press('a');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Message');
    await page.keyboard.type('One more thing');
    await page.keyboard.press('Enter');
    await row('Prep board deck').getByText('working').waitFor();
    expect(await position()).toBe(before);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !!document.activeElement?.closest('[data-task-row]'));

    // Moving on lets it go to Delegated.
    await page.keyboard.press('j');
    await row('Prep board deck').waitFor({ state: 'detached' });
    expect(await selected()).toContain('Summarise customer calls');
    await go('w', 'Delegated');
    await row('Prep board deck').waitFor();

    // Replying to a task that's ready for review keeps it in Needs you, with the cursor in the reply box.
    await go('n', 'Needs you');
    await row('Research competitor pricing').click();
    await page.keyboard.press('a');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Message');
    await page.keyboard.type('Make it shorter');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => (window as any).fixture.calls.some((call: unknown[]) => call[0] === 'sendMessage' && call[1] === 'research-thread'));
    await row('Research competitor pricing').getByText('working').waitFor();
    expect(await selected()).toContain('Research competitor pricing');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Message');

    // Switching lists lets it go too.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !!document.activeElement?.closest('[data-task-row]'));
    await go('i', 'Inbox');
    await go('n', 'Needs you');
    await row('Research competitor pricing').waitFor({ state: 'detached' });

    // Full screen stays on the task you asked about.
    await go('i', 'Inbox');
    await row('Summarise customer calls').click();
    await page.keyboard.press('f');
    await page.waitForFunction(() => document.body.classList.contains('ws-focus-mode'));
    await ask('Pull the themes');
    await page.getByRole('textbox', { name: 'Task title' }).waitFor();
    expect(await panelTitle()).toBe('Summarise customer calls');
    expect(await page.evaluate(() => document.body.classList.contains('ws-focus-mode'))).toBe(true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.body.classList.contains('ws-focus-mode'));

    // Finishing a held task still moves you on, as triage always has.
    await row('Book dentist').click();
    await ask('Find a slot next week');
    await row('Book dentist').getByText('working').waitFor();
    await page.keyboard.press(' ');
    await row('Book dentist').waitFor({ state: 'detached' });
    expect(await calls()).toContainEqual(['updateTask', 'dentist', { status: 'done' }]);

    // A task that still belongs in its list behaves as before.
    await go('t', 'Today');
    await row('Plan offsite').click();
    await ask('Book the venue');
    await row('Plan offsite').getByText('working').waitFor();
    await page.keyboard.press('j');
    expect(await row('Plan offsite').count()).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    await server.close();
  }
}, 60_000);
