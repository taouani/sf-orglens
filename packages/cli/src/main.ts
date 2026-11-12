import { Command, CommanderError } from 'commander';
import { engineVersion } from '@sf-orglens/engine';
import { cliVersion } from './version.ts';

/** Exit code for a command line that cannot be understood: unknown option, unknown command, bad argument. */
export const EXIT_USAGE = 2;

/** The one-line answer to `orglens --version`. */
export function versionLine(): string {
  return [
    `sf-orglens/${cliVersion()}`,
    `engine/${engineVersion()}`,
    `node-${process.version}`,
    `${process.platform}-${process.arch}`,
  ].join(' ');
}

/**
 * Builds the command tree.
 *
 * A command is registered only once it does something. The commands planned
 * for later phases are listed in `docs/plans/`, not stubbed here.
 */
export function buildProgram(): Command {
  return new Command('orglens')
    .description('Local-first impact analysis for Salesforce orgs and repositories.')
    .version(versionLine(), '-V, --version', 'print the version and exit')
    .helpOption('-h, --help', 'show help and exit')
    .addHelpText('after', '\nPre-release: no analysis commands are available yet.')
    .action((_options: unknown, command: Command) => {
      // `orglens` on its own shows help instead of exiting silently.
      command.outputHelp();
    });
}

/**
 * Runs the CLI and returns the process exit code.
 *
 * Help and version are successes. Anything else the argument parser rejects
 * is a usage error, which has its own exit code so that scripts can tell it
 * from a failure of the tool. The parser has already printed its message.
 */
export async function main(argv: readonly string[]): Promise<number> {
  try {
    await buildProgram()
      .exitOverride()
      .parseAsync([...argv]);
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : EXIT_USAGE;
    throw error;
  }
}
