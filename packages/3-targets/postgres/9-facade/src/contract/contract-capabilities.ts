import { postgresAdapterCapabilities } from '@internal/adapter-postgres/adapter';
import { postgresDriverCapabilities } from '@internal/driver-postgres/capabilities';
import {
  type CapabilitySet,
  type ResolvedCapabilities,
  resolveCapabilities,
} from '@internal/sql-contract-ts/contract-builder';
import {
  type CapabilitiesByVersion,
  type PostgresVersion,
  postgresCapabilitiesByVersion,
  postgresCapabilitiesForVersion,
} from '@internal/target-postgres/server-version';
import { blindCast } from '@internal/utils/casts';
import { postgresError } from '../errors';

/** The capabilities of the adapter and the driver the facade's client runs with, which a contract requires unless it states its own list. */
export const defaultConnectionCapabilities = [
  postgresAdapterCapabilities,
  postgresDriverCapabilities,
] as const;

export type DefaultConnectionCapabilities = typeof defaultConnectionCapabilities;

/** What a contract states about the database it runs on. */
export interface PostgresCapabilitiesInput<
  Version extends number = PostgresVersion,
  Capabilities extends readonly CapabilitySet[] = readonly CapabilitySet[],
> {
  /** The PostgreSQL version the database runs. The contract requires the capabilities that version provides. */
  readonly version: Version;
  /**
   * The capabilities the connection provides, one set per component, merged over the version's in order: a later set's flag replaces an earlier one's, and `false` turns a flag off. Defaults to those of the adapter and the driver the client runs with; a list given here replaces the default.
   */
  readonly capabilities?: Capabilities;
}

/** The capabilities a contract requires: the version's row, then the capabilities list, keeping the flags that are on. */
export type ContractCapabilities<
  Table extends CapabilitiesByVersion,
  Version extends keyof Table & number,
  Capabilities extends readonly CapabilitySet[],
> = ResolvedCapabilities<readonly [Table[Version], ...Capabilities]>;

/**
 * The capabilities a contract requires, from the version's row in `table` and the capabilities list. `missingVersion` is the refusal when no version is given, worded for where the contract states it.
 */
export function contractCapabilitiesFor<
  const Table extends CapabilitiesByVersion,
  const Version extends keyof Table & number,
  const Capabilities extends readonly CapabilitySet[] = DefaultConnectionCapabilities,
>(
  table: Table,
  input: PostgresCapabilitiesInput<Version, Capabilities>,
  missingVersion: string,
): ContractCapabilities<Table, Version, Capabilities> {
  if (input.version === undefined) {
    throw postgresError('CONTRACT.ARGUMENT_INVALID', missingVersion);
  }
  const row = postgresCapabilitiesForVersion(input.version, table);
  return blindCast<
    ContractCapabilities<Table, Version, Capabilities>,
    'Capabilities defaults to the default list when the input states none'
  >(resolveCapabilities([row, ...(input.capabilities ?? defaultConnectionCapabilities)]));
}

export const supportedVersionsText = `The supported versions are ${Object.keys(postgresCapabilitiesByVersion).join(', ')}.`;

/**
 * The capabilities a PostgreSQL contract requires for `{ version, capabilities }`. A config that builds its contract source without `defineConfig` passes the result to the source, such as `prismaContract`'s `capabilities` option.
 */
export function postgresContractCapabilities<
  const Version extends PostgresVersion,
  const Capabilities extends readonly CapabilitySet[] = DefaultConnectionCapabilities,
>(
  input: PostgresCapabilitiesInput<Version, Capabilities>,
): ContractCapabilities<typeof postgresCapabilitiesByVersion, Version, Capabilities> {
  return contractCapabilitiesFor(
    postgresCapabilitiesByVersion,
    input,
    `State the PostgreSQL version your database runs, for example postgresContractCapabilities({ version: 18 }). ${supportedVersionsText}`,
  );
}
