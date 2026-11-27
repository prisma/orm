/** The schema the Postgres target keeps Prisma's own tables in, which the first migration of the `_prisma` contract space creates. */
export const PRISMA_TABLES_SCHEMA = '_prisma';

/** The schema the release candidates of Prisma 8 kept Prisma's own tables in, which the first migration of the `_prisma` contract space renames to {@link PRISMA_TABLES_SCHEMA}. */
export const RELEASE_CANDIDATE_PRISMA_TABLES_SCHEMA = 'prisma_contract';

/** The table the release candidates of Prisma 8 kept each space's signature and the database's policies in, which the first migration of the `_prisma` contract space moves into `signatures` and `config`. */
export const RELEASE_CANDIDATE_MARKER_TABLE = 'marker';

export const PRISMA_TABLE_NAMES = {
  signatures: 'signatures',
  config: 'config',
  ledger: 'ledger',
  contract: 'contract',
} as const;

export type PrismaTableName = (typeof PRISMA_TABLE_NAMES)[keyof typeof PRISMA_TABLE_NAMES];

/** A table as SQL names it, `"<schema>"."<table>"`. */
export function qualifiedPrismaTable(
  table: PrismaTableName | typeof RELEASE_CANDIDATE_MARKER_TABLE,
  schema: string = PRISMA_TABLES_SCHEMA,
): string {
  return `"${schema}"."${table}"`;
}

/** A table as Prisma's messages name it, `<schema>.<table>`. */
export function prismaTableLocation(table: PrismaTableName): string {
  return `${PRISMA_TABLES_SCHEMA}.${table}`;
}

/**
 * Records the database's policies, in the form the framework stores them, as the one row of `_prisma.config`. Its one parameter is that form as JSON text.
 */
export const RECORD_DATABASE_POLICIES_SQL = `INSERT INTO ${qualifiedPrismaTable(PRISMA_TABLE_NAMES.config)} ("policies") VALUES ($1::jsonb)
ON CONFLICT ("id") DO UPDATE SET "policies" = EXCLUDED."policies"`;

/** Why a space cannot be applied or signed before Prisma's own tables exist, as the runner and the sign path say it. */
export const PRISMA_TABLES_MISSING_WHY = `The tables are created, or moved from the schema ${RELEASE_CANDIDATE_PRISMA_TABLES_SCHEMA} that the release candidates of Prisma 8 used, by applying the target's _prisma contract space, and nothing has applied it to this database. \`prisma db init\`, \`prisma db update\`, \`prisma db migrate\` and \`prisma db sign\` apply it before anything else; code that runs the migration runner or signs a database directly must apply it first: call bringPrismaSpaceUpToDate on the control client, or, without the control client, applyInstalledContractSpace from @prisma/orm-toolchain/migration-tools/spaces.`;

export function prismaTablesMissingSummary(missing: readonly PrismaTableName[]): string {
  const names = missing.map(prismaTableLocation);
  const listed =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '');
  return `Prisma's own tables are missing from this database: ${listed} ${names.length > 1 ? 'do' : 'does'} not exist.`;
}
