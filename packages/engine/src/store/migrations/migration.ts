/** One step of the schema. A released migration is never edited: a change is a new migration. */
export interface Migration {
  /** The schema version the database has after this migration. Versions start at 1 and have no gaps. */
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}
