/*
 * A tool of the live-org workflow that behaves as badly as a library can: it writes to both streams in every
 * way, past the streams to the file descriptors, from a process it starts, it warns, and it ends with an error
 * nobody caught whose message holds a secret. A test starts it to see that only the lines the tool printed
 * through its log come out (`live/own-output.ts`).
 *
 *   node noisy-tool.ts <secret> [reject | wait | quiet]
 */
import { spawnSync } from 'node:child_process';
import { writeSync } from 'node:fs';
import { asStep } from '../live/own-output.ts';

const [secret = '', how] = process.argv.slice(2);

await asStep(import.meta.filename, async (log) => {
  console.log(`log ${secret}`);
  console.error(`error ${secret}`);
  console.warn(`warn ${secret}`);
  process.stdout.write(`stdout ${secret}\n`);
  process.stderr.write(`stderr ${secret}\n`);
  for (const stream of [1, 2]) {
    try {
      writeSync(stream, `descriptor ${secret}\n`);
    } catch {
      // A stream that leads nowhere may refuse.
    }
  }
  spawnSync(process.execPath, ['-e', `console.log('child ${secret}'); console.error('child ${secret}')`], {
    stdio: 'inherit',
  });
  process.emitWarning(`warning ${secret}`);
  // Code that waits until its line is written goes on.
  await new Promise<void>((resolve) => {
    process.stdout.write(`waited ${secret}\n`, () => {
      resolve();
    });
  });
  log.say('A line of the tool itself.');
  log.say('Two lines\n::error::in one.');

  if (how === 'quiet') return;
  if (how === 'wait') {
    // Ends without a word, as a process that is killed does.
    process.exit(3);
  }
  if (how === 'reject') void Promise.reject(new TypeError(`rejected ${secret}`));
  else
    setTimeout(() => {
      throw new RangeError(`thrown ${secret}`);
    }, 0);
  await new Promise((resolve) => setTimeout(resolve, 200));
});
