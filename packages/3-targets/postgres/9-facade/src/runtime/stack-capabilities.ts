import type { postgresAdapterCapabilities } from '@internal/adapter-postgres/capabilities';
import type { Contract } from '@internal/contract/types';
import type { postgresDriverCapabilities } from '@internal/driver-postgres/capabilities';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  capabilitiesTheStackDoesNotProvide,
  type RuntimeExecutionOptions,
  type SqlExecutionStackWithDriver,
} from '@internal/sql-runtime';
import type {
  CapabilitiesByVersion,
  postgresCapabilitiesByVersion,
} from '@internal/target-postgres/server-version';

// A contract's capabilities type can be its literal flags intersected with the wide matrix every contract has, so the wide matrix's index signature is dropped before the flags are named.
type Known<Set> = {
  [Key in keyof Set as string extends Key ? never : Key]: Set[Key];
};

type EnabledFlagNames<Set> = Set extends unknown
  ? {
      [Namespace in keyof Known<Set> & string]: {
        [Flag in keyof Known<Known<Set>[Namespace]> & string]: Known<
          Known<Set>[Namespace]
        >[Flag] extends true
          ? `${Namespace}.${Flag}`
          : never;
      }[keyof Known<Known<Set>[Namespace]> & string];
    }[keyof Known<Set> & string]
  : never;

type FlagNames<Set> = Set extends unknown
  ? {
      [Namespace in keyof Known<Set> &
        string]: `${Namespace}.${keyof Known<Known<Set>[Namespace]> & string}`;
    }[keyof Known<Set> & string]
  : never;

/**
 * The capabilities `Capabilities` requires, as `namespace.flag`, that are not facts about the database (any row of `Table`) and that neither the adapter's nor the driver's set provides. Signing checks the database for the rest.
 */
export type CapabilitiesNotProvided<
  Capabilities,
  Table extends CapabilitiesByVersion,
  AdapterCapabilities,
  DriverCapabilities,
> = Exclude<
  EnabledFlagNames<Capabilities>,
  | FlagNames<Table[keyof Table]>
  | EnabledFlagNames<AdapterCapabilities>
  | EnabledFlagNames<DriverCapabilities>
>;

// True only for a known, non-empty set of capabilities: `never` (nothing missing) and `any` give false.
type NamesSomething<Missing> = [Missing] extends [1 & Missing] ? false : true;

/**
 * Nothing when `Missing` is empty; otherwise a property no value has, named `${Reason} ${capability}` for each capability, so the value given there is a type error that names it.
 *
 * The verdict is the false branch when nothing is missing. For a contract type that is still a type parameter, TypeScript checks only that branch, so a function generic over contracts compiles; the check applies where the contract is known.
 */
export type RequiresCapabilities<Missing extends string, Reason extends string> = [
  NamesSomething<Missing>,
] extends [true]
  ? { readonly [Capability in Missing as `${Reason} ${Capability}`]: never }
  : unknown;

/** Creating the client is a type error naming each capability its adapter and driver lack. */
export type StackProvides<Missing extends string> = RequiresCapabilities<
  Missing,
  'the adapter and driver do not provide'
>;

/** The check `postgres()` and `postgresServerless()` make against their adapter and driver. */
export type PostgresStackProvides<TContract extends Contract<SqlStorage>> = StackProvides<
  CapabilitiesNotProvided<
    TContract['capabilities'],
    typeof postgresCapabilitiesByVersion,
    typeof postgresAdapterCapabilities,
    typeof postgresDriverCapabilities
  >
>;

/**
 * Warns through `options.log`, once, when the stack lacks a capability `contract` requires. `verifyMarker: false`, which turns off the signature warning, turns this one off too.
 */
export function warnWhenStackLacksCapabilities(
  contract: Contract<SqlStorage>,
  stack: SqlExecutionStackWithDriver,
  options: Pick<RuntimeExecutionOptions, 'log' | 'verifyMarker'>,
): void {
  if (options.verifyMarker === false) return;
  const missing = capabilitiesTheStackDoesNotProvide(contract, stack);
  if (missing.length === 0) return;
  options.log?.warn({
    code: 'CONTRACT.CAPABILITIES_NOT_PROVIDED',
    scope: 'stack-verification',
    missing,
    message: `The contract requires ${missing.join(', ')}, which the client's adapter and driver do not provide. State a capabilities list that matches the driver the application runs with, emit the contract, and sign the database again.`,
  });
}
