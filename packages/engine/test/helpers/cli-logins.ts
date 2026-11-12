/**
 * Logins of the Salesforce CLI for the tests, in the home folder of the
 * test process (`tools/vitest-setup.js` gives every test file an empty
 * one). They are written with the library the Salesforce CLI writes them
 * with, so that the engine is tested against the real form of the files.
 */
import { readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import type * as Core from '@salesforce/core';

export interface SeededLogin {
  readonly username: string;
  readonly alias?: string;
  readonly orgId: string;
  /** The address of the org: a mock org. */
  readonly instanceUrl: string;
  readonly accessToken: string;
  readonly refreshToken?: string;
}

async function library(): Promise<typeof Core> {
  // As the engine does before it loads the library: no log file in the home folder.
  process.env['SF_DISABLE_LOG_FILE'] = 'true';
  return import('@salesforce/core');
}

/** Writes a login as `sf org login` leaves it behind. */
export async function seedCliLogin(login: SeededLogin): Promise<void> {
  const { StateAggregator } = await library();
  StateAggregator.clearInstance();
  const state = await StateAggregator.getInstance();
  state.orgs.set(login.username, {
    username: login.username,
    orgId: login.orgId,
    accessToken: login.accessToken,
    ...(login.refreshToken === undefined ? {} : { refreshToken: login.refreshToken }),
    instanceUrl: login.instanceUrl,
    loginUrl: login.instanceUrl,
    clientId: 'PlatformCLI',
  });
  await state.orgs.write(login.username);
  if (login.alias !== undefined) await state.aliases.setAndSave(login.alias, login.username);
  StateAggregator.clearInstance();
}

/** What the library itself lists as logins: user name, aliases, org id. */
export async function loginsOfLibrary(): Promise<{ username: string; aliases: string[]; orgId: string | null }[]> {
  const { StateAggregator } = await library();
  StateAggregator.clearInstance();
  const state = await StateAggregator.getInstance();
  const logins = (await state.orgs.readAll(false)).map((fields) => ({
    username: fields.username ?? '',
    aliases: state.aliases.getAll(fields.username ?? '').sort(),
    orgId: fields.orgId ?? null,
  }));
  StateAggregator.clearInstance();
  return logins.sort((a, b) => (a.username < b.username ? -1 : 1));
}

/** Removes everything the Salesforce CLI and its library keep in the home folder, and what the library remembers. */
export async function forgetCliLogins(): Promise<void> {
  const { StateAggregator } = await library();
  StateAggregator.clearInstance();
  for (const dir of ['.sfdx', '.sf']) rmSync(join(homedir(), dir), { recursive: true, force: true });
}

/** Every file below the home folder, relative to it, with forward slashes, sorted. */
export function homeFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [relative(homedir(), path).split('\\').join('/')];
    });
  return walk(homedir()).sort();
}
