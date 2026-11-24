import { defineConfig } from 'vitest/config';

// Many tests start Git or a second Node.js process several times. That costs far more on Windows than on Linux, and
// more still on some Windows machines. With a limit of 20 seconds, two tests failed on a Windows machine of the
// maintainer, though the Windows runners of CI pass them. One starts Git 34 times and took 2 seconds on a Windows
// runner. The other starts four Node.js processes, three of which load the Salesforce library, and took 19 seconds on
// the same runner. So the limit of a test and of a hook is 60 seconds on Windows. Whether that is enough on that
// machine is not verified. Linux and macOS keep 20 seconds, so that a test that waits by mistake still fails early
// there. `--testTimeout` and `--hookTimeout` change these two limits. They do not change the limit a test sets for
// itself.
const LIMIT_MS = process.platform === 'win32' ? 60_000 : 20_000;

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
    testTimeout: LIMIT_MS,
    // A hook does the same kind of work: `org-snapshot.test.ts` copies a part of the fixture project into a
    // temporary folder before its tests. On a Windows runner that did not end within the default of 10 seconds once.
    hookTimeout: LIMIT_MS,
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
