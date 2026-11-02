import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // `bun run` and Vitest both read the checkout's .env.local. Blank the API base so tests use the
    // default port, as in CI. ponytail: one key; a new VITE_ variable needs the same pin.
    env: { VITE_STUDIO_API_BASE: '' },
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
