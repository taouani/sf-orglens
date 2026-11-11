import { Command } from 'commander';
import { engineVersion } from '@sf-orglens/engine';
import { cliVersion } from './version.ts';

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

export async function main(argv: readonly string[]): Promise<void> {
  await buildProgram().parseAsync([...argv]);
}
