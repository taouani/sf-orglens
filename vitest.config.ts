import { defineConfig } from 'vitest/config';

// The `@sf-orglens/source` condition makes the tests resolve the engine
// package to its TypeScript source, so no build is needed before testing.
export default defineConfig({
  resolve: { conditions: ['@sf-orglens/source'] },
  ssr: { resolve: { conditions: ['@sf-orglens/source'] } },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // Gives every test file an empty home folder. The tests of the logins rely on it, and no test may see the
    // real one. It needs a process per test file: the home folder is a property of the process.
    setupFiles: ['./tools/vitest-setup.js'],
    pool: 'forks',
    // Many tests start Git or a second Node.js process several times. On the Windows runners of CI one such test
    // takes up to 4 seconds, which leaves no room below the default of 5.
    testTimeout: 20_000,
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
