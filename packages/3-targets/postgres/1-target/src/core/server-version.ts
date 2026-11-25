import { blindCast } from '@internal/utils/casts';
import { postgresError } from './errors';

/**
 * For each PostgreSQL version, the capabilities that version provides.
 *
 * @internal The shape of `postgresCapabilitiesByVersion`, named for the facade's tests.
 */
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

type RowOf<Table> = Table[keyof Table];
type NamespacesOf<Row> = Row extends unknown ? keyof Row : never;
type FlagsOf<Row, Namespace> = Row extends unknown
  ? Namespace extends keyof Row
    ? keyof Row[Namespace]
    : never
  : never;

/** Every flag any row of `Table` names, each as `true`. */
export type DatabaseCapabilitiesOf<Table extends CapabilitiesByVersion> = {
  readonly [Namespace in NamespacesOf<RowOf<Table>> & string]: {
    readonly [Flag in FlagsOf<RowOf<Table>, Namespace> & string]: true;
  };
};

/** Every flag any row of `table` names, each as `true`: the capabilities that are facts about the database, whichever version it runs. */
export function databaseCapabilitiesOf<const Table extends CapabilitiesByVersion>(
  table: Table,
): DatabaseCapabilitiesOf<Table> {
  const merged: Record<string, Record<string, true>> = {};
  for (const row of Object.values(table)) {
    for (const [namespace, flags] of Object.entries(row)) {
      merged[namespace] = {
        ...merged[namespace],
        ...Object.fromEntries(Object.keys(flags).map((flag) => [flag, true] as const)),
      };
    }
  }
  return blindCast<DatabaseCapabilitiesOf<Table>, 'every flag of every row, each as true'>(merged);
}

/** The capabilities that are facts about a PostgreSQL database, in any supported version. Signing checks the database for them. */
export const postgresDatabaseCapabilities = databaseCapabilitiesOf(postgresCapabilitiesByVersion);

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
 * The capabilities `table` lists for PostgreSQL `version`, refusing a version the table does not list.
 *
 * @internal The PostgreSQL facade uses it so its tests can pass a table whose rows differ; everything else calls `postgresCapabilitiesForVersion`.
 */
export function postgresCapabilitiesForVersionIn<
  const Table extends CapabilitiesByVersion,
  const Version extends keyof Table & number,
>(table: Table, version: Version): Table[Version] {
  if (typeof version === 'number' && Object.hasOwn(table, version)) {
    return table[version];
  }
  throw postgresError('CONTRACT.ARGUMENT_INVALID', versionRefusal(version, table), {
    meta: { version: String(version), supportedVersions: Object.keys(table) },
  });
}

/** The capabilities PostgreSQL `version` provides, refusing a version Prisma 8 does not support. */
export function postgresCapabilitiesForVersion<const Version extends PostgresVersion>(
  version: Version,
): (typeof postgresCapabilitiesByVersion)[Version] {
  return postgresCapabilitiesForVersionIn(postgresCapabilitiesByVersion, version);
}

/** The newest PostgreSQL version Prisma 8 supports: the last row of the table. */
type LastOf<Items> = Items extends readonly [...unknown[], infer Last] ? Last : never;

export const POSTGRES_NEWEST_VERSION = blindCast<
  LastOf<typeof postgresVersions>,
  'the last entry of a non-empty tuple'
>(postgresVersions[postgresVersions.length - 1]);
