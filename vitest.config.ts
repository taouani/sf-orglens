import { defineConfig } from 'vitest/config';

// The `@sf-orglens/source` condition makes the tests resolve the engine
// package to its TypeScript source, so no build is needed before testing.
export default defineConfig({
  resolve: { conditions: ['@sf-orglens/source'] },
  ssr: { resolve: { conditions: ['@sf-orglens/source'] } },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'trial/*/test/**/*.test.ts'],
    // Gives every test file an empty home folder. The tests of the logins rely on it, and no test may see the
    // real one. It needs a process per test file: the home folder is a property of the process.
    setupFiles: ['./tools/vitest-setup.js'],
    pool: 'forks',
    // Many tests start Git or a second Node.js process several times, which costs far more on Windows than on
    // Linux. With a limit of 20 seconds, two tests failed on a Windows machine that starts programs more slowly
    // than the runners of CI: one starts Git 34 times, the other two Node.js processes that load the Salesforce
    // library. On Linux they take 0.1 and 6 seconds. A machine slower still can raise the limit with `--testTimeout`.
    testTimeout: 60_000,
    // A hook does the same kind of work: `org-snapshot.test.ts` copies a part of the fixture project into a
    // temporary folder before its tests. On a Windows runner that did not end within the default of 10 seconds once.
    hookTimeout: 60_000,
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
