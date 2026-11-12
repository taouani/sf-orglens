/**
 * Schema migrations.
 *
 * The schema version is the `user_version` field of the database file, and
 * the `application_id` field marks the file as an OrgLens workspace. Each
 * migration runs in one transaction together with its version bump, so a
 * failed migration leaves the file exactly as it was.
 */
import { EngineError } from '../core/errors.ts';
import type { SqlDatabase, SqlDriver } from './driver.ts';
import { migration0001 } from './migrations/0001-initial.ts';
import type { Migration } from './migrations/migration.ts';

export type { Migration } from './migrations/migration.ts';

/** Every migration, in order. A released migration is never edited: a change is a new migration. */
export const MIGRATIONS: readonly Migration[] = [migration0001];

/** Marks a SQLite file as an OrgLens workspace database: the bytes "OLNS". */
export const APPLICATION_ID = 0x4f_4c_4e_53;

export interface SchemaState {
  readonly applicationId: number;
  readonly version: number;
  /** True if the file holds no tables at all. */
  readonly empty: boolean;
}

const pragmaNumber = (database: SqlDatabase, name: string): number => {
  const value = Object.values(database.prepare(`PRAGMA ${name}`).get() ?? {})[0];
  if (typeof value !== 'number') throw new EngineError('STORE_FAILED', `SQLite did not answer PRAGMA ${name}.`);
  return value;
};

/** Reads what the file says about itself. It writes nothing. */
export function readSchemaState(database: SqlDatabase): SchemaState {
  const objects = database.prepare('SELECT count(*) AS n FROM sqlite_schema').get()?.['n'];
  return {
    applicationId: pragmaNumber(database, 'application_id'),
    version: pragmaNumber(database, 'user_version'),
    empty: objects === 0,
  };
}

/**
 * Refuses a file this build must not touch: one that is not an OrgLens
 * workspace, or one written by a newer version. It writes nothing.
 */
export function checkSchemaState(state: SchemaState, latest: number, path: string): void {
  const ours =
    state.applicationId === APPLICATION_ID || (state.empty && state.applicationId === 0 && state.version === 0);
  if (!ours) {
    throw new EngineError('STORE_FOREIGN', 'This file is not an OrgLens workspace database.', {
      hint: 'Point OrgLens at a workspace folder of its own. It never changes a database it did not create.',
      details: { path },
    });
  }
  if (state.version > latest) {
    throw new EngineError(
      'STORE_NEWER',
      `The workspace database has schema version ${String(state.version)}. This version of OrgLens reads up to ${String(latest)}.`,
      {
        hint: 'Update OrgLens. The database was not changed.',
        details: { path, found: state.version, supported: latest },
      },
    );
  }
}

function checkMigrations(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new EngineError('INTERNAL', `Migration "${migration.name}" should have version ${String(index + 1)}.`);
    }
  });
}

export interface MigrationResult {
  readonly from: number;
  readonly to: number;
}

/**
 * Brings the database to the latest schema version. Each migration takes
 * the write lock, checks that no other process got there first, runs, and
 * commits together with its version bump.
 */
export function migrate(
  database: SqlDatabase,
  driver: SqlDriver,
  path: string,
  migrations: readonly Migration[] = MIGRATIONS,
): MigrationResult {
  checkMigrations(migrations);
  const from = readSchemaState(database).version;
  for (const migration of migrations) {
    if (migration.version <= from) continue;
    try {
      database.exec('BEGIN IMMEDIATE');
    } catch (cause) {
      if (driver.isBusy(cause)) throw busy(path, cause);
      throw cause;
    }
    try {
      // Another process may have migrated while this one waited for the lock.
      const state = readSchemaState(database);
      checkSchemaState(state, migrations.length, path);
      if (state.version < migration.version) {
        database.exec(migration.sql);
        if (migration.version === 1) database.exec(`PRAGMA application_id = ${String(APPLICATION_ID)}`);
        database.exec(`PRAGMA user_version = ${String(migration.version)}`);
      }
      database.exec('COMMIT');
    } catch (cause) {
      try {
        database.exec('ROLLBACK');
      } catch {
        // The transaction is already gone. The original failure is the one to report.
      }
      if (cause instanceof EngineError) throw cause;
      throw new EngineError(
        'STORE_MIGRATION_FAILED',
        `Migration ${String(migration.version)} ("${migration.name}") of the workspace database failed. The database was not changed.`,
        { details: { path, migration: migration.version }, cause },
      );
    }
  }
  return { from, to: Math.max(from, migrations.length) };
}

/** The error for a write lock that another process holds. */
export function busy(path: string, cause: unknown): EngineError {
  return new EngineError('STORE_BUSY', 'Another snapshot is running in this workspace.', {
    hint: 'Wait for it to finish, then try again.',
    details: { path },
    cause,
  });
}
