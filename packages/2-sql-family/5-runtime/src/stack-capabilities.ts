import type { Contract } from '@internal/contract/types';
import {
  capabilityKeysText,
  capabilityUnavailableMessage,
} from '@internal/sql-contract/capability-messages';
import type { SqlStorage } from '@internal/sql-contract/types';
import { structuredError } from '@internal/utils/structured-error';
import type { SqlExecutionStackWithDriver } from './sql-context';
import type { RuntimeExecutionOptions } from './sql-runtime';

/*
 * What the stack provides: the target declares the database's capabilities, which signing checks, and the adapter and the driver declare the rest. Extensions declare none. The run-time function and the types below apply this one rule.
 */

type CapabilitySet = Readonly<Record<string, unknown>> | undefined;

function flagIn(set: CapabilitySet, namespace: string, flag: string): unknown {
  const flags = set?.[namespace];
  return typeof flags === 'object' && flags !== null ? Reflect.get(flags, flag) : undefined;
}

/** The capabilities `contract` requires, as `namespace.flag`, that are not the database's and that neither the adapter nor the driver provides. */
export function capabilitiesNotProvided(
  contract: Contract<SqlStorage>,
  stack: SqlExecutionStackWithDriver,
): readonly string[] {
  const isDatabaseCapability = (namespace: string, flag: string) =>
    flagIn(stack.target.databaseCapabilities, namespace, flag) !== undefined;
  const isProvided = (namespace: string, flag: string) =>
    [stack.adapter.capabilities, stack.driver.capabilities].some(
      (set) => flagIn(set, namespace, flag) === true,
    );

  return Object.entries(contract.capabilities).flatMap(([namespace, flags]) =>
    Object.entries(flags)
      .filter(
        ([flag, required]) =>
          required && !isDatabaseCapability(namespace, flag) && !isProvided(namespace, flag),
      )
      .map(([flag]) => `${namespace}.${flag}`),
  );
}

function notProvidedByTheConnectionMessage(missing: readonly string[]): string {
  const [it, provides] = missing.length === 1 ? ['it', 'provides it'] : ['them', 'provides them'];
  return `Your contract requires ${capabilityKeysText(missing)}, which this client's connection does not provide. Remove ${it} from your contract's required capabilities, or connect with a driver that ${provides}.`;
}

/**
 * Warns through `options.log`, once, when the stack does not provide a capability `contract` requires. `verifyMarker: false`, which turns off the signature warning, turns this one off too.
 */
export function warnOfCapabilitiesNotProvided(
  contract: Contract<SqlStorage>,
  stack: SqlExecutionStackWithDriver,
  options: Pick<RuntimeExecutionOptions, 'log' | 'verifyMarker'>,
): void {
  if (options.verifyMarker === false) return;
  const missing = capabilitiesNotProvided(contract, stack);
  if (missing.length === 0) return;
  options.log?.warn({
    code: 'CONTRACT.CAPABILITIES_NOT_PROVIDED',
    scope: 'stack-verification',
    missing,
    message: notProvidedByTheConnectionMessage(missing),
  });
}

// A contract's capabilities type can be its literal flags intersected with the wide matrix every contract has, so the index signature is dropped before the flags are named.
type Known<Set> = {
  [Key in keyof Set as string extends Key ? never : Key]: Set[Key];
};

type IsAny<Type> = 0 extends 1 & Type ? true : false;

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

/** At type level, the capabilities `Capabilities` requires that are not `DatabaseCapabilities` and that neither the adapter's nor the driver's set provides. */
export type CapabilitiesNotProvided<
  Capabilities,
  DatabaseCapabilities,
  AdapterCapabilities,
  DriverCapabilities,
> =
  IsAny<Capabilities> extends true
    ? never
    : Exclude<
        EnabledFlagNames<Capabilities>,
        | FlagNames<DatabaseCapabilities>
        | EnabledFlagNames<AdapterCapabilities>
        | EnabledFlagNames<DriverCapabilities>
      >;

// True only for a known, non-empty set of names: `never` (nothing missing) and `any` give false.
type NamesSomething<Missing> = [Missing] extends [1 & Missing] ? false : true;

/**
 * Nothing when `Missing` is empty; otherwise a property no value has, named `${Prefix}${name}${Suffix}` for each missing name, so the value given there is a type error that names it.
 *
 * The verdict is the false branch when nothing is missing. For a contract type that is still a type parameter, TypeScript checks only that branch, so a function generic over contracts compiles, and its callers are checked only at run time; the check applies where the contract type is known.
 */
export type NoneMissing<
  Missing extends string,
  Prefix extends string,
  Suffix extends string = '',
> = [NamesSomething<Missing>] extends [true]
  ? { readonly [Name in Missing as `${Prefix}${Name}${Suffix}`]: never }
  : unknown;

interface StackDescriptors {
  readonly target: { readonly databaseCapabilities?: unknown };
  readonly adapter: { readonly capabilities?: unknown };
  readonly driver: { readonly capabilities?: unknown };
}

/**
 * Creating a client from `Stack` for `TContract` is a type error naming each capability the contract requires that is not the database's and that its adapter and driver do not provide. A function generic over contracts is checked only when the client is created (see `NoneMissing`).
 */
export type StackProvides<
  TContract extends Contract<SqlStorage>,
  Stack extends StackDescriptors,
> = NoneMissing<
  CapabilitiesNotProvided<
    TContract['capabilities'],
    Stack['target']['databaseCapabilities'],
    Stack['adapter']['capabilities'],
    Stack['driver']['capabilities']
  >,
  '',
  " is required by the contract but not provided by this client's connection"
>;

/** The capability a contract requires when the application runs transactions whose statements it sends one at a time. */
export interface InteractiveTransactionsCapability {
  readonly sql: { readonly interactiveTransactions: true };
}

type InteractiveTransactionsNotListed<Capabilities> =
  IsAny<Capabilities> extends true
    ? never
    : Capabilities extends InteractiveTransactionsCapability
      ? never
      : 'sql.interactiveTransactions';

/** What a `transaction()` callback must also be: nothing for a contract that requires interactive transactions; for one that does not, a type no callback is, whose error names the capability. */
export type InteractiveTransactionsListed<TContract extends Contract<SqlStorage>> = NoneMissing<
  InteractiveTransactionsNotListed<TContract['capabilities']>,
  '`transaction()` is unavailable: your contract declares no dependency on `',
  '`'
>;

/** Refuses `transaction()` for a contract that does not require interactive transactions. */
export function assertInteractiveTransactionsListed(contract: Contract<SqlStorage>): void {
  if (contract.capabilities['sql']?.['interactiveTransactions'] === true) return;
  throw structuredError(
    'ORM.CAPABILITY_MISSING',
    capabilityUnavailableMessage('`transaction()`', ['sql.interactiveTransactions']),
    { meta: { capability: 'sql.interactiveTransactions', method: 'transaction' } },
  );
}
