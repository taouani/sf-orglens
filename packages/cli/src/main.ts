import { Command, CommanderError, Option } from 'commander';
import { engineVersion } from '@sf-orglens/engine';
import {
  coverage,
  doctorCommand,
  init,
  snapshot,
  sourceAdd,
  sourceCheck,
  sourceLink,
  sourceList,
  sourceRemove,
  status,
  type Context,
  type SourceAddOptions,
} from './commands.ts';
import { createWriter, EXIT, UsageError, type ExitCode, type Io, type Outcome } from './output.ts';
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

const processIo = (): Io => {
  // A reader that closes the pipe early, such as `head`, ends the command quietly. Without this, Node.js prints
  // a stack trace, also with --json.
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (error: Error & { code?: string }) => {
      if (error.code === 'EPIPE') process.exit(EXIT.failure);
      throw error;
    });
  }
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    cwd: process.cwd(),
    env: process.env,
  };
};

/** True if the command line asks for JSON. It has to be known before the parser runs, to report what the parser rejects. */
function wantsJson(argv: readonly string[]): boolean {
  const args = argv.slice(2);
  const end = args.indexOf('--');
  return (end === -1 ? args : args.slice(0, end)).includes('--json');
}

/**
 * Builds the command tree.
 *
 * A command is registered only once it does something. The commands planned
 * for later are listed in `docs/plans/`, not stubbed here. `finish` receives
 * the exit code of the command that ran.
 */
export function buildProgram(io: Io, finish: (exitCode: ExitCode) => void, json = false): Command {
  const program = new Command('orglens')
    .description('Local-first impact analysis for Salesforce orgs and repositories.')
    .version(versionLine(), '-V, --version', 'print the version and exit')
    .helpOption('-h, --help', 'show help and exit')
    .option('--json', 'write the result as one line of JSON')
    .option('--workspace <folder>', 'the workspace folder (default: found from the current folder upwards)')
    .addHelpText('after', '\nPre-release: the analysis commands are not available yet.')
    .helpCommand(false)
    .configureHelp({ showGlobalOptions: true })
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        io.stdout(text);
      },
      // With --json the rejection is reported as an envelope by `main`, and nothing else is written.
      writeErr: (text) => {
        if (!json) io.stderr(text);
      },
    });

  /** Wraps a command: finds the global options, runs it, writes its result or its failure. */
  const run = (name: string, work: (context: Context) => Promise<Outcome>) => {
    return async (command: Command): Promise<void> => {
      const globals = command.optsWithGlobals<{ workspace?: string }>();
      // One answer to "was JSON asked for" for the whole run: the one `main` took from the command line.
      const writer = createWriter(io, json);
      try {
        finish(
          writer.succeed(
            name,
            await work({
              io,
              workspace: globals.workspace,
              progress: (line) => {
                writer.progress(line);
              },
            }),
          ),
        );
      } catch (error) {
        finish(writer.fail(name, error));
      }
    };
  };

  program
    .command('init')
    .summary('create a workspace')
    .description(
      'Makes a folder an OrgLens workspace: writes orglens.toml and creates the data folder .orglens. ' +
        'In a folder that already has an orglens.toml, only what is missing in .orglens is created.',
    )
    .argument('[folder]', 'the folder (default: the current folder)')
    .option('--name <name>', 'the label of the workspace (default: the name of the folder)')
    .action((folder: string | undefined, options: { name?: string }, command: Command) =>
      run('init', (context) => init(context, folder, options))(command),
    );

  const source = program
    .command('source')
    .summary('declare the orgs, sandboxes and repository folders to read')
    .description('Declares the sources of the workspace in orglens.toml, and sets and checks how they are reached.')
    .helpCommand(false);

  source
    .command('add')
    .summary('declare a source')
    .description(
      'Adds a source to orglens.toml. Nothing is connected or read yet. ' +
        'Comments and the layout of the file are kept.',
    )
    .argument('<name>', 'a short name: lower-case letters, digits and hyphens')
    .addOption(
      new Option('--kind <kind>', 'the kind, required').choices(['org', 'sandbox', 'git']).makeOptionMandatory(),
    )
    .option('--description <text>', 'a note for people')
    .option('--org-id <id>', 'org, sandbox: the 15 or 18 character org id')
    .option('--login-url <url>', 'org, sandbox: the login URL, if it is not the default')
    .option('--sandbox-of <source>', 'sandbox: the org source it is a sandbox of')
    .option('--sandbox-name <name>', 'sandbox: the name of the sandbox')
    .option('--repo <folder>', 'git: the repository, relative to the workspace (default: ".")')
    .option('--ref <ref>', 'git: the branch, tag or commit to read (default: the working tree)')
    .option(
      '--path <folder>',
      'git: a folder of the repository that belongs to this source; repeat for several',
      (value: string, previous: string[] | undefined) => [...(previous ?? []), value],
    )
    .option('--tracks <source>', 'git: the org or sandbox source this repository describes')
    .action((name: string, options: SourceAddOptions, command: Command) =>
      run('source add', (context) => sourceAdd(context, name, options))(command),
    );

  source
    .command('list')
    .summary('list the declared sources')
    .description('Lists the sources declared in orglens.toml.')
    .action((_options: unknown, command: Command) => run('source list', sourceList)(command));

  source
    .command('remove')
    .summary('remove the declaration of a source')
    .description(
      'Removes a source from orglens.toml, and the login that was set for it from .orglens/local.toml. ' +
        'Every other line of the files is kept. Snapshots already taken of the source stay in the database.',
    )
    .argument('<name>', 'the name of the source')
    .action((name: string, _options: unknown, command: Command) =>
      run('source remove', (context) => sourceRemove(context, name))(command),
    );

  source
    .command('link')
    .summary('choose the Salesforce CLI login for an org or a sandbox')
    .description(
      'Sets which login of the Salesforce CLI you use for an org or a sandbox, by its alias or its user name. ' +
        'The choice is personal and is written to .orglens/local.toml. No password, token or key is stored: ' +
        'the login stays with the Salesforce CLI. Nothing is connected. ' +
        'Without a link, OrgLens uses the one login that belongs to the org id the source declares.',
    )
    .argument('<name>', 'the name of the source')
    .argument('<login>', 'the alias or the user name of a Salesforce CLI login (see: sf org list)')
    .action((name: string, login: string, _options: unknown, command: Command) =>
      run('source link', (context) => sourceLink(context, name, login))(command),
    );

  source
    .command('check')
    .summary('check that a source can be read')
    .description(
      'For an org or a sandbox: finds the login, connects, and asks the org which org it is. ' +
        'The login is a private key in the variables ORGLENS_JWT_<SOURCE>_... if they are set, ' +
        'else the linked Salesforce CLI login, else the one Salesforce CLI login of the declared org. ' +
        'For folders of a repository: reads everything a snapshot would read. ' +
        'Nothing is stored and the source is not changed. ' +
        'The exit code is 4 if the login is missing or does not work or the org cannot be reached, ' +
        'and 5 if folders can be read only in part.',
    )
    .argument('<name>', 'the name of the source')
    .action((name: string, _options: unknown, command: Command) =>
      run('source check', (context) => sourceCheck(context, name))(command),
    );

  program
    .command('status')
    .summary('show the workspace, its database and its sources')
    .description('Shows the workspace, the state of its database and the latest snapshot of every source. Reads only.')
    .action((_options: unknown, command: Command) => run('status', status)(command));

  program
    .command('snapshot')
    .summary('read a source and store what it holds')
    .description(
      'Reads a source now and stores its metadata files as a new snapshot in the workspace database. ' +
        'Earlier snapshots are kept. The source is not changed. ' +
        'An org or a sandbox is asked what it holds, and its components are retrieved in chunks, which takes ' +
        'minutes. If that is interrupted, the next run continues the same snapshot. ' +
        'OrgLens asks for metadata only, never for records. ' +
        'The exit code is 5 if the snapshot is partial: something could not be read, and the output says what. ' +
        'It is 4 if the login is missing or does not work or the org cannot be reached.',
    )
    .argument('<source>', 'the name of the source')
    .option('--restart', 'org, sandbox: give up a snapshot that was interrupted, and take a new one')
    .action((name: string, options: { restart?: boolean }, command: Command) =>
      run('snapshot', (context) => snapshot(context, name, options))(command),
    );

  program
    .command('coverage')
    .summary('show what a snapshot holds and what it is missing')
    .description(
      'Shows the latest snapshot of a source: the number of components per metadata type, and everything that ' +
        'was left out or went wrong while it was taken. Reads only.',
    )
    .argument('<source>', 'the name of the source')
    .option('--snapshot <number>', 'the snapshot to show (default: the latest)')
    .action((name: string, options: { snapshot?: string }, command: Command) =>
      run('coverage', (context) => coverage(context, name, options))(command),
    );

  program
    .command('doctor')
    .summary('check that OrgLens can run here')
    .description(
      'Checks Node.js, SQLite, Git, the workspace, its configuration, its database and the logins for its orgs, ' +
        'and reports every check. It connects to nothing and changes neither the configuration nor the data. ' +
        'The exit code is 1 if a check failed.',
    )
    .action((_options: unknown, command: Command) => run('doctor', doctorCommand)(command));

  return program;
}

/**
 * Runs the CLI and returns the process exit code.
 *
 * Help and version are successes. What the argument parser rejects is a
 * usage error: the parser has printed its message, or with `--json` the
 * message is written as an envelope here.
 */
export async function main(argv: readonly string[], io: Io = processIo()): Promise<ExitCode> {
  const json = wantsJson(argv);
  let exitCode: ExitCode = EXIT.ok;
  try {
    const program = buildProgram(
      io,
      (code) => {
        exitCode = code;
      },
      json,
    );
    if (argv.length <= 2) {
      // `orglens` on its own shows help, as a success.
      program.outputHelp();
      return EXIT.ok;
    }
    await program.parseAsync([...argv]);
    return exitCode;
  } catch (error) {
    if (!(error instanceof CommanderError)) return createWriter(io, json).fail(null, error);
    if (error.exitCode === 0) return EXIT.ok;
    if (!json) return EXIT.usage;
    // The parser shows help for a group of commands that was named without one of its commands.
    const usage =
      error.code === 'commander.help'
        ? new UsageError('The command is not complete.', 'Add --help to see the commands.')
        : new UsageError(error.message.replace(/^error: /, ''));
    return createWriter(io, true).fail(null, usage);
  }
}
