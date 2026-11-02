import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // The checkout's .env.local reaches tests: `bun run` loads it into process.env and Vite loads its
    // VITE_ keys. Blank the API base so tests use the default port, as in CI; services/studioRuntime.ts
    // and scripts/studio-onboard.ts treat a blank value as unset. ponytail: one key; pin any other
    // .env.local key that a test starts to read.
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
