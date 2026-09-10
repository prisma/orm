import type { SqlExecuteRequest, SqlQueryable } from '@internal/sql-relational-core/ast';

export function guardQueryable(queryable: SqlQueryable, assertOpen: () => void): SqlQueryable {
  const explain = queryable.explain;
  return {
    async *query<Row>(request: SqlExecuteRequest): AsyncIterable<Row> {
      assertOpen();
      for await (const row of queryable.query<Row>(request)) {
        assertOpen();
        yield row;
        assertOpen();
      }
    },
    async execute(request) {
      assertOpen();
      return queryable.execute(request);
    },
    ...(explain && {
      async explain(request: SqlExecuteRequest) {
        assertOpen();
        return explain.call(queryable, request);
      },
    }),
  };
}
