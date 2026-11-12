/**
 * Schema migrations.
 *
 * The schema version is the `user_version` field of the database file, and
 * the `application_id` field marks the file as an OrgLens workspace. Each
 * migration runs in one transaction together with its version bump, so a
 * failed migration changes nothing.
 */
import { EngineError } from '../core/errors.ts';
import type { SqlDatabase, SqlDriver } from './driver.ts';
import { migration0001 } from './migrations/0001-initial.ts';
import { migration0002 } from './migrations/0002-org-snapshots.ts';
import type { Migration } from './migrations/migration.ts';

export type { Migration } from './migrations/migration.ts';

/** Every migration, in order. A released migration is never edited: a change is a new migration. */
export const MIGRATIONS: readonly Migration[] = [migration0001, migration0002];

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

/** Reads what the file says about itself, inside the transaction the caller holds. */
function readState(database: SqlDatabase): SchemaState {
  const objects = database.prepare('SELECT count(*) AS n FROM sqlite_schema').get()?.['n'];
  return {
    applicationId: pragmaNumber(database, 'application_id'),
    version: pragmaNumber(database, 'user_version'),
    empty: objects === 0,
  };
}

/**
 * Reads what the file says about itself. It writes nothing.
 *
 * The three values are read in one read transaction. Without it, a
 * migration that another process commits between two of the reads would
 * show a state that never existed, such as a version without the mark of
 * OrgLens.
 */
export function readSchemaState(database: SqlDatabase): SchemaState {
  database.exec('BEGIN');
  try {
    const state = readState(database);
    database.exec('COMMIT');
    return state;
  } catch (cause) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // The transaction is already gone. The original failure is the one to report.
    }
    throw cause;
  }
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
  /** The schema version before the first migration this call applied. Equal to `to` if it applied none. */
  readonly from: number;
  readonly to: number;
}

/**
 * Brings the database to the latest schema version. Each migration takes
 * the write lock, checks that no other process got there first, runs, and
 * commits together with its version bump.
 *
 * Foreign keys are switched off while migrations run, and are left off:
 * `openStore` switches them on afterwards. SQLite changes a table by
 * building a new one and dropping the old one, and with foreign keys on,
 * the drop would delete every row that refers to the old table. The setting
 * cannot be changed inside a transaction, so a migration cannot do this
 * itself. Before a migration commits, the references are checked as a whole.
 */
export function migrate(
  database: SqlDatabase,
  driver: SqlDriver,
  path: string,
  migrations: readonly Migration[] = MIGRATIONS,
): MigrationResult {
  checkMigrations(migrations);
  let version = readSchemaState(database).version;
  if (version >= migrations.length) return { from: version, to: version };

  let from: number | undefined;
  database.exec('PRAGMA foreign_keys = OFF');
  for (const migration of migrations) {
    if (migration.version <= version) continue;
    try {
      database.exec('BEGIN IMMEDIATE');
    } catch (cause) {
      if (driver.isBusy(cause)) throw busy(path, cause);
      throw cause;
    }
    try {
      // Another process may have migrated while this one waited for the lock.
      const state = readState(database);
      checkSchemaState(state, migrations.length, path);
      if (state.version < migration.version) {
        database.exec(migration.sql);
        if (migration.version === 1) database.exec(`PRAGMA application_id = ${String(APPLICATION_ID)}`);
        const dangling = database.prepare('PRAGMA foreign_key_check').all();
        if (dangling.length > 0) {
          throw new Error(
            `${String(dangling.length)} rows refer to a row that does not exist, the first one in table "${String(dangling[0]?.['table'])}".`,
          );
        }
        database.exec(`PRAGMA user_version = ${String(migration.version)}`);
        from ??= state.version;
      }
      database.exec('COMMIT');
      version = Math.max(state.version, migration.version);
    } catch (cause) {
      try {
        database.exec('ROLLBACK');
      } catch {
        // The transaction is already gone. The original failure is the one to report.
      }
      if (cause instanceof EngineError) throw cause;
      if (driver.isBusy(cause)) throw busy(path, cause);
      throw new EngineError(
        'STORE_MIGRATION_FAILED',
        `Migration ${String(migration.version)} ("${migration.name}") of the workspace database failed and was rolled back. The database is at schema version ${String(version)}.`,
        {
          hint: 'Nothing was lost. This is a defect in OrgLens unless another program changed the database: please report it.',
          details: { path, migration: migration.version, schemaVersion: version },
          cause,
        },
      );
    }
  }
  return { from: from ?? version, to: version };
}

/** The error for a write lock that another process holds. */
export function busy(path: string, cause: unknown): EngineError {
  return new EngineError('STORE_BUSY', 'Another snapshot is running in this workspace.', {
    hint: 'Wait for it to finish, then try again.',
    details: { path },
    cause,
  });
}
