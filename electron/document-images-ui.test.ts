import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { importDocumentImage, readDocumentImage } from './document-images';
import { readDocument, saveDocument } from './documents';

it.skipIf(process.env.AEGIR_EDITOR_SMOKE !== '1')('loads, inserts, pastes and drops portable Markdown images', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aegir-image-ui-')); mkdirSync(join(root, 'docs'));
  const path = 'docs/plan.md';
  writeFileSync(join(root, path), '# Pictures\n\n![Existing](existing.png)\n\nAdd an image here.');
  const server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/release/**'] } }, appType: 'custom' });
  const csp = readFileSync('index.html', 'utf8').match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)![0];
  server.middlewares.use('/images-test', (_req, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html><head>${csp}</head><body><div id="root"></div><script type="module" src="/src/ui/testing/document-images.tsx"></script></body></html>`);
  });
  let png: Buffer; let remoteRequests = 0;
  server.middlewares.use('/remote.png', (_req, response) => { remoteRequests++; response.setHeader('Content-Type', 'image/png'); response.end(png); });
  server.middlewares.use('/image-api', async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const { op, args } = JSON.parse(Buffer.concat(chunks).toString());
      const result = op === 'read' ? readDocument(root, path) : op === 'save' ? saveDocument(root, path, args[0], args[1])
        : op === 'image' ? readDocumentImage(root, path, args[0]) : importDocumentImage(root, path, args[0], new Uint8Array(args[1]));
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(result));
    } catch (error) { response.statusCode = 400; response.end(JSON.stringify({ error: (error as Error).message })); }
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 820 } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    const data = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 520; canvas.height = 200;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#edf8d2'; ctx.fillRect(0, 0, 520, 200);
      ctx.fillStyle = '#42622c'; ctx.font = '24px sans-serif'; ctx.fillText('A picture in the plan', 32, 105); return canvas.toDataURL().split(',')[1];
    });
    png = Buffer.from(data, 'base64'); writeFileSync(join(root, 'docs/existing.png'), png);
    const url = `${server.resolvedUrls!.local[0]}images-test`;
    const load = async () => {
      await page.goto(url);
      await page.waitForFunction(() => Boolean((document.querySelector('.ws-document-prose') as any)?.editor));
      await page.evaluate(() => { (window as any).editor = (document.querySelector('.ws-document-prose') as any).editor; });
    };
    await load();
    const prose = page.getByRole('textbox', { name: 'Document', exact: true });
    const source = () => page.evaluate(() => (window as any).editor.getMarkdown());
    const reset = async (content: string) => {
      await page.evaluate(content => { const editor = (window as any).editor; editor.commands.setContent(content, { contentType: 'markdown' }); editor.commands.focus('end'); }, content);
      await page.waitForFunction(() => (window as any).editor.isFocused);
    };
    const saved = () => expect.poll(() => page.locator('.ws-document-head > [role="status"]').innerText()).toBe('Saved');
    await expect.poll(() => page.getByRole('img', { name: 'Existing', exact: true }).evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(520);
    await page.evaluate(() => (window as any).editor.commands.focus('end'));
    await page.getByRole('button', { name: 'Insert image', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Insert image' });
    const choosing = page.waitForEvent('filechooser'); await form.getByRole('button', { name: 'Choose image files…' }).click();
    await (await choosing).setFiles({ name: 'My diagram (draft).png', mimeType: 'image/png', buffer: png });
    await form.waitFor({ state: 'detached' });
    await page.getByRole('img', { name: 'My diagram (draft)', exact: true }).waitFor();
    expect(await source()).toContain('plan.assets/My-diagram-draft-');
    expect(await source()).not.toContain('data:');
    await page.evaluate(() => (window as any).editor.commands.undo());
    expect(await prose.locator('img').count()).toBe(1);
    await page.evaluate(() => (window as any).editor.commands.redo());
    await saved(); const withFile = await source();
    await load(); expect(await source()).toBe(withFile);
    await page.getByRole('img', { name: 'My diagram (draft)', exact: true }).waitFor();
    // Slash insertion accepts URLs and keeps escaped descriptions through reload.
    await reset(''); await page.keyboard.type('/image'); await page.keyboard.press('Enter');
    await form.getByLabel('Image URL or relative path').fill(`${server.resolvedUrls!.local[0]}remote.png`);
    await form.getByLabel('Description (alt text)').fill('Remote [example]');
    await form.getByRole('button', { name: 'Insert image', exact: true }).click();
    await page.getByRole('button', { name: 'Load remote image', exact: true }).waitFor();
    expect(remoteRequests).toBe(0);
    await page.getByRole('button', { name: 'Load remote image', exact: true }).click();
    await page.getByRole('img', { name: 'Remote [example]', exact: true }).waitFor();
    expect(await source()).not.toContain('/image');
    await saved(); await load();
    await page.getByRole('button', { name: 'Load remote image', exact: true }).waitFor();
    expect(await page.getByRole('img', { name: 'Remote [example]', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Load remote image', exact: true }).click();
    await page.getByRole('img', { name: 'Remote [example]', exact: true }).waitFor();
    const beforeCancel = await source();
    await page.getByRole('button', { name: 'Insert image', exact: true }).click();
    await page.screenshot({ path: '/tmp/aegir-image-insert.png' });
    await form.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await source()).toBe(beforeCancel);
    // A clipboard file is saved as an asset, and edits during import are retained.
    await reset('Pasted here');
    await page.evaluate(() => { (window as any).delayImport = true; });
    const clipboard = await page.evaluateHandle(data => {
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' })); return transfer;
    }, data);
    await prose.evaluate((element, transfer) => element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })), clipboard);
    await page.waitForFunction(() => Boolean((window as any).resumeImport));
    await page.keyboard.type(' with more text');
    await page.evaluate(() => { (window as any).delayImport = false; (window as any).resumeImport(); });
    await page.getByRole('img', { name: 'clipboard', exact: true }).waitFor();
    expect(await source()).toContain('Pasted here with more text');
    expect(await source()).toContain('plan.assets/clipboard-');
    await reset('Dropped here');
    const bounds = (await prose.boundingBox())!;
    await prose.dispatchEvent('drop', { dataTransfer: clipboard, clientX: bounds.x + 20, clientY: bounds.y + 10 });
    await page.getByRole('img', { name: 'clipboard', exact: true }).waitFor();
    expect(await page.evaluate(() => (window as any).editor.state.doc.textContent)).toBe('Dropped here');
    const imageSource = await page.evaluate(() => {
      let src = ''; (window as any).editor.state.doc.descendants((node: any) => { if (node.type.name === 'image') src = node.attrs.src; }); return src;
    });
    await reset(`# Image support\n\nA picture in the plan.\n\n![Diagram](${imageSource})`);
    await page.getByRole('img', { name: 'Diagram', exact: true }).waitFor();
    await page.setViewportSize({ width: 460, height: 760 });
    await page.screenshot({ path: '/tmp/aegir-markdown-image.png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Invalid files report an error without changing document contents.
    const beforeFailure = await source();
    await prose.evaluate(element => {
      const transfer = new DataTransfer(); transfer.items.add(new File(['invalid'], 'fake.png', { type: 'image/png' }));
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
    });
    await page.getByRole('alert').filter({ hasText: 'Choose a PNG' }).waitFor();
    expect(await source()).toBe(beforeFailure);
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    // Missing local images retain their source and recover on Retry.
    await reset('![Missing](missing.png)'); await prose.getByRole('button', { name: 'Retry image' }).waitFor();
    expect(await source()).toContain('missing.png');
    writeFileSync(join(root, 'docs/missing.png'), png);
    await prose.getByRole('button', { name: 'Retry image' }).click(); await page.getByRole('img', { name: 'Missing' }).waitFor();
    await saved();
    writeFileSync(join(root, path), '![Missing](missing.png)\n\n<div>Unsupported HTML</div>');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => !(window as any).editor.isEditable);
    expect(await page.getByRole('button', { name: 'Insert image', exact: true }).isEnabled()).toBe(false);
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); rmSync(root, { recursive: true, force: true }); }
}, 60000);
