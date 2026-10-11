// Renders the glass-mockup sample screen in Chrome and screenshots four views per theme.
// Usage (from the worktree): ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron mockups/shoot.mjs <out-dir> [theme ...]
// A theme is a CSS file in mockups/themes/ (without .css); "current" means no extra CSS.
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const [out = 'mockups/out', ...themes] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const server = await createServer({
  configFile: false, esbuild: { jsx: 'automatic' }, appType: 'custom', logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd(), realpathSync('node_modules')] } },
  resolve: { dedupe: ['react', 'react-dom'] }, cacheDir: join(tmpdir(), 'aegir-glass-mockup'),
});
server.middlewares.use('/glass-mockup', (_req, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end('<div id="root"></div><script type="module" src="/src/ui/testing/glass-mockup.tsx"></script>');
});
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const url = `${server.resolvedUrls.local[0]}glass-mockup`;
try {
  for (const theme of themes.length ? themes : ['current']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    page.setDefaultTimeout(8000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    // A cold first load makes Vite optimise dependencies and reload; shoot on a settled second load.
    await page.goto(url); await page.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 30_000 }).catch(() => {});
    await page.goto(url); await page.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 30_000 });
    // Every shot gets the window buttons; "a+b" layers theme b on top of theme a.
    for (const part of ['chrome', ...(theme === 'current' ? [] : theme.split('+'))]) await page.addStyleTag({ content: readFileSync(`mockups/themes/${part}.css`, 'utf8') });
    await page.mouse.move(5, 895);
    const shot = async (name) => { await page.waitForTimeout(350); await page.screenshot({ path: join(out, `${theme.split('+').pop()}-${name}.png`) }); };

    await shot('1-today');
    await page.locator('[data-task-row]', { hasText: 'Follow up with Nordvik' }).click();
    await page.getByRole('article', { name: /Email draft/ }).first().waitFor();
    await page.mouse.move(5, 895);
    await shot('2-task-open');
    await page.keyboard.press('Meta+K');
    await page.getByRole('dialog', { name: 'Command palette' }).waitFor();
    await page.keyboard.type('due');
    await shot('3-command-palette');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Command palette' }).waitFor({ state: 'detached' });
    await page.locator('[data-task-row]', { hasText: 'Answer Tove' }).click();
    await page.keyboard.press('Escape');
    await page.locator('[data-task-row]', { hasText: 'Answer Tove' }).focus();
    await page.keyboard.press('d');
    await page.getByRole('dialog', { name: 'Set due date' }).waitFor();
    await shot('4-due-date');
    if (errors.length) console.log(theme, 'page errors:', errors.join(' | '));
    console.log('shot', theme);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
