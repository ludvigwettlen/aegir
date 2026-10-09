import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['electron/**/*.test.ts', 'shared/**/*.test.ts', 'src/ui/**/*.test.ts'], environment: 'node' } });
