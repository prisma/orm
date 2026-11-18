import type { MysqlRuntimeDriver } from '@internal/driver-mysql/runtime';
import mysqlDriver from '@internal/driver-mysql/runtime';
import type {
  SqlConnection,
  SqlExecuteRequest,
  SqlStatementStats,
  SqlTransaction,
} from '@internal/sql-relational-core/ast';
import { vi } from 'vitest';

/** A statement the runtime sent, as the adapter rendered it. */
export interface SentStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/** The rows a query is answered with, as the driver would hand them over. */
export type Answer = (
  sql: string,
  params: readonly unknown[],
) => ReadonlyArray<Record<string, unknown>>;

/**
 * Replaces the MySQL runtime driver with one that needs no database: it records every statement the runtime sends and answers a query with the rows `answer` gives for it, and any other statement with one affected row and insert id 1.
 */
export function recordStatements(answer: Answer = () => []): SentStatement[] {
  const sent: SentStatement[] = [];
  const record = (request: SqlExecuteRequest) =>
    sent.push({ sql: request.sql, params: request.params ?? [] });
  const queryable = {
    async *query<Row>(request: SqlExecuteRequest): AsyncIterable<Row> {
      record(request);
      yield* answer(request.sql, request.params ?? []) as Row[];
    },
    async execute(request: SqlExecuteRequest): Promise<SqlStatementStats> {
      record(request);
      return { affectedRows: 1, insertId: '1' };
    },
  };
  const transaction: SqlTransaction = {
    ...queryable,
    commit: async () => undefined,
    rollback: async () => undefined,
    savepoint: async () => transaction,
  };
  const connection: SqlConnection = {
    ...queryable,
    beginTransaction: async () => transaction,
    release: async () => undefined,
    destroy: async () => undefined,
  };
  const driver: MysqlRuntimeDriver = {
    familyId: 'sql',
    targetId: 'mysql',
    ...queryable,
    connect: async () => undefined,
    acquireConnection: async () => connection,
    close: async () => undefined,
  };
  vi.spyOn(mysqlDriver, 'create').mockReturnValue(driver);
  return sent;
}
