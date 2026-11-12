/**
 * Checking a source: can it be read, as things are now?
 *
 * For an org or a sandbox, the login is found, a connection is made, and
 * the org is asked who is logged in. For folders of a repository,
 * everything a snapshot would read is read. Nothing is stored in either
 * case, and the source is not changed.
 */
import type { SourceDeclaration } from '../core/config/config.ts';
import { readLocalSource } from '../sources/local.ts';
import { connectToOrg } from '../sources/org.ts';
import { readEveryFile, type SnapshotIssue } from './snapshot.ts';

type Environment = Readonly<Record<string, string | undefined>>;

/** What the check of an org or a sandbox found. */
export interface OrgCheck {
  readonly source: string;
  readonly kind: 'org' | 'sandbox';
  readonly login: {
    /**
     * - `jwt-env`: a private key from the environment.
     * - `linked`: the Salesforce CLI login that `orglens source link` set for the source.
     * - `org-id`: the one Salesforce CLI login that belongs to the org the source declares.
     */
    readonly via: 'jwt-env' | 'linked' | 'org-id';
    /** The alias of the Salesforce CLI login, if it has one. */
    readonly alias: string | null;
    /** `null` for a login with a key: the user name comes from a secret, and the output of a job is read by others. */
    readonly username: string | null;
  };
  readonly org: {
    /** The id of the org, as the org states it. */
    readonly id: string;
    /** `null` for a login with a key, for the same reason as the user name. */
    readonly instanceUrl: string | null;
    /** The API version OrgLens uses with this org: the newest it offers. */
    readonly apiVersion: string;
  };
  /** The org id the source declares. With `null`, nothing says which org is meant, and any login is accepted. */
  readonly declaredOrgId: string | null;
}

/** What the check of folders of a repository found. */
export interface GitCheck {
  readonly source: string;
  readonly kind: 'git';
  /** True if a snapshot taken now would be complete. */
  readonly complete: boolean;
  /** The commit a snapshot taken now would name, or `null` if it would name none. */
  readonly commit: string | null;
  /** The folders of the source, relative to the repository. One that could not be read is named in an issue. */
  readonly dirs: readonly string[];
  readonly components: number;
  readonly files: number;
  readonly bytes: number;
  /** Everything that was observed. One of severity `error` makes a snapshot partial. */
  readonly issues: readonly SnapshotIssue[];
}

export type SourceCheck = OrgCheck | GitCheck;

/** Checks one source. `linked` is the login the personal file names for it, if it names one. */
export async function checkSource(
  workspaceRoot: string,
  source: SourceDeclaration,
  linked: string | undefined,
  env: Environment,
): Promise<SourceCheck> {
  if (source.kind === 'git') {
    const reading = await readLocalSource(workspaceRoot, source);
    let bytes = 0;
    const read = readEveryFile(reading, (_path, content) => {
      bytes += content.byteLength;
    });
    return {
      source: source.name,
      kind: 'git',
      complete: !read.issues.some((issue) => issue.severity === 'error'),
      commit: read.moved ? null : reading.commit,
      dirs: reading.dirs,
      components: reading.components.length,
      files: reading.tree.files.length,
      bytes,
      issues: read.issues.map(({ severity, code, message, details }) => ({
        severity,
        code,
        message,
        details: details ?? {},
      })),
    };
  }

  const session = await connectToOrg(source, linked, env);
  const withKey = session.via === 'jwt-env';
  return {
    source: source.name,
    kind: source.kind,
    login: { via: session.via, alias: session.alias, username: withKey ? null : session.username },
    org: { id: session.orgId, instanceUrl: withKey ? null : session.instanceUrl, apiVersion: session.apiVersion },
    declaredOrgId: source.orgId,
  };
}
