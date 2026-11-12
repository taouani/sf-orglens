/**
 * Makes sure that a tool of the live-org workflow prints its own lines and
 * nothing else.
 *
 * The Salesforce libraries write warnings to the standard error stream when
 * they see fit, and an error nobody caught is printed by Node.js with its
 * message. Either could name the org. So the work is not done in the
 * process the workflow starts. That process starts the tool a second time,
 * as a child that has no standard streams at all: they lead nowhere. The
 * one way out of the child is a channel between the two processes, and the
 * only thing that is sent over it is a line of the log of the tool
 * (`public-log.ts`). The first process prints those lines and nothing else.
 *
 * What a library writes in the child, in whatever way, to the stream or to
 * the file descriptor, from a thread or from a process it starts, goes
 * nowhere. What is left to trust is the log of the tool itself.
 */
import { spawn } from 'node:child_process';
import { publicLog, type PublicLog } from './public-log.ts';

/** A line as it goes over the channel. */
interface Sent {
  readonly line: string;
}

const isSent = (message: unknown): message is Sent =>
  typeof message === 'object' && message !== null && typeof (message as { line?: unknown }).line === 'string';

/** The first process: starts the tool again without streams, prints the lines it sends, and ends as it ends. */
function relay(file: string): Promise<void> {
  return new Promise((resolve) => {
    let failed = false;
    const print = (line: string): void => {
      // One line stays one line, whatever it holds.
      const safe = line.replace(/[\r\n]+/g, ' ');
      if (safe.startsWith('::error::')) failed = true;
      process.stdout.write(`${safe}\n`);
    };
    const child = spawn(process.execPath, [...process.execArgv, file, ...process.argv.slice(2)], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const ended = (code: number | null): void => {
      if (code !== 0 && !failed) {
        print(
          `::error::The step ended with ${code === null ? 'no exit code' : `the exit code ${String(code)}`} and said nothing about it.`,
        );
      }
      process.exitCode = code === 0 ? 0 : 1;
      resolve();
    };
    child.on('message', (message) => {
      if (isSent(message)) print(message.line);
    });
    child.on('error', () => {
      ended(null);
    });
    child.on('close', ended);
  });
}

/**
 * Runs a tool as a step of the workflow. Call it with the file of the tool, as the last thing the file does when
 * it is run as a program:
 *
 *   if (import.meta.main) await asStep(import.meta.filename, tool);
 */
export async function asStep(file: string, tool: (log: PublicLog) => Promise<void>): Promise<void> {
  const send = process.send?.bind(process);
  if (send === undefined) {
    await relay(file);
    return;
  }

  // The child. Whatever is written to the streams goes nowhere already. This keeps it from failing on the way.
  const dropped = (...args: unknown[]): boolean => {
    const callback = args.at(-1);
    if (typeof callback === 'function') queueMicrotask(callback as () => void);
    return true;
  };
  process.stdout.write = dropped;
  process.stderr.write = dropped;
  process.removeAllListeners('warning');
  process.on('warning', () => undefined);

  const failed = (kind: string) => (error: unknown) => {
    const name = error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : 'unknown';
    const line = `::error::The step ended with ${kind} (${name}). Its message is not shown here.`;
    // The line is on its way before the process ends.
    send({ line } satisfies Sent, () => process.exit(1));
  };
  process.on('uncaughtException', failed('an error that was not handled'));
  process.on('unhandledRejection', failed('a failure that was not handled'));

  // Every line is on its way before the process ends.
  const sent: Promise<void>[] = [];
  const log = publicLog((line) => {
    sent.push(
      new Promise((resolve) => {
        send({ line } satisfies Sent, () => {
          resolve();
        });
      }),
    );
  });
  await tool(log);
  await Promise.all(sent);
  if (log.failed) process.exitCode = 1;
}
