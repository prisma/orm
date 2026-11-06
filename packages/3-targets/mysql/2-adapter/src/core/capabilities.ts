/** What a MySQL 8.4 server does that the SQL family asks about. `RETURNING`, `LATERAL` and conflict targets are not among them: `ON DUPLICATE KEY UPDATE` fires on any unique key. */
export const mysqlAdapterCapabilities = Object.freeze({
  sql: {
    orderBy: true,
    limit: true,
    foreignKeys: true,
    enums: true,
    defaultInInsert: true,
  },
} as const);
