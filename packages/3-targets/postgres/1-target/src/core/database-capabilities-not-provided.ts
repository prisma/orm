import { ownEntry } from './own-entry';
import {
  type CapabilitiesByVersion,
  databaseCapabilitiesOf,
  postgresCapabilitiesByVersion,
} from './server-version';

/** A capability flag, by its namespace and name. */
export interface CapabilityFlag {
  readonly namespace: string;
  readonly flag: string;
}

/**
 * The capabilities a contract requires of a PostgreSQL database that the database does not provide. `serverVersionNumber` is the server's `server_version_num`.
 */
export type PostgresDatabaseCapabilitiesNotProvided =
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

type CapabilityMatrix = Readonly<Record<string, Readonly<Record<string, boolean>>>>;

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

function flagIn(capabilities: CapabilityMatrix | undefined, { namespace, flag }: CapabilityFlag) {
  return ownEntry(ownEntry(capabilities, namespace), flag);
}

function rowHas(table: CapabilitiesByVersion, version: number, flag: CapabilityFlag): boolean {
  return flagIn(table[version], flag) === true;
}

/** The flags `capabilities` turns on that are the database's: those `databaseCapabilitiesOf(table)` names. */
function databaseFlagsRequired(
  capabilities: CapabilityMatrix,
  table: CapabilitiesByVersion,
): readonly CapabilityFlag[] {
  const databaseCapabilities = databaseCapabilitiesOf(table);
  return Object.entries(capabilities).flatMap(([namespace, flags]) =>
    Object.entries(flags)
      .filter(([, required]) => required)
      .map(([flag]) => ({ namespace, flag }))
      .filter((required) => flagIn(databaseCapabilities, required) === true),
  );
}

/**
 * The flags of `table` that `capabilities` requires and the server's row does not have. Only the database's flags are checked; the others are the connection's, which the client checks. A server older than the table's first version lacks every one, and falls short even when the contract requires none.
 */
export function postgresDatabaseCapabilitiesNotProvided(input: {
  readonly capabilities: CapabilityMatrix;
  readonly table: CapabilitiesByVersion;
  readonly serverVersionNumber: number | undefined;
}): PostgresDatabaseCapabilitiesNotProvided | undefined {
  const { capabilities, table, serverVersionNumber } = input;
  if (serverVersionNumber === undefined) return { kind: 'version-unread' };
  const required = databaseFlagsRequired(capabilities, table);
  const rowVersion = rowVersionOf(serverVersionNumber, table);
  if (rowVersion === undefined) {
    return { kind: 'older-than-supported', serverVersionNumber, missing: required };
  }
  const missing = required.filter((flag) => !rowHas(table, rowVersion, flag));
  return missing.length === 0
    ? undefined
    : { kind: 'capabilities-missing', serverVersionNumber, missing };
}

function listed(items: readonly string[]): string {
  return items.length <= 1
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function keysOf(flags: readonly CapabilityFlag[]): string {
  return listed(flags.map(({ namespace, flag }) => `${namespace}.${flag}`));
}

/**
 * What a PostgreSQL database does not provide, said in versions, with what to do about it. The check cannot tell whether the stated version or the capabilities list turned a flag on, so the message always says to remove the flags from the list if the list turns them on; that is true either way. "N or later" holds because each row of the table holds every flag of the row before it.
 */
export function postgresDatabaseCapabilitiesNotProvidedMessage(
  notProvided: PostgresDatabaseCapabilitiesNotProvided,
  table: CapabilitiesByVersion,
): string {
  if (notProvided.kind === 'version-unread') {
    return "Prisma could not read this database's PostgreSQL version, so it cannot check that the database provides what your contract requires.";
  }
  const runs = `This database runs PostgreSQL ${versionText(notProvided.serverVersionNumber)}.`;
  const versions = versionsOf(table);
  if (notProvided.kind === 'older-than-supported') {
    const first = versions[0];
    return `This release of Prisma requires PostgreSQL ${first} or later. ${runs} Upgrade the database to PostgreSQL ${first} or later.`;
  }
  const stated = rowVersionOf(notProvided.serverVersionNumber, table);
  const firstVersionWith = (flag: CapabilityFlag) =>
    versions.find((version) => rowHas(table, version, flag));
  const inSomeVersion = notProvided.missing.filter((flag) => firstVersionWith(flag) !== undefined);
  const inNoVersion = notProvided.missing.filter((flag) => firstVersionWith(flag) === undefined);
  const noVersionProvides = 'which no PostgreSQL version Prisma supports provides';
  if (inSomeVersion.length === 0) {
    return `Your contract requires ${keysOf(inNoVersion)}, ${noVersionProvides}. ${runs} Remove ${inNoVersion.length === 1 ? 'it' : 'them'} from your contract's capabilities list.`;
  }
  const required = Math.max(...inSomeVersion.map((flag) => firstVersionWith(flag) ?? 0));
  const versioned = `Your contract requires PostgreSQL ${required} or later. ${runs} Either upgrade the database, or state version ${stated} for your contract, which turns off the features that need ${required}. If its capabilities list turns one of them on (${keysOf(inSomeVersion)}), remove it there.`;
  return inNoVersion.length === 0
    ? versioned
    : `${versioned} It also requires ${keysOf(inNoVersion)}, ${noVersionProvides}: remove ${inNoVersion.length === 1 ? 'it' : 'them'} from its capabilities list.`;
}

/** What a PostgreSQL server at `serverVersionNumber` does not provide of `capabilities`, said in versions by PostgreSQL's table, or `undefined` when it provides them all. */
export function postgresDatabaseCapabilitiesNotProvidedText(
  capabilities: CapabilityMatrix,
  serverVersionNumber: number | undefined,
): string | undefined {
  const table = postgresCapabilitiesByVersion;
  const notProvided = postgresDatabaseCapabilitiesNotProvided({
    capabilities,
    table,
    serverVersionNumber,
  });
  return notProvided === undefined
    ? undefined
    : postgresDatabaseCapabilitiesNotProvidedMessage(notProvided, table);
}
