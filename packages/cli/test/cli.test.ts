import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { engineVersion } from '@sf-orglens/engine';
import { buildProgram, main, versionLine } from '../src/main.ts';

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

  it('rejects an unknown command with a non-zero exit code', () => {
    const { status, stdout, stderr } = run('no-such-command');
    expect(status).not.toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toMatch(/too many arguments/);
  });

  it('registers no commands before they do something', () => {
    expect(buildProgram().commands).toHaveLength(0);
  });

  it('refuses to start on an unsupported Node.js version', () => {
    // The guard reads process.versions.node, so a preload that overrides it
    // exercises the real entry point without a second Node.js installation.
    const preload = 'data:text/javascript,Object.defineProperty(process.versions,"node",{value:"22.12.0"});';
    const out = spawnSync(
      process.execPath,
      ['--conditions=@sf-orglens/source', '--import', preload, bin, '--version'],
      {
        encoding: 'utf8',
      },
    );
    expect(out.status).toBe(1);
    expect(out.stdout).toBe('');
    expect(out.stderr).toMatch(/needs Node\.js 24\.15 or newer\. This is Node\.js 22\.12\.0\./);
  });
});

describe('main', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows help in process when given no arguments', async () => {
    let written = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written += String(chunk);
      return true;
    });
    await main(['node', 'orglens']);
    expect(written).toContain('Usage: orglens [options]');
    expect(written).toContain('Pre-release');
  });
});
