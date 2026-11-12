/**
 * Makes sure that a tool of the live-org workflow prints its own lines and
 * nothing else.
 *
 * The Salesforce libraries write warnings to the standard error stream when
 * they see fit, and an error nobody caught is printed by Node.js with its
 * message. Either could name the org. So everything that is written to the
 * two streams by anything but the tool is dropped, and an error nobody
 * caught ends the tool with a line of its own.
 */

/** Silences the two streams of the process and returns the one way to print a line. Call it before anything else. */
export function ownOutputOnly(): (line: string) => void {
  const write = process.stdout.write.bind(process.stdout);
  const print = (line: string): void => {
    write(`${line}\n`);
  };
  const dropped = (): boolean => true;
  process.stdout.write = dropped;
  process.stderr.write = dropped;
  const failed = (kind: string) => (error: unknown) => {
    const name = error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : 'unknown';
    print(`::error::The step ended with ${kind} (${name}). Its message is not shown here.`);
    process.exit(1);
  };
  process.on('uncaughtException', failed('an error that was not handled'));
  process.on('unhandledRejection', failed('a failure that was not handled'));
  // Node.js prints a warning through a way of its own. None is shown.
  process.removeAllListeners('warning');
  process.on('warning', () => undefined);
  return print;
}
