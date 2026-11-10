import type {
  SqlExecuteRequest,
  SqlQueryable,
  SqlStatementStats,
} from '@internal/sql-relational-core/ast';

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
