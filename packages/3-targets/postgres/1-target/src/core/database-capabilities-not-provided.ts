import type {
  DatabaseCapabilitiesNotProvided,
  DatabaseCapabilitiesNotProvidedFinding,
} from '@internal/framework-components/control';
import { InternalError } from '@internal/utils/internal-error';
import { ownEntry } from './own-entry';
import { type CapabilitiesByVersion, postgresCapabilitiesByVersion } from './server-version';

type CapabilityMatrix = Readonly<Record<string, Readonly<Record<string, boolean>>>>;

interface CapabilityFlag {
  readonly namespace: string;
  readonly flag: string;
}

const POSTGRES_VERSION_QUERY = 'SHOW server_version_num';

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

function keyOf({ namespace, flag }: CapabilityFlag): string {
  return `${namespace}.${flag}`;
}

function firstVersionWith(table: CapabilitiesByVersion, flag: CapabilityFlag): number | undefined {
  return versionsOf(table).find((version) => flagIn(table[version], flag) === true);
}

function flagsRequired(capabilities: CapabilityMatrix): readonly CapabilityFlag[] {
  return Object.entries(capabilities).flatMap(([namespace, flags]) =>
    Object.entries(flags)
      .filter(([, required]) => required)
      .map(([flag]) => ({ namespace, flag })),
  );
}

function versionFinding(
  required: readonly CapabilityFlag[],
  table: CapabilitiesByVersion,
  serverVersionNumber: number | undefined,
): DatabaseCapabilitiesNotProvidedFinding | undefined {
  if (serverVersionNumber === undefined) {
    return { kind: 'version-not-read', versionQuery: POSTGRES_VERSION_QUERY };
  }
  const databaseVersion = versionText(serverVersionNumber);
  const rowVersion = rowVersionOf(serverVersionNumber, table);
  if (rowVersion === undefined) {
    const oldestSupported = versionsOf(table)[0];
    if (oldestSupported === undefined) {
      throw new InternalError('The table of PostgreSQL versions has no rows.');
    }
    return { kind: 'older-than-supported', databaseVersion, oldestSupported };
  }
  const missing = required
    .flatMap((flag) => {
      const firstVersion = firstVersionWith(table, flag);
      return firstVersion === undefined || firstVersion <= rowVersion
        ? []
        : [{ capability: keyOf(flag), firstVersion }];
    })
    .sort((a, b) => a.firstVersion - b.firstVersion);
  return missing.length === 0
    ? undefined
    : {
        kind: 'missing-capabilities',
        databaseVersion,
        matchingVersion: rowVersion,
        capabilities: missing,
      };
}

/**
 * What a PostgreSQL server at `serverVersionNumber` does not provide of the capabilities a contract requires, by `table`, or `undefined` when it provides them all. Only the capabilities some row of `table` turns on are checked: the others are the connection's, or unknown to this release, and the client reports those its adapter and driver do not declare. Every flag the table names is on in some row, which a test pins, so this agrees with the client's rule that a flag the table names is the database's. "First available in" holds because each row of the table holds every flag of the row before it.
 */
export function postgresDatabaseCapabilitiesNotProvided(input: {
  readonly capabilities: CapabilityMatrix;
  readonly table: CapabilitiesByVersion;
  readonly serverVersionNumber: number | undefined;
}): DatabaseCapabilitiesNotProvided | undefined {
  const finding = versionFinding(
    flagsRequired(input.capabilities),
    input.table,
    input.serverVersionNumber,
  );
  return finding === undefined ? undefined : { database: 'PostgreSQL', findings: [finding] };
}

/** What a PostgreSQL server at `serverVersionNumber` does not provide of `capabilities`, by PostgreSQL's table. */
export function postgresDatabaseCapabilitiesNotProvidedByTable(
  capabilities: CapabilityMatrix,
  serverVersionNumber: number | undefined,
): DatabaseCapabilitiesNotProvided | undefined {
  return postgresDatabaseCapabilitiesNotProvided({
    capabilities,
    table: postgresCapabilitiesByVersion,
    serverVersionNumber,
  });
}
