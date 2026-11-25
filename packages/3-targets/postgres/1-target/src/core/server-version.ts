import { postgresError } from './errors';

/** For each database version, the capabilities that version provides, keyed by the version a contract states. */
export type ServerVersionTable = Readonly<
  Record<number, Readonly<Record<string, Readonly<Record<string, boolean>>>>>
>;

/**
 * The capabilities `table` lists for `version`, refusing a version the table does not list with a message that names the supported ones.
 */
export function resolveServerVersion<
  const Table extends ServerVersionTable,
  const Version extends keyof Table & number,
>(table: Table, version: Version, databaseName: string): Table[Version] {
  if (typeof version === 'number' && Object.hasOwn(table, version)) {
    return table[version];
  }
  throw postgresError(
    'CONTRACT.ARGUMENT_INVALID',
    `${databaseName} version ${JSON.stringify(version)} is not supported. State one of the supported versions: ${Object.keys(table).join(', ')}.`,
    { meta: { version: String(version), supportedVersions: Object.keys(table) } },
  );
}

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

/** The PostgreSQL versions Prisma 8 supports, oldest first, each with the capabilities it provides. */
export const postgresServerVersions = {
  15: postgres15Capabilities,
  16: postgres15Capabilities,
  17: postgres15Capabilities,
  18: postgres15Capabilities,
} as const satisfies ServerVersionTable;

/** A PostgreSQL version a contract can state. */
export type PostgresServerVersion = keyof typeof postgresServerVersions;

/** The capabilities PostgreSQL `version` provides. */
export function postgresCapabilitiesForVersion<const Version extends PostgresServerVersion>(
  version: Version,
): (typeof postgresServerVersions)[Version] {
  return resolveServerVersion(postgresServerVersions, version, 'PostgreSQL');
}

/** The oldest PostgreSQL server version Prisma 8 supports: the first row of the versions table. */
export const POSTGRES_MIN_SERVER_VERSION = String(
  Math.min(...Object.keys(postgresServerVersions).map(Number)),
);
