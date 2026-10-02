import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createBrowserBackend, type BrowserBackend } from './browser-backend.js';
import { mcpToolResult } from './tool-result.js';

// Explicit integration check: uses installed Chrome and a disposable profile,
// no accounts or external websites. AEGIR_BROWSER_SMOKE=1 pnpm test electron/browser-smoke.test.ts
it.skipIf(process.env.AEGIR_BROWSER_SMOKE !== '1')('browses, interacts, sees images, persists login state and closes Chrome', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aegir-browser-smoke-'));
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/remember') response.setHeader('Set-Cookie', 'aegir_test=remembered; Max-Age=3600; Path=/');
    response.end(`<h1>Browser test</h1><label>Name <input aria-label="Name"></label><button onclick="document.querySelector('output').textContent='Hello '+document.querySelector('input').value">Greet</button><output></output><p>${request.headers.cookie || 'No cookie'}</p>`);
  });
  let backend: BrowserBackend | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}`;
    backend = await createBrowserBackend(root, true);
    const tools = await backend.listTools();
    expect(tools.tools.some(tool => tool.name === 'browser_snapshot')).toBe(true);
    const invoke = async (name: string, args: Record<string, unknown>) => {
      const result = await backend!.callTool(name, args);
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      return result;
    };
    const nav = await invoke('browser_navigate', { url: `${url}/remember` });
    expect(JSON.stringify(nav.content)).toContain('Browser test');
    await invoke('browser_type', { target: 'role=textbox[name="Name"]', text: 'Aegir' });
    const clicked = await invoke('browser_click', { target: 'role=button[name="Greet"]' });
    expect(JSON.stringify(clicked.content)).toContain('Hello Aegir');
    const screenshot = mcpToolResult(await invoke('browser_take_screenshot', { type: 'png', scale: 'css' }));
    expect(screenshot.contentItems.some(item => item.type === 'inputImage' && item.imageUrl.startsWith('data:image/png;base64,'))).toBe(true);
    await backend.close();
    backend = await createBrowserBackend(root, true);
    const reopened = await invoke('browser_navigate', { url });
    expect(JSON.stringify(reopened.content)).toContain('aegir_test=remembered');
  } finally {
    await backend?.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
