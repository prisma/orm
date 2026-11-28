import { CliStructuredError, errorPrismaSpaceBehind } from '@internal/errors/control';
import { isPrismaSpace, PRISMA_SPACE_ID } from '@internal/framework-components/control';
import {
  PRISMA_TABLE_NAMES,
  PRISMA_TABLES_MISSING_WHY,
  PRISMA_TABLES_SCHEMA,
  prismaTablesMissingSummary,
  RELEASE_CANDIDATE_PRISMA_TABLES_SCHEMA,
} from '@internal/target-postgres/contract-free';
import {
  type PostgresMarkerDriver,
  type PostgresMarkerLower,
  prismaTableExists,
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
  return prismaTableExists(
    lower,
    driver,
    PRISMA_TABLE_NAMES.marker,
    RELEASE_CANDIDATE_PRISMA_TABLES_SCHEMA,
  );
}

export function errorPrismaTablesFromEarlierRelease(): CliStructuredError {
  return errorPrismaSpaceBehind({
    why: `They are in the schema \`${RELEASE_CANDIDATE_PRISMA_TABLES_SCHEMA}\`, where the release candidates of Prisma 8 kept them. This release keeps them in the schema \`${PRISMA_TABLES_SCHEMA}\`, so it cannot read which contract the database matches until they are brought up to date.`,
    meta: { spaceId: PRISMA_SPACE_ID, situation: 'releaseCandidateSchema' },
  });
}

/** Writing a marker row before Prisma's own tables exist, as the migration runner refuses to do with the same code. */
export function errorPrismaTablesMissing(markerLocation: string): CliStructuredError {
  return new CliStructuredError('MIGRATION.PRISMA_TABLES_MISSING', prismaTablesMissingSummary(), {
    why: PRISMA_TABLES_MISSING_WHY,
    fix: "Run `{bin} db sign`, `{bin} db migrate`, `{bin} db init` or `{bin} db update`, which bring Prisma's own tables up to date first, or call bringPrismaSpaceUpToDate on the control client before signing.",
    meta: { markerLocation },
  });
}
