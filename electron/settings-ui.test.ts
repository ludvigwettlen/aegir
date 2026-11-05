import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('organizes full-window settings, retains drafts, embeds skills and returns to the previous workspace', async () => {
  const server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] }, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/release/**'] } } });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } }); page.setDefaultTimeout(10000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls!.local[0]}design/mockups/task-detail-app.html`);
    await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
    const openSettings = () => page.evaluate(() => (window as any).settingsFixture.open());
    await openSettings();
    await page.getByRole('heading', { name: 'General', exact: true }).waitFor();
    expect(await page.getByRole('navigation', { name: 'Workspace', exact: true }).count()).toBe(0);
    expect(await page.locator('.settings-workspace').evaluate(el => el.getBoundingClientRect().width)).toBe(1440);
    await page.getByRole('switch', { name: 'Start at login', exact: true }).click();
    await expect.poll(() => page.getByRole('switch', { name: 'Start at login', exact: true }).getAttribute('aria-checked')).toBe('true');
    for (const name of ['Appearance', 'Assistant & skills', 'Connections', 'Tasks & delegation', 'Memory & workflows', 'Browser & review', 'Updates & setup']) {
      await page.getByRole('button', { name, exact: true }).click();
      await page.getByRole('heading', { name, exact: true, level: 1 }).waitFor();
    }
    await page.getByRole('searchbox', { name: 'Search settings' }).fill('font');
    await page.getByRole('button', { name: /^Appearance →/ }).click();
    await page.getByRole('combobox', { name: 'System font', exact: true }).selectOption('manrope');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ds-font-system'))).toContain('Manrope');
    await page.getByRole('searchbox', { name: 'Search settings' }).fill('nonexistent-setting');
    await page.getByText('No settings found.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Connections', exact: true }).click();
    await page.getByText('Slack via Claude Code', { exact: true }).waitFor();
    expect(await page.getByPlaceholder('Slack Client ID').count()).toBe(0);
    expect(await page.getByText('Open Slack app settings', { exact: false }).count()).toBe(0);
    const composio = page.locator('.connector-row').filter({ hasText: 'Slack via Composio' });
    await composio.getByRole('button', { name: 'Connect', exact: true }).click();
    expect(await page.evaluate(() => (window as any).settingsFixture.calls)).toContain('connect:composio');
    await page.getByText('Composio connection options', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Expected Composio Slack account', exact: true }).fill('test-workspace');
    await page.getByRole('button', { name: 'General', exact: true }).click();
    await page.getByRole('button', { name: 'Connections', exact: true }).click();
    expect(await page.getByRole('textbox', { name: 'Expected Composio Slack account', exact: true }).inputValue()).toBe('test-workspace');
    await page.getByRole('button', { name: 'Assistant & skills', exact: true }).click();
    await page.getByText('No skills in this library yet.', { exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Manage skills', exact: true }).count()).toBe(0);
    await page.evaluate(() => { const f = (window as any).settingsFixture; f.failSkills = true; f.refreshSkills(); });
    await page.getByRole('alert').filter({ hasText: 'Skill library unavailable' }).waitFor();
    await page.evaluate(() => { const f = (window as any).settingsFixture; f.failSkills = false; f.skillDelay = 500; f.skills = [{ id: 'research', name: 'Research', description: 'A reusable research method', ownerAgentId: null, revision: '1', enabled: true, archived: false, pinned: false, origin: 'user', source: null, extendsSkillId: null, extendsRevision: null, enabledAgentIds: null, disabledAgentIds: [], error: null, updatedAt: new Date().toISOString(), loads: 0 }]; });
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('button', { name: /Research A reusable research method/ }).click();
    await page.getByRole('textbox', { name: 'Edit SKILL.md', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('textbox', { name: 'Agent name', exact: true }).fill('Updated assistant');
    await page.getByRole('button', { name: 'General', exact: true }).click();
    await page.getByRole('button', { name: 'Assistant & skills', exact: true }).click();
    expect(await page.getByRole('textbox', { name: 'Agent name', exact: true }).inputValue()).toBe('Updated assistant');
    await page.getByRole('button', { name: 'Save agent', exact: true }).click();
    await page.locator('.settings-agent strong').filter({ hasText: 'Updated assistant' }).waitFor();
    await page.screenshot({ path: '/tmp/aegir-settings-implemented.png' });
    await page.setViewportSize({ width: 900, height: 750 });
    for (const name of ['General', 'Appearance', 'Assistant & skills', 'Connections', 'Tasks & delegation', 'Memory & workflows', 'Browser & review', 'Updates & setup']) {
      await page.getByRole('button', { name, exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator('.settings-body').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await page.screenshot({ path: '/tmp/aegir-settings-compact.png' });
    // Palette Escape must dismiss the palette before settings itself.
    await page.keyboard.press('Meta+k');
    await page.getByRole('combobox', { name: 'Search tasks and commands' }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('heading', { name: 'Updates & setup', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Upcoming', exact: true }).getAttribute('aria-current')).toBe('page');
    await openSettings();
    await page.getByRole('button', { name: /Back to workspace/ }).click();
    expect(await page.getByRole('button', { name: 'Upcoming', exact: true }).getAttribute('aria-current')).toBe('page');
    await page.keyboard.press('Meta+k');
    await page.getByRole('combobox', { name: 'Search tasks and commands' }).fill('Manage skills');
    await page.getByRole('option', { name: /^Manage skills/ }).click();
    await page.getByRole('heading', { name: 'Assistant & skills', exact: true }).waitFor();
    await page.getByRole('textbox', { name: 'Edit SKILL.md', exact: true }).waitFor();
    await page.getByRole('searchbox', { name: 'Search settings' }).focus();
    await page.keyboard.press('Escape');
    expect(await page.getByRole('button', { name: 'Upcoming', exact: true }).getAttribute('aria-current')).toBe('page');
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 90000);
