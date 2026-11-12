/*
 * A tool of the live-org workflow that behaves as badly as a library can: it writes to both streams in every
 * way, warns, and ends with an error nobody caught whose message holds a secret. A test starts it to see that
 * only the line the tool printed itself comes out (`live/own-output.ts`).
 *
 *   node noisy-tool.ts <secret> [reject]
 */
import { ownOutputOnly } from '../live/own-output.ts';

const print = ownOutputOnly();
const [secret = '', how] = process.argv.slice(2);

console.log(`log ${secret}`);
console.error(`error ${secret}`);
console.warn(`warn ${secret}`);
process.stdout.write(`stdout ${secret}\n`);
process.stderr.write(`stderr ${secret}\n`);
process.emitWarning(`warning ${secret}`);
print('A line of the tool itself.');

if (how === 'reject') void Promise.reject(new TypeError(`rejected ${secret}`));
else
  setTimeout(() => {
    throw new RangeError(`thrown ${secret}`);
  }, 0);
