import { postgresAdapterCapabilities } from '@internal/adapter-postgres/capabilities';
import { postgresDriverCapabilities } from '@internal/driver-postgres/capabilities';
import type { CapabilityMatrix } from '@internal/framework-components/components';
import {
  type ResolvedCapabilities,
  resolveCapabilities,
} from '@internal/sql-contract-ts/contract-builder';
import {
  type CapabilitiesByVersion,
  type PostgresVersion,
  postgresCapabilitiesByVersion,
  postgresCapabilitiesForVersionIn,
} from '@internal/target-postgres/server-version';
import { blindCast } from '@internal/utils/casts';
import { postgresError } from '../errors';

/** The capabilities of the adapter and the driver the facade's client runs with, which a contract requires unless it states its own list. */
export const defaultConnectionCapabilities = [
  postgresAdapterCapabilities,
  postgresDriverCapabilities,
] as const;

export type DefaultConnectionCapabilities = typeof defaultConnectionCapabilities;

/**
 * The capabilities the connection provides, one set per component, merged over the version's in order: a later set's flag replaces an earlier one's, and `false` turns a flag off. Defaults to those of the adapter and the driver the client runs with; a list given here replaces the default.
 *
 * At type level, every set written at a fixed position in the list, as a literal or `as const`, is merged, before or after a spread. A spread of a list typed as an array, and a set typed as `CapabilityMatrix`, still apply at run time but add nothing to the contract's type, so a `false` in them leaves the flag in the type.
 */
export type CapabilitiesList = readonly CapabilityMatrix[];

/** What a contract states about the database it runs on, for any table of versions. */
export interface CapabilitiesInputFor<
  Version extends number,
  Capabilities extends CapabilitiesList,
> {
  /** The PostgreSQL version the database runs. The contract requires the capabilities that version provides. */
  readonly version: Version;
  /** The connection's capabilities list, merged over the version's row in order; see `CapabilitiesList`. */
  readonly capabilities?: Capabilities;
}

/** What a PostgreSQL contract states about the database it runs on: the version, and the connection's capabilities list. */
export interface PostgresCapabilitiesInput<
  Capabilities extends CapabilitiesList = CapabilitiesList,
> {
  /** The PostgreSQL version the database runs. The contract requires the capabilities that version provides. */
  readonly version: PostgresVersion;
  /** The connection's capabilities list, merged over the version's row in order; see `CapabilitiesList`. */
  readonly capabilities?: Capabilities;
}

/** The capabilities a contract requires, for any table: the version's row, then the capabilities list, keeping the flags that are on. */
export type ContractCapabilitiesFor<
  Table extends CapabilitiesByVersion,
  Version extends keyof Table & number,
  Capabilities extends CapabilitiesList,
> = ResolvedCapabilities<readonly [Table[Version], ...Capabilities]>;

/** The capabilities a PostgreSQL contract requires: the version's row, then the capabilities list, keeping the flags that are on. */
export type PostgresContractCapabilities<
  Version extends PostgresVersion,
  Capabilities extends CapabilitiesList = DefaultConnectionCapabilities,
> = ResolvedCapabilities<
  readonly [(typeof postgresCapabilitiesByVersion)[Version], ...Capabilities]
>;

export const supportedVersionsText = `The supported versions are ${Object.keys(postgresCapabilitiesByVersion).join(', ')}.`;

/**
 * The capabilities a contract requires, from the version's row in `table` and the capabilities list. `missingVersion` is the refusal when no version is given, worded for where the contract states it.
 */
export function contractCapabilitiesFor<
  const Table extends CapabilitiesByVersion,
  const Version extends keyof Table & number,
  const Capabilities extends CapabilitiesList = DefaultConnectionCapabilities,
>(
  table: Table,
  input: CapabilitiesInputFor<Version, Capabilities>,
  missingVersion: string,
): ContractCapabilitiesFor<Table, Version, Capabilities> {
  if (input.version === undefined) {
    throw postgresError('CONTRACT.ARGUMENT_INVALID', missingVersion);
  }
  if (input.capabilities !== undefined && !Array.isArray(input.capabilities)) {
    throw postgresError(
      'CONTRACT.ARGUMENT_INVALID',
      'capabilities is a list of capability sets, for example capabilities: [{ sql: { interactiveTransactions: true } }].',
    );
  }
  const row = postgresCapabilitiesForVersionIn(table, input.version);
  return blindCast<
    ContractCapabilitiesFor<Table, Version, Capabilities>,
    'Capabilities defaults to the default list when the input states none'
  >(resolveCapabilities([row, ...(input.capabilities ?? defaultConnectionCapabilities)]));
}

/**
 * The capabilities a PostgreSQL contract requires for `{ version, capabilities }`. A config that builds its contract source without `defineConfig` passes the result to the source, such as `prismaContract`'s `capabilities` option.
 */
export function postgresContractCapabilities<
  const Version extends PostgresVersion,
  const Capabilities extends CapabilitiesList = DefaultConnectionCapabilities,
>(
  input: CapabilitiesInputFor<Version, Capabilities>,
): PostgresContractCapabilities<Version, Capabilities> {
  return contractCapabilitiesFor(
    postgresCapabilitiesByVersion,
    input,
    `State the PostgreSQL version your database runs, for example postgresContractCapabilities({ version: 18 }). ${supportedVersionsText}`,
  );
}
