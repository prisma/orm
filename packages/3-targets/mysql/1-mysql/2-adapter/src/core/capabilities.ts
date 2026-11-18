/** What a MySQL 8.4 server does that the SQL family asks about. `RETURNING`, `LATERAL` and conflict targets are not among them: `ON DUPLICATE KEY UPDATE` fires on any unique key. `subqueryReadsWrittenTable` is not among them either: MySQL refuses, with error 1093, an `UPDATE` or `DELETE` that has a subquery reading the table the statement writes. */
export const mysqlAdapterCapabilities = Object.freeze({
  sql: {
    orderBy: true,
    limit: true,
    foreignKeys: true,
    enums: true,
    defaultInInsert: true,
    jsonAgg: true,
    outerReferencesInDerivedTables: true,
    jsonAggWithoutTruncation: true,
  },
} as const);
