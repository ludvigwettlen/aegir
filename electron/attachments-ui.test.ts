import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from 'playwright';

it.skipIf(process.env.AEGIR_UI_SMOKE !== '1')('drops files on a task conversation, sends them, and files one in the brain', async () => {
  const server = await createServer({
    configFile: false, esbuild: { jsx: 'automatic' }, appType: 'custom',
    // node_modules can be a symlink (a git worktree): allow its real folder, keep one React, keep the cache private.
    server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd(), realpathSync('node_modules')] } },
    resolve: { dedupe: ['react', 'react-dom'] }, cacheDir: join(tmpdir(), 'aegir-attachments-smoke'),
  });
  server.middlewares.use('/attachments', (_req, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<div id="root"></div><script type="module" src="/src/ui/testing/attachments.tsx"></script>');
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const url = `${server.resolvedUrls!.local[0]}attachments`;
    // A cold first load makes Vite optimise dependencies and reload the page, so start from a settled second load.
    await page.goto(url);
    await page.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 30_000 }).catch(() => {});
    await page.goto(url);
    await page.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 30_000 });
    errors.length = 0;
    const calls = () => page.evaluate(() => (window as any).fixture.calls as unknown[][]);
    const drop = (names: string[]) => page.evaluate((files) => {
      const data = new DataTransfer();
      for (const name of files) data.items.add(new File(['12345678'], name, { type: 'application/octet-stream' }));
      document.querySelector('.ws-composer-wrap')!.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true }));
    }, names);
    const chips = page.locator('.ws-attachments:not(.sent) > span');
    const chipsAre = (count: number) => page.waitForFunction(n => document.querySelectorAll('.ws-attachments:not(.sent) > span').length === n, count);
    const fileRow = (name: string) => page.locator('.ws-detail-meta .ws-task-link', { hasText: name });

    await page.getByRole('button', { name: 'Needs you', exact: true }).click();
    await page.getByRole('textbox', { name: 'Message' }).waitFor();

    // One file is copied into the task folder; the one over the cap says why and keeps its place.
    await drop(['Q3-board-pack.pdf', 'huge.bin']);
    await chipsAre(2);
    expect(await chips.first().textContent()).toContain('Q3-board-pack.pdf');
    expect(await chips.first().textContent()).toContain('8 B');
    expect(await chips.last().textContent()).toContain('the limit is 50 MB');
    expect(await calls()).toContainEqual(['stageFiles', 'board-thread', ['/Users/m/Downloads/Q3-board-pack.pdf', '/Users/m/Downloads/huge.bin']]);

    // A refused chip is dropped locally, with no second call about bytes that were never copied.
    await chips.last().getByRole('button', { name: 'Remove huge.bin' }).click();
    await chipsAre(1);
    expect((await calls()).some(call => call[0] === 'removeTaskFile')).toBe(false);

    // A rejected send keeps the draft and the chip: the bytes are already in the folder.
    await page.evaluate(() => { (window as any).fixture.rejectNextSend = true; });
    await page.getByRole('textbox', { name: 'Message' }).fill('Pull the three numbers that changed');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByRole('alert').getByText('already working', { exact: false }).waitFor();
    await chipsAre(1);
    expect(await page.getByRole('textbox', { name: 'Message' }).inputValue()).toBe('Pull the three numbers that changed');

    await page.getByRole('button', { name: 'Send' }).click();
    await chipsAre(0);
    expect(await calls()).toContainEqual(['sendMessage', 'board-thread', 'Pull the three numbers that changed', ['file-1']]);

    // The sent message carries its file, and so does the task.
    const sent = page.locator('.ws-attachments.sent button', { hasText: 'Q3-board-pack.pdf' });
    await sent.waitFor();
    await sent.click();
    expect(await calls()).toContainEqual(['openTaskFile', 'file-1']);

    // Files row on the task: open it, file it in the brain, remove it.
    const row = fileRow('Q3-board-pack.pdf');
    await row.waitFor();
    await row.getByRole('button', { name: 'File Q3-board-pack.pdf in the brain' }).click();
    expect(await calls()).toContainEqual(['fileToBrain', 'file-1', 'q3-board-pack']);
    // Filed once, so the action goes and the agent is asked to write the page and the Timeline entries.
    await row.getByRole('button', { name: 'File Q3-board-pack.pdf in the brain' }).waitFor({ state: 'detached' });
    expect((await calls()).at(-1)?.[2]).toContain('/Users/m/brain/sources/q3-board-pack/.raw/Q3-board-pack.pdf');
    await row.getByRole('button', { name: 'Remove attachment Q3-board-pack.pdf' }).click();
    expect(await calls()).toContainEqual(['removeTaskFile', 'file-1']);
    await fileRow('Q3-board-pack.pdf').waitFor({ state: 'detached' });

    // A pasted screenshot has no path, so the main process reads it off the clipboard instead.
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File(['89504e47'], 'image.png', { type: 'image/png' }));
      document.querySelector('.ws-composer textarea')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
    });
    await chipsAre(1);
    expect((await calls()).at(-1)).toEqual(['stageClipboardFile', 'board-thread']);
    expect(await chips.first().textContent()).toContain('pasted.png');
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    await server.close();
  }
}, 120_000);
