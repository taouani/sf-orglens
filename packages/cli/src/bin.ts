#!/usr/bin/env node
/*
 * Entry point of the `orglens` binary.
 *
 * This file checks the Node.js version before anything else is loaded, so an
 * unsupported runtime gets one clear message instead of a syntax or import
 * error from deep inside a dependency. Keep it free of static imports and of
 * syntax newer than what old Node.js releases can parse.
 */
const MINIMUM_NODE = [24, 15] as const;

const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
const supported = major > MINIMUM_NODE[0] || (major === MINIMUM_NODE[0] && minor >= MINIMUM_NODE[1]);

if (!supported) {
  process.stderr.write(
    `orglens needs Node.js ${String(MINIMUM_NODE[0])}.${String(MINIMUM_NODE[1])} or newer. ` +
      `This is Node.js ${process.versions.node}.\n`,
  );
  process.exitCode = 1;
} else {
  import('./main.ts')
    .then((cli) => cli.main(process.argv))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      process.stderr.write(`orglens: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
