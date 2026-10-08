import type {
  PreparedStatementHandle,
  SqlDriver,
  SqlExecuteRequest,
  SqlQueryable,
  SqlStatementStats,
} from '@internal/sql-relational-core/ast';
import { createDevDatabase } from '@repo/test-utils';
import pg from 'pg';
import { createBoundDriverFromBinding, type PostgresBinding } from '../src/postgres-driver';

function request(sql: string, params?: readonly unknown[]): SqlExecuteRequest {
  return params === undefined ? { sql } : { sql, params };
}

export async function executeSql(
  queryable: SqlQueryable,
  sql: string,
  params?: readonly unknown[],
): Promise<SqlStatementStats> {
  return queryable.execute(request(sql, params));
}

export async function queryRows<Row>(
  queryable: SqlQueryable,
  sql: string,
  params?: readonly unknown[],
): Promise<Row[]> {
  const rows: Row[] = [];
  for await (const row of queryable.query<Row>(request(sql, params))) {
    rows.push(row);
  }
  return rows;
}

export type DriverBindingKind = 'pgClient' | 'pgPool';

export type DriverReadMode = 'buffered' | 'cursor' | 'named cursor';

export async function openDevDriver(
  binding: DriverBindingKind,
  mode: DriverReadMode,
): Promise<{ driver: SqlDriver<PostgresBinding>; close: () => Promise<void> }> {
  const database = await createDevDatabase();
  const driver = createBoundDriverFromBinding(
    binding === 'pgClient'
      ? { kind: 'pgClient', client: new pg.Client({ connectionString: database.connectionString }) }
      : { kind: 'pgPool', pool: new pg.Pool({ connectionString: database.connectionString }) },
    { disabled: mode === 'buffered' },
  );
  return {
    driver,
    close: async () => {
      await driver.close();
      await database.close();
    },
  };
}

function preparedStatementHandle(): PreparedStatementHandle {
  let name: unknown;
  return {
    get: () => name,
    set: (value: unknown) => {
      name = value;
    },
  };
}

export async function queryRowsInMode<Row>(
  queryable: SqlQueryable,
  mode: DriverReadMode,
  sql: string,
  params?: readonly unknown[],
): Promise<Row[]> {
  const rows: Row[] = [];
  for await (const row of queryable.query<Row>({
    ...request(sql, params),
    ...(mode === 'named cursor' ? { preparedStatementHandle: preparedStatementHandle() } : {}),
  })) {
    rows.push(row);
  }
  return rows;
}
