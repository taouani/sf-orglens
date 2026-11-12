/**
 * The logins of the Salesforce CLI on this machine, and which of them a
 * source uses.
 *
 * A person logs in once with the Salesforce CLI (`sf org login web`).
 * OrgLens uses that login and never asks for a password. The `sf` program
 * is not started.
 *
 * Listing the logins only reads: the files in which the Salesforce CLI
 * keeps them state the user name, the org id and the address of the org in
 * plain text, and the aliases are in a file beside them. The tokens in the
 * files are encrypted and are not looked at here. A token is decrypted by
 * the Salesforce library when a connection is made (`org.ts`), the way the
 * CLI does it on each system.
 *
 * Which login a source uses is decided in this order:
 *
 * 1. the login that is linked to the source in `.orglens/local.toml`
 *    (`orglens source link`), by alias or by user name;
 * 2. the one login that belongs to the org the source declares (`org_id`).
 *
 * A login with a key from the environment (`jwt.ts`) comes before both.
 *
 * What is read and written in the home folder is listed in decision
 * record 0031.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { OrgSource, SandboxSource } from '../core/config/config.ts';
import type { LoginFailure } from './org-errors.ts';
import { byCodeUnit } from './tree.ts';

/** A source that is an org: the two kinds that have a login. */
export type OrgLikeSource = OrgSource | SandboxSource;

/** A login of the Salesforce CLI. It holds no token. */
export interface CliLogin {
  readonly username: string;
  /** The aliases the person gave it, sorted. */
  readonly aliases: readonly string[];
  readonly orgId: string | null;
  readonly instanceUrl: string | null;
}

/** The folder in which the Salesforce CLI keeps its logins. */
export const cliStateDir = (): string => join(homedir(), '.sfdx');

/** The files of the folder that hold a login: named after a user name. This is the test the Salesforce library applies. */
const LOGIN_FILE = /^[^.][^@]*@[^.]+(\.[^.\s]+)+\.json$/;

/** A JSON file as an object, or `null` if it is missing, cannot be read or holds something else. */
function readJsonObject(file: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Lists the logins of the Salesforce CLI on this machine, sorted by user
 * name. Nothing is written and no token is read.
 *
 * A file that cannot be read or is not a login is left out, as the
 * Salesforce CLI leaves it out. On a machine where the Salesforce CLI was
 * never used, the list is empty.
 */
export function listCliLogins(): CliLogin[] {
  const dir = cliStateDir();
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const aliasesOf = new Map<string, string[]>();
  const aliases = readJsonObject(join(dir, 'alias.json'))?.['orgs'];
  if (typeof aliases === 'object' && aliases !== null) {
    for (const [alias, username] of Object.entries(aliases)) {
      if (typeof username !== 'string') continue;
      aliasesOf.set(username, [...(aliasesOf.get(username) ?? []), alias]);
    }
  }
  const logins: CliLogin[] = [];
  for (const name of names) {
    if (!LOGIN_FILE.test(name)) continue;
    const fields = readJsonObject(join(dir, name));
    // The library finds a login by the name of its file, so a file that states another user is not one.
    const username = name.slice(0, -'.json'.length);
    if (fields?.['username'] !== username) continue;
    logins.push({
      username,
      aliases: (aliasesOf.get(username) ?? []).sort(byCodeUnit),
      orgId: typeof fields['orgId'] === 'string' ? fields['orgId'] : null,
      instanceUrl: typeof fields['instanceUrl'] === 'string' ? fields['instanceUrl'] : null,
    });
  }
  return logins.sort((a, b) => byCodeUnit(a.username, b.username));
}

/**
 * True if two org ids name the same org. An id has 15 characters, or 18
 * with a suffix that repeats the case of the first 15.
 */
export const sameOrg = (a: string, b: string): boolean => a.slice(0, 15) === b.slice(0, 15);

/** The Salesforce CLI login a source uses, or why there is none. */
export type LoginChoice =
  | {
      readonly via: 'linked' | 'org-id';
      readonly login: CliLogin;
      /** The alias to show: the one that is linked, or the first of the login. */
      readonly alias: string | null;
    }
  | {
      readonly via: 'none';
      readonly reason: Extract<LoginFailure, 'NO_LOGIN' | 'LOGIN_AMBIGUOUS' | 'LOGIN_UNKNOWN'>;
      readonly message: string;
      readonly hint: string;
    };

/**
 * Chooses the Salesforce CLI login of a source. `linked` is the login the
 * personal file names for it, if it names one.
 */
export function chooseCliLogin(
  source: OrgLikeSource,
  linked: string | undefined,
  logins: readonly CliLogin[],
): LoginChoice {
  const link = `orglens source link ${source.name} <alias or user name>`;
  if (linked !== undefined) {
    // As the Salesforce CLI does it: an alias first, then a user name.
    const login = logins.find((one) => one.aliases.includes(linked)) ?? logins.find((one) => one.username === linked);
    if (login === undefined) {
      return {
        via: 'none',
        reason: 'LOGIN_UNKNOWN',
        message: `The login "${linked}" that is linked to the source "${source.name}" is not a login of the Salesforce CLI on this machine.`,
        // A user name is not proposed as an alias: an alias wins over a user name, whoever logs in under it.
        hint: `Log in with the Salesforce CLI (sf org login web${linked.includes('@') ? '' : ` --alias ${linked}`}), or link another login with: ${link}`,
      };
    }
    return { via: 'linked', login, alias: login.aliases.includes(linked) ? linked : (login.aliases[0] ?? null) };
  }

  const { orgId } = source;
  if (orgId === null) {
    return {
      via: 'none',
      reason: 'NO_LOGIN',
      message: `Nothing says which login the source "${source.name}" uses.`,
      hint: `Link a login of the Salesforce CLI with: ${link}`,
    };
  }
  const ofOrg = logins.filter((one) => one.orgId !== null && sameOrg(one.orgId, orgId));
  const [login] = ofOrg;
  if (login === undefined) {
    return {
      via: 'none',
      reason: 'NO_LOGIN',
      message: `No login of the Salesforce CLI on this machine belongs to the org of the source "${source.name}" (${orgId}).`,
      hint: 'Log in to the org with the Salesforce CLI (sf org login web), then run the command again.',
    };
  }
  if (ofOrg.length > 1) {
    return {
      via: 'none',
      reason: 'LOGIN_AMBIGUOUS',
      message: `${String(ofOrg.length)} logins of the Salesforce CLI belong to the org of the source "${source.name}".`,
      hint: `Choose one with: ${link}`,
    };
  }
  return { via: 'org-id', login, alias: login.aliases[0] ?? null };
}
