import { mysqlAdapterCapabilities } from '@internal/adapter-mysql/adapter';

/** What a MariaDB 10.11 server does that the SQL family asks about: MySQL's capabilities. `returning` is off, as on MySQL: MariaDB has `INSERT … RETURNING` and `DELETE … RETURNING` but no `UPDATE … RETURNING`, and the capability covers every statement kind. MariaDB does not resolve an outer reference inside a derived table, and it cuts an oversized `JSON_ARRAYAGG` with only a warning. Unlike MySQL, MariaDB runs an `UPDATE` or `DELETE` that has a subquery reading the table the statement writes, and the subquery reads the rows as they were before the statement. */
export const mariadbAdapterCapabilities = Object.freeze({
  sql: {
    ...mysqlAdapterCapabilities.sql,
    returning: false,
    outerReferencesInDerivedTables: false,
    jsonAggWithoutTruncation: false,
    subqueryReadsWrittenTable: true,
  },
} as const);
