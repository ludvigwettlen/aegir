import { expect, it } from 'vitest';
import { _electron } from 'playwright';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Run after pnpm build; all app data and task edits are confined to a disposable installation.
it.skipIf(process.env.AEGIR_ELECTRON_SMOKE !== '1')('uses the sandboxed preload and rejects invalid or foreign-window IPC in the built app', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aegir-ipc-smoke-'));
  const harness = join(root, 'main.cjs');
  const documents = join(root, 'documents'); mkdirSync(documents);
  writeFileSync(harness, `const { app } = require('electron');\napp.setName('Aegir IPC Test');\napp.setPath('userData', ${JSON.stringify(root)});\napp.setPath('documents', ${JSON.stringify(documents)});\nimport(${JSON.stringify(pathToFileURL(resolve('dist-electron/main.js')).href)});\n`);
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')); delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  let application: Awaited<ReturnType<typeof _electron.launch>> | undefined;
  try {
    application = await _electron.launch({ executablePath: process.execPath, args: [harness], env });
    const page = await application.firstWindow();
    await application.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.hide(); });
    await page.waitForFunction(() => Boolean((window as any).aegir));
    expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined');
    const count = await page.evaluate(async () => (await (window as any).aegir.snapshot()).tasks.length);
    await page.evaluate(async () => {
      const api = (window as any).aegir;
      const task = await api.createTask({ title: 'Verified through sandboxed IPC' });
      const file = await api.createDocument(task.id, 'Smoke');
      await api.saveDocument(task.id, file.path, file.revision, '# Saved through IPC');
      const image = await api.importDocumentImage(task.id, file.path, 'smoke.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
      if (!(await api.readDocumentImage(task.id, file.path, image)).startsWith('data:image/png;base64,')) throw new Error('Image bytes did not cross the sandboxed bridge');
    });
    expect(await page.evaluate(async () => (await (window as any).aegir.snapshot()).tasks.length)).toBe(count + 1);
    const malformed = await page.evaluate(async () => {
      try { await (window as any).aegir.resolveApproval('unknown', 'false' as unknown as boolean); return 'unexpected success'; }
      catch (error) { return String(error); }
    });
    expect(malformed).toContain('Invalid arguments');
    const extraWindow = application.waitForEvent('window');
    await application.evaluate(async ({ BrowserWindow }, preload) => {
      const original = BrowserWindow.getAllWindows()[0];
      const extra = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true } });
      await extra.loadURL(original.webContents.getURL());
    }, resolve('dist-electron/preload.cjs'));
    const extra = await extraWindow;
    await extra.waitForFunction(() => Boolean((window as any).aegir));
    const foreign = await extra.evaluate(async () => {
      try { await (window as any).aegir.snapshot(); return 'unexpected success'; }
      catch (error) { return String(error); }
    });
    expect(foreign).toContain('Untrusted IPC caller');
  } finally { await application?.close(); rmSync(root, { recursive: true, force: true }); }
}, 45_000);
