/** The schema the Postgres target keeps Prisma's own tables in, which the first migration of the `_prisma` contract space creates. */
export const PRISMA_TABLES_SCHEMA = '_prisma';

/** The schema the release candidates of Prisma 8 kept Prisma's own tables in, which the first migration of the `_prisma` contract space renames to {@link PRISMA_TABLES_SCHEMA}. */
export const RELEASE_CANDIDATE_PRISMA_TABLES_SCHEMA = 'prisma_contract';

export const PRISMA_TABLE_NAMES = {
  marker: 'marker',
  ledger: 'ledger',
  contract: 'contract',
} as const;

export type PrismaTableName = (typeof PRISMA_TABLE_NAMES)[keyof typeof PRISMA_TABLE_NAMES];

/** A table as SQL names it, `"<schema>"."<table>"`. */
export function qualifiedPrismaTable(
  table: PrismaTableName,
  schema: string = PRISMA_TABLES_SCHEMA,
): string {
  return `"${schema}"."${table}"`;
}

/** Why a space cannot be applied or signed before Prisma's own tables exist, as the runner and the sign path say it. */
export const PRISMA_TABLES_MISSING_WHY = `The tables are created, or moved from the schema ${RELEASE_CANDIDATE_PRISMA_TABLES_SCHEMA} that the release candidates of Prisma 8 used, by applying the target's _prisma contract space, and nothing has applied it to this database. \`prisma db init\`, \`prisma db update\`, \`prisma db migrate\` and \`prisma db sign\` apply it before anything else; code that runs the migration runner or signs a database directly must apply it first: call bringPrismaSpaceUpToDate on the control client, or, without the control client, applyInstalledContractSpace from @prisma/orm-toolchain/migration-tools/spaces.`;

export function prismaTablesMissingSummary(): string {
  return `Prisma's own tables are missing from this database: ${PRISMA_TABLES_SCHEMA}.${PRISMA_TABLE_NAMES.marker} does not exist.`;
}
