import { CliStructuredError } from '@internal/errors/control';
import { isPrismaSpace } from '@internal/framework-components/control';
import {
  EARLIER_RELEASE_PRISMA_TABLES_SCHEMA,
  execute,
  infoSchemaTables,
  type PostgresMarkerDriver,
  type PostgresMarkerLower,
  PRISMA_TABLES_SCHEMA,
} from './marker-ledger';

/**
 * Whether Prisma's own tables are in the form an earlier release left them: the marker table is missing from {@link PRISMA_TABLES_SCHEMA} and present in the schema the release candidates used. Asked only once the marker table was not found.
 *
 * Never for a read of the `_prisma` space's own row or ledger: no earlier release wrote either, and the space's first migration reads them to find it has not run yet.
 */
export async function prismaTablesFromEarlierRelease(
  lower: PostgresMarkerLower,
  driver: PostgresMarkerDriver,
  space: string | undefined,
): Promise<boolean> {
  if (space !== undefined && isPrismaSpace(space)) return false;
  const probe = infoSchemaTables
    .select(infoSchemaTables.table_schema)
    .where(
      infoSchemaTables.table_schema
        .eq(EARLIER_RELEASE_PRISMA_TABLES_SCHEMA)
        .and(infoSchemaTables.table_name.eq('marker')),
    )
    .build();
  return (await execute(lower, driver, probe)).length > 0;
}

export function errorPrismaTablesFromEarlierRelease(): CliStructuredError {
  const migrate = '{bin} db migrate';
  return new CliStructuredError(
    'CONTRACT.PRISMA_TABLES_FROM_EARLIER_RELEASE',
    "Prisma's own tables in this database were written by an earlier release of Prisma",
    {
      why: `They are in the schema \`${EARLIER_RELEASE_PRISMA_TABLES_SCHEMA}\`, where the release candidates of Prisma 8 kept them. This release keeps them in the schema \`${PRISMA_TABLES_SCHEMA}\`, so it cannot read which contract the database matches until they are brought up to date.`,
      fix: `Run \`${migrate}\`, which brings Prisma's own tables up to date before it does anything else; \`{bin} db init\`, \`{bin} db update\` and \`{bin} db sign\` do the same.`,
      nextActions: [
        {
          kind: 'run-command',
          label: "Bring Prisma's own tables up to date",
          command: migrate,
        },
      ],
      meta: { schema: EARLIER_RELEASE_PRISMA_TABLES_SCHEMA },
    },
  );
}
