import { createRequire } from 'node:module';
// Updater staging must handle app.asar as an ordinary file, including during cleanup.
export const updateFs = createRequire(import.meta.url)('original-fs') as typeof import('node:fs');
