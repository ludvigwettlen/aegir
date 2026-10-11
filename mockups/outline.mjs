// Prints the rendered DOM as an outline of class names, to find what a theme has to style.
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, appType: 'custom', logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd(), realpathSync('node_modules')] } },
  resolve: { dedupe: ['react', 'react-dom'] }, cacheDir: join(tmpdir(), 'aegir-glass-mockup') });
server.middlewares.use('/glass-mockup', (_q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<div id="root"></div><script type="module" src="/src/ui/testing/glass-mockup.tsx"></script>'); });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const url = `${server.resolvedUrls.local[0]}glass-mockup`;
await page.goto(url); await page.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 30000 }).catch(() => {});
await page.goto(url); await page.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 30000 });
await page.locator('[data-task-row]', { hasText: 'Follow up with Nordvik' }).click();
await page.getByRole('article', { name: /Email draft/ }).first().waitFor();
const outline = () => page.evaluate(() => {
  const out = []; const seen = new Set();
  const walk = (el, depth) => {
    if (depth > 9) return;
    const cls = [...el.classList].join('.');
    const key = depth + el.tagName + cls;
    if (cls && !seen.has(key)) { seen.add(key); out.push('  '.repeat(depth) + el.tagName.toLowerCase() + '.' + cls); }
    for (const child of el.children) walk(child, cls ? depth + 1 : depth);
  };
  walk(document.getElementById('root'), 0);
  return out.join('\n');
});
console.log(await outline());
await page.keyboard.press('Meta+K'); await page.getByRole('dialog', { name: 'Command palette' }).waitFor();
console.log('=== PALETTE'); console.log(await page.evaluate(() => { const d = document.querySelector('[role=dialog][aria-label="Command palette"]'); let n = d; const chain = []; while (n && n !== document.body) { chain.unshift(n.tagName.toLowerCase() + '.' + [...n.classList].join('.')); n = n.parentElement; } return chain.join(' > ') + '\n' + [...new Set([...d.querySelectorAll('*')].map(e => [...e.classList].join('.')).filter(Boolean))].join('\n'); }));
await page.keyboard.press('Escape');
await page.locator('[data-task-row]', { hasText: 'Answer Tove' }).click(); await page.keyboard.press('Escape');
await page.locator('[data-task-row]', { hasText: 'Answer Tove' }).focus(); await page.keyboard.press('d');
await page.getByRole('dialog', { name: 'Set due date' }).waitFor();
console.log('=== DUE'); console.log(await page.evaluate(() => { const d = document.querySelector('[role=dialog][aria-label="Set due date"]'); let n = d; const chain = []; while (n && n !== document.body) { chain.unshift(n.tagName.toLowerCase() + '.' + [...n.classList].join('.')); n = n.parentElement; } return chain.join(' > '); }));
await browser.close(); await server.close();
