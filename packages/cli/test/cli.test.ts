import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { engineVersion } from '@sf-orglens/engine';
import { buildProgram, main, versionLine } from '../src/main.ts';
import { EXIT } from '../src/output.ts';
import { orglens, tempDirs } from './helpers/run.ts';

const bin = fileURLToPath(new URL('../src/bin.ts', import.meta.url));

/** Runs the CLI from source, the same way a user runs the built binary. */
function runIn(cwd: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['--conditions=@sf-orglens/source', bin, ...args], {
    encoding: 'utf8',
    cwd,
    env: { ...process.env, ORGLENS_WORKSPACE: '', ORGLENS_SQLITE_DRIVER: '' },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
const run = (...args: string[]): ReturnType<typeof runIn> => runIn(process.cwd(), ...args);

const dirs = tempDirs();
afterEach(dirs.cleanUp);

const cliManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

describe('orglens binary', () => {
  it('prints the CLI, engine, Node and platform versions', () => {
    const { status, stdout, stderr } = run('--version');
    expect(stderr).toBe('');
    expect(status).toBe(0);
    expect(stdout.trim()).toBe(
      `sf-orglens/${cliManifest.version} engine/${engineVersion()} node-${process.version} ${process.platform}-${process.arch}`,
    );
    expect(stdout.trim()).toBe(versionLine());
  });

  it('prints help that matches the golden file', async () => {
    const { status, stdout } = run('--help');
    expect(status).toBe(0);
    await expect(stdout).toMatchFileSnapshot('./golden/help.txt');
  });

  it('shows help when run without arguments', () => {
    const { status, stdout } = run();
    expect(status).toBe(0);
    expect(stdout).toBe(run('--help').stdout);
  });

  it.each([
    ['an unknown command', 'no-such-command'],
    ['an unknown option', '--no-such-option'],
  ])('rejects %s as a usage error', (_label, argument) => {
    const { status, stdout, stderr } = run(argument);
    expect(status).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toMatch(/^error: /);
  });

  it('registers exactly the commands that do something', () => {
    const io = { stdout: () => undefined, stderr: () => undefined, cwd: '.', env: {} };
    const names = (command: ReturnType<typeof buildProgram>): string[] => command.commands.map((one) => one.name());
    const program = buildProgram(io, () => undefined);
    expect(names(program)).toEqual(['init', 'source', 'status', 'snapshot', 'coverage', 'doctor']);
    expect(names(program.commands[1] ?? program)).toEqual(['add', 'list', 'remove']);
  });

  it.each([
    ['init', 'help-init.txt'],
    ['source', 'help-source.txt'],
    ['source add', 'help-source-add.txt'],
    ['source list', 'help-source-list.txt'],
    ['source remove', 'help-source-remove.txt'],
    ['status', 'help-status.txt'],
    ['snapshot', 'help-snapshot.txt'],
    ['coverage', 'help-coverage.txt'],
    ['doctor', 'help-doctor.txt'],
  ])('prints help for "%s" that matches the golden file', async (command, golden) => {
    const result = await orglens('.', [...command.split(' '), '--help']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    await expect(result.stdout).toMatchFileSnapshot(`./golden/${golden}`);
  });

  it('carries results, failures and exit codes through the real process', () => {
    const dir = dirs.next();
    const init = runIn(dir, 'init', '--name', 'e2e');
    expect(init.stderr).toBe('');
    expect(init.status).toBe(0);
    expect(init.stdout).toContain('created orglens.toml');

    const status = runIn(dir, 'status', '--json');
    expect(status.status).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({ command: 'status', ok: true, data: { name: 'e2e' } });

    const missing = runIn(dir, 'source', 'remove', 'nobody');
    expect(missing.status).toBe(2);
    expect(missing.stdout).toBe('');
    expect(missing.stderr).toMatch(/^error: /);

    const usage = runIn(dir, 'source', 'remove', '--json');
    expect(usage.status).toBe(2);
    expect(usage.stderr).toBe('');
    expect(JSON.parse(usage.stdout)).toMatchObject({ ok: false, error: { code: 'USAGE' } });
  });

  it('ends quietly when the reader of its output has gone away', async () => {
    const dir = dirs.next();
    expect(runIn(dir, 'init').status).toBe(0);
    // What "orglens status --json | head -c 0" does: the pipe is closed before the command writes.
    const child = spawn(process.execPath, ['--conditions=@sf-orglens/source', bin, 'status', '--json'], {
      cwd: dir,
      env: { ...process.env, ORGLENS_WORKSPACE: '', ORGLENS_SQLITE_DRIVER: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.destroy();
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const status = await new Promise<number | null>((done) => child.on('close', done));
    // No stack trace of Node.js, and no text on the error stream of a command that was asked for JSON.
    expect(stderr).toBe('');
    expect(status).toBe(1);
  });

  // The guard reads process.versions.node, so a preload that overrides it
  // exercises the real entry point without a second Node.js installation.
  function runAsNode(version: string): { status: number | null; stdout: string; stderr: string } {
    const preload = `data:text/javascript,Object.defineProperty(process.versions,"node",{value:"${version}"});`;
    const args = ['--conditions=@sf-orglens/source', '--import', preload, bin, '--version'];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it.each(['22.12.0', '23.99.0', '24.0.0', '24.14.9'])('refuses to start on Node.js %s', (version) => {
    const { status, stdout, stderr } = runAsNode(version);
    expect(status).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toBe(`orglens needs Node.js 24.15 or newer. This is Node.js ${version}.\n`);
  });

  it.each(['24.15.0', '24.16.3', '25.0.0', '26.1.0'])('starts on Node.js %s', (version) => {
    const { status, stdout, stderr } = runAsNode(version);
    expect(stderr).toBe('');
    expect(status).toBe(0);
    expect(stdout).toContain('sf-orglens/');
  });
});

describe('main', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function capture(stream: 'stdout' | 'stderr'): () => string {
    let written = '';
    vi.spyOn(process[stream], 'write').mockImplementation((chunk) => {
      written += String(chunk);
      return true;
    });
    return () => written;
  }

  it('shows help and returns 0 when given no arguments', async () => {
    const stdout = capture('stdout');
    await expect(main(['node', 'orglens'])).resolves.toBe(0);
    expect(stdout()).toContain('Usage: orglens [options] [command]');
    expect(stdout()).toContain('Pre-release');
  });

  it.each(['--help', '--version'])('returns 0 for %s', async (flag) => {
    const stdout = capture('stdout');
    await expect(main(['node', 'orglens', flag])).resolves.toBe(0);
    expect(stdout()).not.toBe('');
  });

  it('returns the usage exit code for a command line it cannot parse', async () => {
    const stderr = capture('stderr');
    await expect(main(['node', 'orglens', '--no-such-option'])).resolves.toBe(EXIT.usage);
    expect(stderr()).toContain("unknown option '--no-such-option'");
  });
});
