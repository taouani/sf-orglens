/**
 * The part of `better-sqlite3` the fallback driver uses. The package ships
 * no type declarations of its own.
 */
declare module 'better-sqlite3' {
  interface Statement {
    run(...parameters: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...parameters: unknown[]): Record<string, unknown> | undefined;
    all(...parameters: unknown[]): Record<string, unknown>[];
    /** True if the statement returns rows. */
    readonly reader: boolean;
    /** Makes the statement return integers as bigint. */
    safeIntegers(on: boolean): this;
  }
  class Database {
    constructor(path: string, options?: { readonly?: boolean; fileMustExist?: boolean; timeout?: number });
    exec(sql: string): this;
    prepare(sql: string): Statement;
    close(): this;
  }
  export default Database;
}
