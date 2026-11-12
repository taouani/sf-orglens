import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { engineVersion } from '@sf-orglens/engine';
import { buildProgram, EXIT_USAGE, main, versionLine } from '../src/main.ts';

const bin = fileURLToPath(new URL('../src/bin.ts', import.meta.url));

/** Runs the CLI from source, the same way a user runs the built binary. */
function run(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['--conditions=@sf-orglens/source', bin, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

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

  it('registers no commands before they do something', () => {
    expect(buildProgram().commands).toHaveLength(0);
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
    expect(stdout()).toContain('Usage: orglens [options]');
    expect(stdout()).toContain('Pre-release');
  });

  it.each(['--help', '--version'])('returns 0 for %s', async (flag) => {
    const stdout = capture('stdout');
    await expect(main(['node', 'orglens', flag])).resolves.toBe(0);
    expect(stdout()).not.toBe('');
  });

  it('returns the usage exit code for a command line it cannot parse', async () => {
    const stderr = capture('stderr');
    await expect(main(['node', 'orglens', '--no-such-option'])).resolves.toBe(EXIT_USAGE);
    expect(EXIT_USAGE).toBe(2);
    expect(stderr()).toContain("unknown option '--no-such-option'");
  });
});
