// Screenshots every UI fixture's first screen, plus a few screens reached through the palette, for a design check.
// Usage: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron mockups/tour.mjs <out-dir>
import { mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const out = process.argv[2] || 'mockups/tour'; mkdirSync(out, { recursive: true });
const fixtures = readdirSync('src/ui/testing').filter(name => name.endsWith('.tsx')).map(name => name.slice(0, -4));
const server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, appType: 'custom', logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd(), realpathSync('node_modules')] } },
  resolve: { dedupe: ['react', 'react-dom'] }, cacheDir: join(tmpdir(), 'aegir-glass-tour') });
for (const name of fixtures) server.middlewares.use(`/${name}`, (_q, r) => { r.setHeader('Content-Type', 'text/html'); r.end(`<div id="root"></div><script type="module" src="/src/ui/testing/${name}.tsx"></script>`); });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const base = server.resolvedUrls.local[0];
const visit = async (name, steps = async () => {}, label = name) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(6000);
  try {
    await page.goto(base + name); await page.waitForTimeout(2500); await page.goto(base + name); await page.waitForTimeout(1500);
    await steps(page); await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, `${label}.png`) }); console.log('ok', label);
  } catch (error) { console.log('FAILED', label, String(error).split('\n')[0]); }
  await page.close();
};
for (const name of fixtures) await visit(name);
const palette = (query) => async (page) => { await page.keyboard.press('Meta+K'); await page.keyboard.type(query); await page.keyboard.press('Enter'); await page.waitForTimeout(600); };
await visit('glass-mockup', palette('go general'), 'zz-group-general');
await visit('glass-mockup', palette('go hourly'), 'zz-routine');
await visit('glass-mockup', async (page) => { await page.locator('[data-task-row]', { hasText: 'Follow up with Nordvik' }).click(); await page.keyboard.press('f'); await page.waitForTimeout(500); }, 'zz-fullscreen');
await visit('glass-mockup', async (page) => {
  await page.locator('[data-task-row]', { hasText: 'Follow up with Nordvik' }).click();
  await page.locator('[data-document-files]').click();
  await page.locator('.ws-document-file-open').first().click();
  await page.locator('.document-open').waitFor(); await page.waitForTimeout(600);
}, 'zz-document-open');
await visit('glass-mockup', async (page) => { await page.keyboard.press('Backquote'); await page.waitForTimeout(300); }, 'zz-hints');
await browser.close(); await server.close();
