/**
 * The flags the release candidates of Prisma 8 wrote into every PostgreSQL contract, from the adapter's and the extensions' fixed lists, and that nothing reads any more. A contract such a release emitted still names them: the client's checks ignore them, and they leave the contract when it is emitted again. The extensions' flags are declared here, with the target's, because those releases wrote them into the `postgres` namespace and the client's type-level check sees the target but not the extensions.
 */
export const postgresRetiredCapabilities = Object.freeze({
  postgres: Object.freeze({
    jsonAgg: true,
    lateral: true,
    limit: true,
    orderBy: true,
    returning: true,
    'paradedb/bm25': true,
    'pgvector.cosine': true,
    'postgis.geometry': true,
  }),
  sql: Object.freeze({ enums: true }),
} as const);
