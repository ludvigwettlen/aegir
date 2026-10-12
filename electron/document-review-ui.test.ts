import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

it.skipIf(process.env.AEGIR_EDITOR_SMOKE !== '1')('collects comments on a document and sends them to Claude in one message', async () => {
  const server = await createServer({
    configFile: false, esbuild: { jsx: 'automatic' }, appType: 'custom',
    // node_modules can be a symlink (a git worktree): allow its real folder, keep one React, keep the cache private.
    server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd(), realpathSync('node_modules')] }, watch: { ignored: ['**/release/**'] } },
    resolve: { dedupe: ['react', 'react-dom'] }, cacheDir: join(tmpdir(), 'aegir-document-review-smoke'),
  });
  server.middlewares.use('/document-review', (_req, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<div id="root"></div><script type="module" src="/src/ui/testing/document-review.tsx"></script>');
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const url = `${server.resolvedUrls!.local[0]}document-review`;
    // A cold first load makes Vite optimise dependencies and reload the page, so start from a settled second load.
    await page.goto(url);
    await page.waitForFunction(() => Boolean((document.querySelector('.ws-document-prose') as any)?.editor), undefined, { timeout: 30_000 }).catch(() => {});
    await page.goto(url);
    await page.waitForFunction(() => Boolean((document.querySelector('.ws-document-prose') as any)?.editor), undefined, { timeout: 30_000 });
    errors.length = 0;
    await page.evaluate(() => { (window as any).editor = (document.querySelector('.ws-document-prose') as any).editor; });
    const select = (text: string) => page.evaluate((text) => {
      const editor = (window as any).editor;
      let from = -1;
      editor.state.doc.descendants((node: any, position: number) => { if (from < 0 && node.isText && node.text.includes(text)) from = position + node.text.indexOf(text); });
      editor.chain().focus().setTextSelection({ from, to: from + text.length }).run();
    }, text);
    const comment = async (passage: string, text: string) => {
      await select(passage);
      await page.getByRole('button', { name: 'Comment', exact: true }).click();
      await page.getByRole('textbox', { name: 'Comment' }).fill(text);
      await page.keyboard.press('Meta+Enter');
      await page.getByRole('dialog', { name: 'Add comment' }).waitFor({ state: 'detached' });
    };
    const send = page.locator('.ws-document-head [data-send-comments]');
    const fixture = <T,>(read: string) => page.evaluate((read) => (window as any).fixture[read], read) as Promise<T>;

    // No comments, no Send button. Two comments, in the order you left them, and the header offers to send both.
    expect(await send.count()).toBe(0);
    await comment('the 2027 cost base', 'Say which case Rasmus backs.');
    await comment('A paragraph that must stay', 'Cut this line.');
    await expect.poll(() => send.textContent()).toBe('Send 2 comments');
    // The Comments tab lists them in reading order, each under its passage.
    await page.getByRole('radio', { name: /Comments 2/ }).click();
    const listed = page.getByLabel('Comments to send').getByRole('listitem');
    expect(await listed.allInnerTexts()).toEqual([
      expect.stringMatching(/A paragraph that must stay\s+Cut this line\./),
      expect.stringMatching(/the 2027 cost base\s+Say which case Rasmus backs\./),
    ]);
    await page.screenshot({ path: '/tmp/legolas-document-review.png' });

    // An edit of your own goes with the batch as a note that the file holds your edits.
    await select('One decision');
    await page.waitForFunction(() => document.activeElement?.classList.contains('ws-document-prose'));
    await page.keyboard.type('Exactly one decision');
    // While Claude is working, Send waits.
    await page.evaluate(() => (window as any).fixture.setBusy(true));
    await expect.poll(() => send.isDisabled()).toBe(true);
    expect(await send.getAttribute('title')).toContain('Claude is working');
    await page.evaluate(() => (window as any).fixture.setBusy(false));

    // A failed send puts the comments back.
    await page.evaluate(() => { (window as any).fixture.fail = true; });
    await send.click();
    await page.getByText('Not sent. Your comments are back in the document.').waitFor();
    expect(await send.textContent()).toBe('Send 2 comments');
    await page.evaluate(() => { (window as any).fixture.fail = false; });

    // ⇧⌘↵ in the document sends them all in one message, then they leave the document and the saved file.
    await page.locator('.ws-document-prose').click();
    await page.keyboard.press('Meta+Shift+Enter');
    await page.getByText('Sent 2 comments to Claude').waitFor();
    const [sent] = await fixture<{ batch: any; message: string }[]>('sent');
    expect(sent.batch).toEqual({ path: 'board-update.md', edited: true, comments: [
      { passage: 'A paragraph that must stay', text: 'Cut this line.' },
      { passage: 'the 2027 cost base', text: 'Say which case Rasmus backs.' },
    ] });
    expect(sent.message).toContain('Review of `board-update.md`: 2 comments. I also edited the text directly.');
    expect(sent.message).toContain('> the 2027 cost base\n\nSay which case Rasmus backs.');
    expect(sent.message).toContain('Copy the file to `~/brain/drafts/2026-10-12-board-update.md` and commit it before you change anything, and again after.');
    expect(await send.count()).toBe(0);
    await expect.poll(async () => (await page.evaluate(() => (window as any).fixture.saved().content)) as string).not.toContain('aegir:comment');
    expect(await page.evaluate(() => (window as any).fixture.saved().content)).toContain('Exactly one decision');
    await page.getByText(/No comments yet/).waitFor();
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 90000);
