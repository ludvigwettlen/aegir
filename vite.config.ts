import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

export default defineConfig({
  plugins: [react(), electron({ main: { entry: 'electron/main.ts', vite: { build: { rollupOptions: { external: ['better-sqlite3', '@playwright/mcp', 'playwright', '@anthropic-ai/claude-agent-sdk'] } } } }, preload: { input: 'electron/preload.ts', vite: { build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'preload.cjs' } } } } }, renderer: {} })],
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist' }
});
