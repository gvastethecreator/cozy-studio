import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    setupFiles: ['./scripts/vitest-browser-setup.ts'],
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.scratch/**',
      '**/.claude/**',
      '**/*.bun.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
