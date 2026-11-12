import { defineConfig } from 'vitest/config';

// The `@sf-orglens/source` condition makes the tests resolve the engine
// package to its TypeScript source, so no build is needed before testing.
export default defineConfig({
  resolve: { conditions: ['@sf-orglens/source'] },
  ssr: { resolve: { conditions: ['@sf-orglens/source'] } },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      // bin.ts only runs as a child process, where v8 coverage of the test
      // run cannot see it. The CLI tests start it for every case they check.
      exclude: ['packages/cli/src/bin.ts'],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 85, functions: 85, statements: 85, branches: 80 },
    },
  },
});
