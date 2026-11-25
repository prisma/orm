import { blindCast } from '@internal/utils/casts';
import { postgresError } from './errors';

/** For each PostgreSQL version, the capabilities that version provides. */
export type CapabilitiesByVersion = Readonly<
  Record<number, Readonly<Record<string, Readonly<Record<string, boolean>>>>>
>;

const postgres15Capabilities = {
  postgres: {
    distinctOn: true,
    forNoKeyUpdate: true,
    forKeyShare: true,
  },
  sql: {
    returning: true,
    defaultInInsert: true,
    lateral: true,
    scalarList: true,
    checkConstraint: true,
    insertOnConflictSkip: true,
    insertOnConflictWithoutTarget: true,
    insertOnConflictTarget: true,
    forUpdate: true,
    forShare: true,
    lockOf: true,
    lockNowait: true,
    lockSkipLocked: true,
    jsonAgg: true,
    outerReferencesInDerivedTables: true,
    jsonAggWithoutTruncation: true,
  },
} as const;

/** The PostgreSQL versions Prisma 8 supports, oldest first. */
const postgresVersions = [15, 16, 17, 18] as const;

/** A PostgreSQL version a contract can state. */
export type PostgresVersion = (typeof postgresVersions)[number];

/** The capabilities each supported PostgreSQL version provides. */
export const postgresCapabilitiesByVersion = {
  15: postgres15Capabilities,
  16: postgres15Capabilities,
  17: postgres15Capabilities,
  18: postgres15Capabilities,
} as const satisfies Record<PostgresVersion, CapabilitiesByVersion[number]>;

/** The oldest PostgreSQL version Prisma 8 supports: the first row of the table. */
export const POSTGRES_MIN_SERVER_VERSION = `${postgresVersions[0]}` as const;

function versionsOf(table: CapabilitiesByVersion): string {
  return Object.keys(table).join(', ');
}

function versionRefusal(version: unknown, table: CapabilitiesByVersion): string {
  const supported = `The supported versions are ${versionsOf(table)}.`;
  if (version === undefined || version === null) {
    return `State the PostgreSQL version your database runs, for example version: 18. ${supported}`;
  }
  if (typeof version === 'string' && Object.hasOwn(table, version)) {
    return `Write the PostgreSQL version as the number ${version}, not the string '${version}'.`;
  }
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    return `Write the PostgreSQL version as a number, for example version: 18. ${supported}`;
  }
  return `PostgreSQL ${version} is not supported. ${supported}`;
}

/**
 * The capabilities `table` lists for PostgreSQL `version`, refusing a version the table does not list. The table defaults to the one Prisma 8 ships; tests pass their own.
 */
export function postgresCapabilitiesForVersion<
  const Version extends keyof Table & number,
  const Table extends CapabilitiesByVersion = typeof postgresCapabilitiesByVersion,
>(
  version: Version,
  table: Table = blindCast<Table, 'Table defaults to the shipped table when none is passed'>(
    postgresCapabilitiesByVersion,
  ),
): Table[Version] {
  if (typeof version === 'number' && Object.hasOwn(table, version)) {
    return table[version];
  }
  throw postgresError('CONTRACT.ARGUMENT_INVALID', versionRefusal(version, table), {
    meta: { version: String(version), supportedVersions: Object.keys(table) },
  });
}
