import { mysqlAdapterCapabilities } from '@internal/adapter-mysql/adapter';

/** What a MariaDB 10.11 server does that the SQL family asks about: MySQL's capabilities. `returning` is off, as on MySQL: MariaDB has `INSERT … RETURNING` and `DELETE … RETURNING` but no `UPDATE … RETURNING`, and the capability covers every statement kind. MariaDB does not resolve an outer reference inside a derived table, and it cuts an oversized `JSON_ARRAYAGG` with only a warning. */
export const mariadbAdapterCapabilities = Object.freeze({
  sql: {
    ...mysqlAdapterCapabilities.sql,
    returning: false,
    outerReferencesInDerivedTables: false,
    jsonAggWithoutTruncation: false,
  },
} as const);
