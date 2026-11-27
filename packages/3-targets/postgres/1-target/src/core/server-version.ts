import { blindCast } from '@internal/utils/casts';
import type { PostgresVersion } from './server-version-range';

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
