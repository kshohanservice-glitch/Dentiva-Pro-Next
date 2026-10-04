/**
 * Minimal local typings for better-sqlite3, mapped via tsconfig `paths` so the
 * vendored @types package (whose Statement API is non-generic) is shadowed.
 * Runtime resolution is unaffected — Node still loads node_modules/better-sqlite3.
 */
declare module 'better-sqlite3' {
  namespace Database {
    interface RunResult {
      changes: number;
      lastInsertRowid: number | bigint;
    }
    interface Statement<Bound extends unknown[] = any[], Result = any> {
      run(...params: Bound): RunResult;
      get<Result = any>(...params: Bound): Result | undefined;
      all<Result = any>(...params: Bound): Result[];
      iterate<Result = any>(...params: Bound): IterableIterator<Result>;
      pluck(toggle?: boolean): Statement<Bound, Result>;
      raw(toggle?: boolean): Statement<Bound, Result>;
      expand(toggle?: boolean): Statement<Bound, Result>;
      simple(toggle?: boolean): Statement<Bound, Result>;
      readonly source: string;
    }
    interface Database {
      readonly name: string;
      readonly open: boolean;
      readonly inTransaction: boolean;
      prepare<Bound extends unknown[] = any[], Result = any>(source: string): Statement<Bound, Result>;
      exec(sql: string): this;
      function(name: string, fn: (...args: any[]) => any): this;
      aggregate(name: string, options: any): this;
      pragma(source: string, options?: { simple?: boolean }): any;
      transaction<F extends (...params: any[]) => any>(fn: F): F;
      savepoint<F extends (...params: any[]) => any>(fn: F): F;
      checkpoint(mode?: string): this;
      functionPointer: any;
      close(): this;
      backup(destination: string, options?: any): Promise<{ totalPages: number; remainingPages: number }>;
    }
  }
  interface BetterSqlite3Constructor {
    new (filename: string | Buffer, options?: any): Database.Database;
    (filename: string | Buffer, options?: any): Database.Database;
    readonly prototype: Database.Database;
  }
  const Database: BetterSqlite3Constructor;
  export = Database;
}
