/**
 * What Prisma 7.10.0 creates in Postgres for each Prisma 7 scalar and `@db.*`
 * native type, expressed as the Prisma 8 authoring type constructor that
 * produces the same column. Derived from the SQL recorded in
 * `test/integration/test/fixtures/prisma7-source/reference/migration.sql`.
 * `args` are the constructor's positional arguments. A `@db.*` attribute's own
 * arguments replace them; without any, the column gets `args`, so `@db.Char`
 * is `Char(1)`, the `character(1)` Postgres stores for Prisma 7's `CHAR`.
 */
export const prisma7PostgresTypeMap = {
  scalars: {
    String: { constructorName: 'String', args: [] },
    Boolean: { constructorName: 'Boolean', args: [] },
    Int: { constructorName: 'Int', args: [] },
    BigInt: { constructorName: 'BigInt', args: [] },
    Float: { constructorName: 'Float', args: [] },
    Decimal: { constructorName: 'Numeric', args: ['65', '30'] },
    DateTime: { constructorName: 'Timestamp', args: ['3'] },
    Json: { constructorName: 'Jsonb', args: [] },
    Bytes: { constructorName: 'Bytes', args: [] },
  },
  nativeTypes: {
    Text: { constructorName: 'String', args: [] },
    VarChar: { constructorName: 'VarChar', args: [] },
    Char: { constructorName: 'Char', args: ['1'] },
    Uuid: { constructorName: 'Uuid', args: [] },
    Inet: { constructorName: 'Inet', args: [] },
    Boolean: { constructorName: 'Boolean', args: [] },
    Integer: { constructorName: 'Int', args: [] },
    SmallInt: { constructorName: 'SmallInt', args: [] },
    BigInt: { constructorName: 'BigInt', args: [] },
    Real: { constructorName: 'Real', args: [] },
    DoublePrecision: { constructorName: 'Float', args: [] },
    Decimal: { constructorName: 'Numeric', args: [] },
    Timestamp: { constructorName: 'Timestamp', args: [] },
    Timestamptz: { constructorName: 'Timestamptz', args: [] },
    Date: { constructorName: 'Date', args: [] },
    Time: { constructorName: 'Time', args: [] },
    Timetz: { constructorName: 'Timetz', args: [] },
    Json: { constructorName: 'Json', args: [] },
    JsonB: { constructorName: 'Jsonb', args: [] },
    ByteA: { constructorName: 'Bytes', args: [] },
  },
} as const;
