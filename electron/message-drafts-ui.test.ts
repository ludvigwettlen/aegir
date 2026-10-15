import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('edits, copies, marks sent and discards Slack and email draft cards', async () => {
  const server = await createServer({
    configFile: false, esbuild: { jsx: 'automatic' }, appType: 'custom',
    // node_modules can be a symlink (a git worktree): allow its real folder, keep one React, keep the cache private.
    server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd(), realpathSync('node_modules')] } },
    resolve: { dedupe: ['react', 'react-dom'] }, cacheDir: join(tmpdir(), 'aegir-message-drafts-smoke'),
  });
  server.middlewares.use('/message-drafts', (_req, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<div id="root"></div><script type="module" src="/src/ui/testing/message-drafts.tsx"></script>');
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const url = `${server.resolvedUrls!.local[0]}message-drafts`;
    // A cold first load makes Vite optimise dependencies and reload the page, and can leave it broken; the test runs on
    // a settled second load.
    await page.goto(url);
    await page.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 30_000 }).catch(() => {});
    await page.goto(url);
    await page.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 30_000 });
    errors.length = 0;
    const calls = () => page.evaluate(() => (window as any).fixture.calls as unknown[][]);
    const called = (...call: unknown[]) => page.waitForFunction(expected => (window as any).fixture.calls.some((item: unknown[]) => JSON.stringify(item) === expected), JSON.stringify(call));
    const copied = (text: string) => page.waitForFunction(expected => (window as any).fixture.clipboard === expected, text);
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth
      && [...document.querySelectorAll('.ws-draft')].every(card => card.scrollWidth <= card.clientWidth));
    const actions = /^(Copy|Copied|Open in Superhuman|I sent it|Discard)$/;

    await page.getByRole('button', { name: 'Needs you', exact: true }).click();
    const slack = page.getByRole('article', { name: 'Slack draft: DM to Johan Lund', exact: true });
    const email = page.getByRole('article', { name: 'Email draft: Re: Nordvik rollout plan', exact: true });
    await slack.waitFor();

    // The agent's words for where it goes, then the raw facts to check them against.
    const slackText = await slack.textContent();
    for (const part of ['Slack message', 'Draft', "Claude's draft for: DM to Johan Lund", 'D04TESTDM01 · Reply in thread', 'Check where it goes before you send it.'])
      expect(slackText).toContain(part);
    expect(await slack.locator('code').innerText()).toBe('D04TESTDM01');
    expect(slackText).not.toContain('Edited');
    expect(await email.locator('dt').allTextContents()).toEqual(['To', 'Cc', 'Bcc', 'Subject', 'From']);
    expect(await email.locator('dd').allTextContents()).toEqual(['petra.berg@example.com', 'johan.lund@example.com', 'crm-log+nordvik-rollout-pilot-2026@example.com', 'Re: Nordvik rollout plan', 'mia@example.com']);
    expect(await email.textContent()).toContain("Claude's draft for: Reply to Petra at Nordvik");
    expect(await email.getByRole('button', { name: actions }).allInnerTexts()).toEqual(['Copy', 'I sent it', 'Discard', 'Open in Superhuman']);
    expect(await slack.getByRole('button', { name: actions }).allInnerTexts()).toEqual(['Copy', 'I sent it', 'Discard']);

    // Older drafts fold to one line, with their text read-only inside.
    const replaced = page.getByRole('article', { name: 'Slack draft: DM to Johan', exact: true });
    const discarded = page.getByRole('article', { name: 'Slack draft: #mgmt', exact: true });
    await replaced.getByText('Replaced by a newer draft').waitFor();
    await discarded.getByText('Discarded draft').waitFor();
    for (const card of [replaced, discarded]) {
      expect(await card.getByRole('textbox').count()).toBe(0);
      expect(await card.getByRole('button', { name: actions }).count()).toBe(0);
    }
    await discarded.getByText('Discarded draft').click();
    await discarded.getByText('Nordvik-piloten startar 14 oktober med Stockholmsteamet.').waitFor();

    await page.setViewportSize({ width: 1280, height: 1500 });
    // The list scrolls smoothly; wait until it reaches the end.
    await page.locator('.ws-messages').evaluate(list => { list.scrollTop = list.scrollHeight; });
    await page.waitForFunction(() => { const list = document.querySelector('.ws-messages')!; return list.scrollTop + list.clientHeight >= list.scrollHeight - 1; });
    await page.screenshot({ path: '/tmp/aegir-message-drafts.png' });

    // At the narrowest window, with the task panel at its 360 px minimum, nothing scrolls sideways.
    await page.setViewportSize({ width: 950, height: 800 });
    await page.getByRole('separator', { name: 'Resize task panel' }).focus();
    for (let step = 0; step < 4; step++) await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector<HTMLElement>('.ws-task-detail')?.offsetWidth === 360);
    expect(await fits()).toBe(true);
    // Copy, I sent it and Discard stay on one line even here.
    expect(new Set(await email.getByRole('button', { name: /^(Copy|I sent it|Discard)$/ }).evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().top))).size).toBe(1);
    await page.setViewportSize({ width: 1280, height: 900 });

    // Edits save after a pause, once, with exactly the typed text.
    const field = slack.getByRole('textbox', { name: 'Draft text' });
    const edit = 'Hej Johan, mailet till Petra är skickat. Återkommer när hon svarat.';
    await field.fill('');
    await page.keyboard.type(edit);
    await called('updateDraft', 'slack', edit);
    expect((await calls()).filter(call => call[0] === 'updateDraft').length).toBeLessThanOrEqual(2);
    await slack.getByText('Edited', { exact: true }).waitFor();

    // Cmd+Enter copies what the field holds, including the last keys typed just before it.
    const quick = 'Snabb heads-up: mailet till Petra är ute, säg till om något saknas.';
    await field.fill('');
    await page.keyboard.type(quick);
    await page.keyboard.press('Meta+Enter');
    await copied(quick);
    expect(await field.inputValue()).toBe(quick);
    await slack.getByRole('button', { name: 'Copied' }).waitFor();

    // I sent it records exactly the current text, and nothing saves after it.
    const final = 'Hej Johan, mailet till Petra är skickat. Hör av dig om du vill lägga till något.';
    await field.fill('');
    await page.keyboard.type(final);
    await slack.getByRole('button', { name: 'I sent it' }).click();
    await called('markDraftSent', 'slack', final);
    await slack.getByText(/^You sent it \d{1,2}[:.]\d{2}/).waitFor();
    expect(await slack.locator('.ws-draft-state').innerText()).toBe('Sent');
    expect(await slack.getByRole('textbox').count()).toBe(0);
    expect(await slack.getByRole('button', { name: actions }).count()).toBe(0);
    expect(await slack.locator('.ws-draft-readonly').innerText()).toBe(final);
    expect(await slack.textContent()).not.toContain('Check where it goes');
    await page.waitForTimeout(900);
    const log = await calls();
    expect(log.slice(log.findIndex(call => call[0] === 'markDraftSent')).filter(call => call[0] === 'updateDraft')).toEqual([]);

    // "I sent it" by mistake: Reopen brings the draft back, text intact. A card Legolas sent has no Reopen.
    await slack.getByRole('button', { name: 'Reopen' }).click();
    await called('reopenDraft', 'slack');
    await slack.getByRole('textbox', { name: 'Draft text' }).waitFor();
    expect(await slack.getByRole('textbox', { name: 'Draft text' }).inputValue()).toBe(final);
    await slack.getByRole('button', { name: 'I sent it' }).click();
    await slack.getByText(/^You sent it/).waitFor();

    // Leaving the task during the pause still saves the edit: Cmd+N moves to Today while the field has focus.
    const emailField = email.getByRole('textbox', { name: 'Draft text' });
    const body = 'Hi Petra,\n\nShort version: we pilot with the Stockholm team from 14 October.\n\nBest,\nMia';
    await emailField.fill(body);
    await page.keyboard.press('Meta+N');
    await called('updateDraft', 'email', body);
    await page.getByRole('button', { name: 'Needs you', exact: true }).click();
    expect(await emailField.inputValue()).toBe(body);

    // Email: Copy writes the body, Open in Superhuman opens the agent's draft, Discard folds the card.
    await email.getByRole('button', { name: 'Copy', exact: true }).click();
    await copied(body);
    await email.getByRole('button', { name: 'Copied' }).waitFor();
    await email.getByRole('button', { name: 'Open in Superhuman' }).click();
    await called('openExternal', 'https://mail.superhuman.com/mia@example.com/thread/18f2c3a4b5d6e7f8');
    await email.getByRole('button', { name: 'Discard' }).click();
    await called('discardDraft', 'email');
    await email.getByText('Discarded draft').waitFor();
    expect(await email.getByRole('textbox').count()).toBe(0);
    expect(await email.getByRole('button', { name: actions }).count()).toBe(0);
    await email.getByText('Discarded draft').click();
    await email.getByText('Short version: we pilot', { exact: false }).waitFor();

    // Cards Legolas can send show the destination as Slack confirmed it, and Send first.
    const ready = page.getByRole('article', { name: 'Slack draft: Johan Lund', exact: true });
    await ready.scrollIntoViewIfNeeded();
    expect(await ready.textContent()).toContain('Slack: DM to Johan Lund');
    expect(await ready.getByRole('button', { name: /^(Send|Copy|Discard|I sent it myself)$/ }).allInnerTexts()).toEqual(['Send', 'Copy', 'Discard', 'I sent it myself']);
    // While Slack checks, Send waits. When it couldn't confirm, there is no Send, only Copy.
    const checking = page.getByRole('article', { name: 'Slack draft: DM to Tove', exact: true });
    await checking.getByText('Checking where it goes with Slack…').waitFor();
    expect(await checking.getByRole('button', { name: 'Send', exact: true }).isDisabled()).toBe(true);
    const unconfirmed = page.getByRole('article', { name: 'Slack draft: DM to Maja', exact: true });
    await unconfirmed.getByText("Couldn't confirm where this goes: Slack has no DM with this id that you can see. Legolas won't send it until it can; copy it instead.", { exact: false }).waitFor();
    expect(await unconfirmed.getByRole('button', { name: 'Send', exact: true }).count()).toBe(0);
    // Check again: a check that failed (a connector still connecting) may work now, and then Send appears.
    await unconfirmed.getByRole('button', { name: 'Check again' }).click();
    await called('recheckDraft', 'slack-unconfirmed');
    const lin = page.getByRole('article', { name: 'Slack draft: Maja Holm', exact: true });
    await lin.getByText('Slack: DM to Maja Holm', { exact: false }).waitFor();
    await lin.getByRole('button', { name: 'Send', exact: true }).waitFor();
    const lost = page.getByRole('article', { name: 'Slack draft: mgmt', exact: true });
    await lost.getByText('Legolas lost track of this send. Check Slack before sending again.', { exact: false }).waitFor();
    await lost.getByRole('button', { name: 'Send again' }).waitFor();

    // Cmd+Enter sends exactly what the field holds, with a countdown to take it back.
    const readyField = ready.getByRole('textbox', { name: 'Draft text' });
    const shorter = 'Hej Johan! Mailet till Petra är ute nu.';
    await readyField.fill('');
    await page.keyboard.type(shorter);
    await page.keyboard.press('Meta+Enter');
    await called('sendDraft', 'slack-ready', shorter);
    await ready.getByText(/^Sending in \d s$/).waitFor();
    expect(await ready.getByRole('textbox').count()).toBe(0);
    await ready.getByRole('button', { name: 'Undo' }).click();
    await called('undoDraftSend', 'slack-ready');
    await ready.getByRole('textbox', { name: 'Draft text' }).waitFor();
    expect(await readyField.inputValue()).toBe(shorter);
    // Send again and let it go: Sent from Legolas, with a link to the message.
    await page.evaluate(() => { (window as any).fixture.undoMs = 300; });
    await ready.getByRole('button', { name: 'Send', exact: true }).click();
    await ready.getByText(/^Sent from Legolas \d{1,2}[:.]\d{2}/).waitFor();
    expect(await ready.locator('.ws-draft-readonly').innerText()).toBe(shorter);
    expect(await ready.getByRole('button', { name: 'Reopen' }).count()).toBe(0);
    await ready.getByRole('button', { name: 'Open in Slack' }).click();
    await called('openExternal', 'https://app.slack.com/client/D04EXAMPL01');

    // Email rows as Superhuman holds them. A refused send says why and stays editable; Send again goes through.
    const mail = page.getByRole('article', { name: 'Email draft: Northwind <> Harborlight', exact: true });
    await mail.getByText('As Superhuman holds it.').waitFor();
    await page.evaluate(() => { (window as any).fixture.failNext = true; });
    await mail.getByRole('button', { name: 'Send', exact: true }).click();
    await mail.getByRole('alert').filter({ hasText: 'Superhuman said: draft not found' }).waitFor();
    await mail.getByRole('button', { name: 'Send again' }).click();
    await mail.getByText(/^Sent from Legolas/).waitFor();
    await mail.getByRole('button', { name: 'Open in Superhuman' }).waitFor();
    await page.screenshot({ path: '/tmp/aegir-message-drafts-send.png', fullPage: true });

    // The same cards in the group chat, at the narrowest window.
    await page.getByRole('button', { name: 'Thread in #Team' }).click();
    await page.locator('.ws-thread-item.selected').waitFor();
    await slack.getByText(/^You sent it/).waitFor();
    await page.setViewportSize({ width: 950, height: 800 });
    expect(await fits()).toBe(true);
    expect(await page.locator('.error-toast').count()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    await server.close();
  }
}, 90_000);
