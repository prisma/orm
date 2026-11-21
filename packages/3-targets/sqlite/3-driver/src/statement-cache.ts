import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { prepareExact } from './exact-integers';

const STATEMENT_CACHE_LIMIT = 256;

/**
 * Keeps a connection's compiled statements so repeated SQL skips `db.prepare`'s compile step.
 *
 * SQLite compiles a statement per `prepare` call on the connection it belongs to, so the cache
 * lives and dies with one `DatabaseSync`. A statement handed to `iterate()` stays in use until the
 * read finishes; a second reader of the same SQL gets a fresh compile instead, because two live
 * cursors cannot share one statement.
 */
export class SqliteStatementCache {
  readonly #statements = new Map<string, StatementSync>();
  readonly #reading = new Set<StatementSync>();

  prepare(db: DatabaseSync, sql: string): StatementSync {
    const cached = this.#statements.get(sql);
    if (cached !== undefined) {
      if (this.#reading.has(cached)) {
        return prepareExact(db, sql);
      }
      this.#statements.delete(sql);
      this.#statements.set(sql, cached);
      return cached;
    }
    const statement = prepareExact(db, sql);
    if (this.#statements.size >= STATEMENT_CACHE_LIMIT) {
      const oldest = this.#statements.keys().next();
      if (oldest.done !== true) {
        this.#statements.delete(oldest.value);
      }
    }
    this.#statements.set(sql, statement);
    return statement;
  }

  beginRead(statement: StatementSync): void {
    this.#reading.add(statement);
  }

  endRead(statement: StatementSync): void {
    this.#reading.delete(statement);
  }

  /** Whether a statement on this connection still has an unfinished read. */
  hasActiveRead(): boolean {
    return this.#reading.size > 0;
  }
}
