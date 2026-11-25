import { postgresAdapterCapabilities } from '@internal/adapter-postgres/adapter';
import { postgresDriverCapabilities } from '@internal/driver-postgres/capabilities';
import { mergeCapabilityMatrices } from '@internal/framework-components/components';
import postgresPack from '@internal/target-postgres/pack';
import {
  type PostgresServerVersion,
  type postgresServerVersions,
  resolveServerVersion,
  type ServerVersionTable,
} from '@internal/target-postgres/server-version';
import { blindCast } from '@internal/utils/casts';

/** The capabilities one component declares, by namespace. */
export type CapabilitySet = Readonly<Record<string, Readonly<Record<string, boolean>>>>;

/** The capabilities of the adapter and the driver the facade's client runs with, which a contract requires unless it states its own list. */
export const defaultConnectionCapabilities = [
  postgresAdapterCapabilities,
  postgresDriverCapabilities,
] as const;

export type DefaultConnectionCapabilities = typeof defaultConnectionCapabilities;

// The flags of `Later` replace those of `Earlier` that it sets, namespace by namespace.
type OverrideCapabilities<Earlier, Later> = {
  readonly [Namespace in keyof Earlier | keyof Later]: Namespace extends keyof Later
    ? Namespace extends keyof Earlier
      ? Omit<Earlier[Namespace], keyof Later[Namespace]> & Later[Namespace]
      : Later[Namespace]
    : Namespace extends keyof Earlier
      ? Earlier[Namespace]
      : never;
};

/** The capability sets of a list merged in order, a later set's flags replacing an earlier one's. A list whose entries the type does not know merges to no capabilities. */
export type MergeCapabilitySets<Sets> = Sets extends readonly [...infer Earlier, infer Last]
  ? OverrideCapabilities<MergeCapabilitySets<Earlier>, Last>
  : Record<never, never>;

export function mergeCapabilitySets<const Sets extends readonly CapabilitySet[]>(
  sets: Sets,
): MergeCapabilitySets<Sets> {
  return blindCast<
    MergeCapabilitySets<Sets>,
    'mergeCapabilityMatrices merges the sets in order, later flags winning, as MergeCapabilitySets does'
  >(
    mergeCapabilityMatrices(
      {},
      sets.map((capabilities) => ({ capabilities })),
    ),
  );
}

/** The capabilities `table` lists for `version`. */
export function capabilitiesForVersion<
  const Table extends ServerVersionTable,
  const Version extends keyof Table & number,
>(table: Table, version: Version): Table[Version] {
  return resolveServerVersion(table, version, 'PostgreSQL');
}

export type PostgresVersionCapabilities<Version extends PostgresServerVersion> =
  (typeof postgresServerVersions)[Version];

/** The PostgreSQL target as a database with `capabilities` provides it. */
export type PostgresTargetWith<Capabilities extends CapabilitySet> = Omit<
  typeof postgresPack,
  'capabilities'
> & { readonly capabilities: Capabilities };

export function postgresTargetWith<const Capabilities extends CapabilitySet>(
  capabilities: Capabilities,
): PostgresTargetWith<Capabilities> {
  return { ...postgresPack, capabilities };
}
