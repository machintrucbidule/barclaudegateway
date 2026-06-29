import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolve the workspace `@barclaudegateway/shared` to its TS SOURCE for tests, so the suite never
  // depends on the package being built first (its `exports` point at `dist/`, which is gitignored and is
  // produced only by `npm run build` — and CI runs `test` before `build`). This makes both CI and local
  // `npm test` work without a prior `build -w @barclaudegateway/shared`.
  resolve: {
    alias: {
      '@barclaudegateway/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    // Only run TypeScript sources, never compiled output in dist/.
    include: ['src/**/*.test.ts'],
  },
});
