import type { CapabilitiesByVersion } from './server-version';

/** A capability flag, by its namespace and name. */
export interface CapabilityFlag {
  readonly namespace: string;
  readonly flag: string;
}

/**
 * What a PostgreSQL database lacks of what a contract requires of it. `serverVersionNumber` is the server's `server_version_num`.
 */
export type PostgresDatabaseShortfall =
  | { readonly kind: 'version-unread' }
  | {
      readonly kind: 'older-than-supported';
      readonly serverVersionNumber: number;
      readonly missing: readonly CapabilityFlag[];
    }
  | {
      readonly kind: 'capabilities-missing';
      readonly serverVersionNumber: number;
      readonly missing: readonly CapabilityFlag[];
    };

function versionsOf(table: CapabilitiesByVersion): readonly number[] {
  return Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);
}

/** The major version of a `server_version_num`: 9 for 9.6, 15 for 15.4. */
function majorOf(serverVersionNumber: number): number {
  return Math.floor(serverVersionNumber / 10000);
}

/** A `server_version_num` as PostgreSQL writes its version: `15.4`, or `9.6` before PostgreSQL 10. */
function versionText(serverVersionNumber: number): string {
  const major = majorOf(serverVersionNumber);
  return serverVersionNumber >= 100000
    ? `${major}.${serverVersionNumber % 10000}`
    : `${major}.${Math.floor(serverVersionNumber / 100) % 100}`;
}

/** The table's version whose row describes the server: the newest one not newer than it. */
function rowVersionOf(
  serverVersionNumber: number,
  table: CapabilitiesByVersion,
): number | undefined {
  const major = majorOf(serverVersionNumber);
  return versionsOf(table)
    .filter((version) => version <= major)
    .at(-1);
}

function hasFlag(
  table: CapabilitiesByVersion,
  version: number,
  { namespace, flag }: CapabilityFlag,
) {
  return table[version]?.[namespace]?.[flag] === true;
}

function databaseFlagsRequired(
  capabilities: Readonly<Record<string, Readonly<Record<string, boolean>>>>,
  table: CapabilitiesByVersion,
): readonly CapabilityFlag[] {
  const versions = versionsOf(table);
  const isDatabaseFlag = (required: CapabilityFlag) =>
    versions.some((version) => table[version]?.[required.namespace]?.[required.flag] !== undefined);
  return Object.entries(capabilities).flatMap(([namespace, flags]) =>
    Object.entries(flags)
      .filter(([, required]) => required)
      .map(([flag]) => ({ namespace, flag }))
      .filter(isDatabaseFlag),
  );
}

/**
 * The flags of `table` that `capabilities` requires and the server's row does not have. Only the flags `table` holds are the database's; the others are the connection's, which the client checks. A server older than the table's first version lacks every one, and falls short even when the contract requires none.
 */
export function postgresDatabaseShortfall(input: {
  readonly capabilities: Readonly<Record<string, Readonly<Record<string, boolean>>>>;
  readonly table: CapabilitiesByVersion;
  readonly serverVersionNumber: number | undefined;
}): PostgresDatabaseShortfall | undefined {
  const { capabilities, table, serverVersionNumber } = input;
  if (serverVersionNumber === undefined) return { kind: 'version-unread' };
  const required = databaseFlagsRequired(capabilities, table);
  const rowVersion = rowVersionOf(serverVersionNumber, table);
  if (rowVersion === undefined) {
    return { kind: 'older-than-supported', serverVersionNumber, missing: required };
  }
  const missing = required.filter((flag) => !hasFlag(table, rowVersion, flag));
  return missing.length === 0
    ? undefined
    : { kind: 'capabilities-missing', serverVersionNumber, missing };
}

function listed(items: readonly string[]): string {
  return items.length <= 1
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** What a PostgreSQL database lacks, said in versions, with what to do about it. */
export function postgresDatabaseShortfallMessage(
  shortfall: PostgresDatabaseShortfall,
  table: CapabilitiesByVersion,
): string {
  if (shortfall.kind === 'version-unread') {
    return "Prisma could not read this database's PostgreSQL version, so it cannot check that the database provides what your contract requires.";
  }
  const runs = `This database runs PostgreSQL ${versionText(shortfall.serverVersionNumber)}.`;
  const versions = versionsOf(table);
  if (shortfall.kind === 'older-than-supported') {
    const first = versions[0];
    return `This release of Prisma requires PostgreSQL ${first} or later. ${runs} Upgrade the database to PostgreSQL ${first} or later.`;
  }
  const stated = rowVersionOf(shortfall.serverVersionNumber, table);
  const required = versions.find((version) =>
    shortfall.missing.every((flag) => hasFlag(table, version, flag)),
  );
  if (required === undefined) {
    const flags = listed(shortfall.missing.map(({ namespace, flag }) => `${namespace}.${flag}`));
    return `Your contract requires ${flags} of the database, which no PostgreSQL version Prisma supports provides together. ${runs} State version ${stated} for your contract, and remove from its capabilities list what that version does not provide.`;
  }
  return `Your contract requires PostgreSQL ${required} or later. ${runs} Either upgrade the database, or state version ${stated} for your contract, which turns off the features that need ${required}.`;
}
