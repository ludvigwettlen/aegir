import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('finds and runs task and app commands from the Cmd+K palette', async () => {
  const server = await createServer({
    configFile: false, esbuild: { jsx: 'automatic' }, appType: 'custom',
    // node_modules can be a symlink (a git worktree): allow its real folder, keep one React, keep the cache private.
    server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd(), realpathSync('node_modules')] } },
    resolve: { dedupe: ['react', 'react-dom'] }, cacheDir: join(tmpdir(), 'aegir-command-palette-smoke'),
  });
  server.middlewares.use('/command-palette', (_req, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<div id="root"></div><script type="module" src="/src/ui/testing/command-palette.tsx"></script>');
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls!.local[0]}command-palette`);
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    const search = page.getByRole('combobox', { name: 'Search commands' });
    const options = () => page.getByRole('option').allInnerTexts();
    const highlighted = () => page.locator('[role="option"][aria-selected="true"]').innerText();
    const calls = () => page.evaluate(() => (window as any).fixture.calls as unknown[][]);
    const called = (count: number) => page.waitForFunction(n => (window as any).fixture.calls.length >= n, count);
    const focusedRow = () => page.evaluate(() => document.activeElement?.closest('[data-task-row]')?.textContent || '');
    const row = (title: string) => page.locator('[data-task-row]', { hasText: title });
    const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });

    // Rows that appear under a resting mouse don't take the highlight; a real move does.
    await row('Prep board deck').click();
    await page.mouse.move(640, 330);
    await page.keyboard.press('Meta+K');
    await palette.waitFor();
    expect(await highlighted()).toContain('Mark done');
    await page.mouse.move(640, 334);
    expect(await highlighted()).not.toContain('Mark done');

    // The selected task's commands come first, named in the line under the field, each with its key.
    await page.keyboard.press('Escape');
    await palette.waitFor({ state: 'detached' });
    expect(await focusedRow()).toContain('Prep board deck');
    await page.keyboard.press('Meta+K');
    expect(await search.evaluate(element => element === document.activeElement)).toBe(true);
    expect(await palette.getByText('Task: Prep board deck').count()).toBe(1);
    expect((await options())[0]).toContain('Mark done');
    expect(await page.getByRole('option', { name: /Snooze/ }).locator('kbd').allInnerTexts()).toEqual(['S']);
    expect(await page.getByRole('option', { name: /Set label/ }).locator('kbd').allInnerTexts()).toEqual(['⌘', 'L']);
    expect((await options()).some(text => text.includes('Run Hourly discovery now'))).toBe(false);
    await page.screenshot({ path: '/tmp/aegir-command-palette.png' });
    await page.keyboard.press('Meta+K');
    await palette.waitFor({ state: 'detached' });

    // Letters typed straight after Cmd+K go into the field. "set due" would otherwise fire S and Space on the task.
    await page.keyboard.press('Meta+K');
    await page.keyboard.type('set due');
    await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: 'Set due date' }).waitFor();
    expect(await calls()).toEqual([]);
    // The due date offers Today first; snooze doesn't, since snoozing until today changes nothing.
    const quick = (name: string) => page.getByRole('dialog', { name }).locator('.ws-when-quick button').evaluateAll(buttons => buttons.map(button => button.firstChild?.textContent));
    expect(await quick('Set due date')).toEqual(['Today', 'Tomorrow', 'This weekend', 'Next week', 'Next month']);
    await page.keyboard.press('Escape');

    // A command's own box keeps what you type next.
    await page.keyboard.press('Meta+K');
    await page.keyboard.type('snooze');
    await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: 'Snooze' }).waitFor();
    expect(await quick('Snooze')).toEqual(['Tomorrow', 'This weekend', 'Next week', 'Next month']);
    await page.keyboard.type('fri');
    expect(await page.getByRole('textbox', { name: 'When' }).inputValue()).toBe('fri');
    await page.keyboard.press('Escape');

    // Edit title lands in the title with the text selected.
    await page.keyboard.press('Meta+K');
    await page.keyboard.type('edit title');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Task title');
    expect(await page.evaluate(() => { const field = document.activeElement as HTMLTextAreaElement; return field.selectionStart === 0 && field.selectionEnd === field.value.length; })).toBe(true);
    await page.keyboard.press('Escape');

    // In full screen, Escape closes the palette and nothing else.
    await row('Prep board deck').focus();
    await page.keyboard.press('f');
    await page.waitForFunction(() => document.body.classList.contains('ws-focus-mode'));
    await page.keyboard.press('Meta+K');
    await page.keyboard.press('Escape');
    await palette.waitFor({ state: 'detached' });
    expect(await page.evaluate(() => document.body.classList.contains('ws-focus-mode'))).toBe(true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.body.classList.contains('ws-focus-mode'));

    // Initials, synonyms, several words, a typed date, and no match.
    await row('Prep board deck').click();
    await page.keyboard.press('Meta+K');
    await search.fill('cdd');
    expect((await options())[0]).toContain('Clear due date');
    await search.fill('remove');
    expect((await options()).some(text => text.includes('Delete task'))).toBe(true);
    await search.fill('ask');
    expect((await options())[0]).toContain('Ask Claude');
    await search.fill('run hou');
    expect((await options())[0]).toContain('Run Hourly discovery now');
    await search.fill('tomorrow');
    expect((await options())[0]).toContain('Set due date to');
    await search.fill('zzzz');
    await page.getByText('No command matches “zzzz”.').waitFor();

    // Set label is a second step: Escape goes back to the commands, Enter creates and applies a label.
    await search.fill('label');
    await page.keyboard.press('Enter');
    const labels = page.getByRole('combobox', { name: 'Set label' });
    await labels.waitFor();
    expect(await options()).toEqual(['board', 'customers', 'No label']);
    await page.keyboard.press('Escape');
    expect(await search.inputValue()).toBe('label');
    await page.keyboard.press('Enter');
    await labels.fill('growth');
    expect(await options()).toEqual(['Create label #growth']);
    await page.keyboard.press('Enter');
    await palette.waitFor({ state: 'detached' });
    await called(1);
    expect(await calls()).toContainEqual(['updateTask', 'deck', { label: 'growth' }]);
    await page.waitForFunction(() => document.activeElement?.closest('[data-task-row]')?.textContent?.includes('Prep board deck'));

    // Cmd+L opens the same picker directly; Escape then closes it.
    await page.keyboard.press('Meta+L');
    await labels.waitFor();
    await page.keyboard.press('Escape');
    await palette.waitFor({ state: 'detached' });

    // The palette works from what was on screen when it opened, even if the task moves meanwhile.
    await page.keyboard.press('Meta+K');
    await page.evaluate(() => (window as any).fixture.setDue('deck', '2099-01-01'));
    await row('Prep board deck').waitFor({ state: 'detached' });
    expect(await palette.getByText('Task: Prep board deck').count()).toBe(1);
    await search.fill('clear label');
    await page.keyboard.press('Enter');
    await called(2);
    expect(await calls()).toContainEqual(['updateTask', 'deck', { label: null }]);
    await page.evaluate(date => (window as any).fixture.setDue('deck', date), today);
    await row('Prep board deck').waitFor();

    // From a text field, Escape puts the caret back with the draft intact.
    await page.getByRole('textbox', { name: 'New task' }).click();
    await page.keyboard.type('draft');
    await page.keyboard.press('Meta+K');
    await palette.waitFor();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('New task');
    expect(await page.getByRole('textbox', { name: 'New task' }).inputValue()).toBe('draft');

    // App commands: go to a list, run a routine, open a chat that has no task rows.
    await page.keyboard.press('Meta+K');
    await search.fill('go upcoming');
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Upcoming' }).waitFor();
    await page.keyboard.press('Meta+K');
    await search.fill('run hourly');
    await page.keyboard.press('Enter');
    await page.getByText('Started Hourly discovery').waitFor();
    expect(await calls()).toContainEqual(['runRoutine', 'hourly']);
    // Claude Code's scheduled tasks stay out of the empty list but are one search away.
    await page.keyboard.press('Meta+K');
    expect((await options()).some(text => text.includes('daily-brief'))).toBe(false);
    await search.fill('daily brief');
    expect((await options())[0]).toContain('Go to daily-brief');
    await page.keyboard.press('Enter');
    await page.locator('[data-nav-item][aria-current="page"]', { hasText: 'daily-brief' }).waitFor();
    await page.keyboard.press('Meta+K');
    await search.fill('go general');
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: '# General' }).or(page.getByRole('heading', { name: 'General' })).first().waitFor();
    await page.keyboard.press('Meta+K');
    expect(await palette.getByText(/^Task:/).count()).toBe(0);
    expect((await options()).some(text => text.includes('Mark done'))).toBe(false);
    expect((await options()).some(text => text.includes('New thread'))).toBe(true);
    await page.keyboard.press('Escape');

    // Delete from the palette takes the same path as Backspace, and Cmd+Z brings the task back.
    await page.keyboard.press('Meta+K');
    await search.fill('go today');
    await page.keyboard.press('Enter');
    await row('Summarise customer calls').click();
    await page.keyboard.press('Meta+K');
    await search.fill('delete');
    await page.keyboard.press('Enter');
    await page.getByText('Task deleted · ⌘Z to undo').waitFor();
    expect(await row('Summarise customer calls').count()).toBe(0);
    await page.keyboard.press('Meta+Z');
    await row('Summarise customer calls').waitFor();

    // Another open box keeps the keyboard: Cmd+K does nothing while Ask Claude is open.
    await row('Prep board deck').click();
    await page.keyboard.press('a');
    await page.getByRole('dialog', { name: 'Ask Claude' }).waitFor();
    await page.keyboard.press('Meta+K');
    expect(await palette.count()).toBe(0);
    await page.keyboard.press('Escape');
    // Closing the Ask box moves focus back to the row on the next frame; wait for it, as a person would.
    await page.waitForFunction(() => !!document.activeElement?.closest('[data-task-row]'));

    // New group opens its box, and Escape closes that box.
    await page.keyboard.press('Meta+K');
    await search.fill('new group');
    await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: 'New group' }).waitFor();
    await page.waitForFunction(() => !!document.activeElement?.closest('[aria-labelledby="new-group-title"]'));
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'New group' }).waitFor({ state: 'detached' });

    // A click outside closes it.
    await page.keyboard.press('Meta+K');
    await palette.waitFor();
    await page.mouse.click(8, 790);
    await palette.waitFor({ state: 'detached' });

    // An open document keeps Cmd+K (its editor inserts links), and so does any rich-text field.
    await page.evaluate(() => document.body.append(Object.assign(document.createElement('div'), { className: 'document-open' })));
    await page.keyboard.press('Meta+K');
    expect(await palette.count()).toBe(0);
    await page.evaluate(() => document.querySelector('.document-open')?.remove());
    await page.evaluate(() => {
      const editor = Object.assign(document.createElement('div'), { contentEditable: 'true', textContent: 'Draft' });
      document.body.append(editor);
      editor.focus();
    });
    await page.keyboard.press('Meta+K');
    expect(await palette.count()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    await server.close();
  }
}, 60_000);
