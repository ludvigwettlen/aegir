import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createConnection } from '@playwright/mcp';
import { chromium, type BrowserContext } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type BrowserBackend = {
  listTools(): Promise<{ tools: { name: string; description?: string; inputSchema: Record<string, unknown> }[] }>;
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ content?: unknown; isError?: unknown }>;
  close(): Promise<void>;
};

// No listening socket, shell, browser extension, or access to the user's Chrome
// profile. Chrome runs visibly with a separate persistent profile owned by Ägir.
export async function createBrowserBackend(root: string, headless = false): Promise<BrowserBackend> {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  let context: Promise<BrowserContext> | undefined;
  let closed = false;
  const server = await createConnection({
    browser: {
      browserName: 'chromium', userDataDir: join(root, 'profile'),
      launchOptions: { channel: 'chrome', headless },
      contextOptions: { viewport: { width: 1280, height: 800 }, acceptDownloads: false },
    },
    capabilities: ['core'], webmcp: false,
    snapshot: { mode: 'none' }, codegen: 'none',
    imageResponses: 'allow', outputDir: join(root, 'captures'), outputMaxSize: 30 * 1024 * 1024,
    allowUnrestrictedFileAccess: false,
    timeouts: { action: 10_000, navigation: 30_000 },
  }, async () => {
    if (closed) throw new Error('Browser session has ended');
    if (!context) context = chromium.launchPersistentContext(join(root, 'profile'), {
      channel: 'chrome', headless, timeout: 30_000,
      viewport: { width: 1280, height: 800 }, acceptDownloads: false,
    }).then(value => {
      value.once('close', () => { context = undefined; });
      return value;
    }).catch(error => { context = undefined; throw error; });
    return context;
  });
  const client = new Client({ name: 'aegir-browser', version: '0.1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  } catch (error) {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
    throw error;
  }
  return {
    listTools: () => client.listTools(),
    callTool: async (name, args, signal) => {
      const result = await client.callTool({ name, arguments: args }, undefined, { signal, timeout: 45_000 });
      const content = Array.isArray(result.content) ? result.content : [];
      // This backend version writes automatic snapshots to files. Ask explicitly
      // for an inline snapshot so the model receives targets in the same result.
      if (!result.isError && name !== 'browser_snapshot' && name !== 'browser_take_screenshot' && !signal?.aborted) {
        try {
          const snapshot = await client.callTool({ name: 'browser_snapshot', arguments: {} }, undefined, { signal, timeout: 15_000 });
          if (snapshot.isError) content.push({ type: 'text', text: 'The action completed, but follow-up inspection failed. Inspect the page before deciding what to do next; do not repeat the action solely because inspection failed.' });
          if (Array.isArray(snapshot.content)) content.push(...snapshot.content);
        } catch (error) {
          if (signal?.aborted) throw error;
          content.push({ type: 'text', text: `The action completed, but follow-up inspection failed: ${String(error)}. Use browser_snapshot before taking another action; do not repeat the completed action.` });
        }
      }
      return { content, isError: result.isError };
    },
    close: async () => {
      closed = true;
      const pendingContext = context;
      await Promise.allSettled([client.close(), server.close()]);
      // The MCP close event starts disposal without awaiting it. Wait explicitly
      // for Chrome here before another response opens the persistent profile.
      await (await pendingContext?.catch(() => undefined))?.close();
    },
  };
}
