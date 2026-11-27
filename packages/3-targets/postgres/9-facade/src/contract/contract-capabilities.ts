import { postgresDriverCapabilities } from '@internal/driver-postgres/capabilities';
import {
  type CapabilitiesFromKeys,
  type CapabilityKey,
  capabilitiesFromKeys,
  capabilityKeysOf,
} from '@internal/sql-contract-ts/contract-builder';
import {
  postgresCapabilitiesByVersion,
  postgresRetiredCapabilities,
} from '@internal/target-postgres/server-version';
import { postgresError } from '../errors';
import { defaultRequiredCapabilityLists } from './default-required-capability-lists';

/** The capabilities PostgreSQL 15 provides, as keys for `requiredCapabilities`. */
export const postgres15 = capabilityKeysOf(postgresCapabilitiesByVersion[15]);
/** The capabilities PostgreSQL 16 provides, as keys for `requiredCapabilities`. */
export const postgres16 = capabilityKeysOf(postgresCapabilitiesByVersion[16]);
/** The capabilities PostgreSQL 17 provides, as keys for `requiredCapabilities`. */
export const postgres17 = capabilityKeysOf(postgresCapabilitiesByVersion[17]);
/** The capabilities PostgreSQL 18 provides, as keys for `requiredCapabilities`. */
export const postgres18 = capabilityKeysOf(postgresCapabilitiesByVersion[18]);
/** The capabilities the connection of the PostgreSQL driver provides, as keys for `requiredCapabilities`. */
export const postgresDriver = capabilityKeysOf(postgresDriverCapabilities);

/** Prisma 8.0 removes it. */
const providedCapabilityLists = {
  postgres15,
  postgres16,
  postgres17,
  postgres18,
  postgresDriver,
} as const;

/**
 * What a contract that lists no required capabilities requires: the newest PostgreSQL version's list and the driver's, as `init` writes them. A stopgap for contracts written before the list existed: `prisma contract emit` warns where it is used, and Prisma 8.0 removes it and requires the list.
 */
export type DefaultRequiredCapabilities =
  (typeof providedCapabilityLists)[(typeof defaultRequiredCapabilityLists)[number]];

/** The capabilities of `DefaultRequiredCapabilities`, as one list. Prisma 8.0 removes it. */
export const defaultRequiredCapabilities: readonly DefaultRequiredCapabilities[number][] =
  Object.freeze(defaultRequiredCapabilityLists.flatMap((list) => providedCapabilityLists[list]));

const contractsWithDefaultKey = Symbol.for(
  'prisma.orm.postgres.contractsWithDefaultRequiredCapabilities',
);

/** Kept on `globalThis`, as `validateContractOnce` keeps its record, so that two copies of this package in one process, such as the workspace's and an installed one, share it. Prisma 8.0 removes it. */
function contractsWithDefault(): WeakSet<object> {
  const existing: unknown = Reflect.get(globalThis, contractsWithDefaultKey);
  if (existing instanceof WeakSet) return existing;
  const created = new WeakSet<object>();
  Object.defineProperty(globalThis, contractsWithDefaultKey, { value: created });
  return created;
}

/** Records that `contract` was built with `defaultRequiredCapabilities`, so that emitting it warns. Prisma 8.0 removes it. */
export function recordDefaultRequiredCapabilities(contract: object): void {
  contractsWithDefault().add(contract);
}

/** Whether `contract` was built with `defaultRequiredCapabilities`, because its source listed none. Prisma 8.0 removes it. */
export function hasDefaultRequiredCapabilities(contract: unknown): boolean {
  return typeof contract === 'object' && contract !== null && contractsWithDefault().has(contract);
}

/**
 * Everything a contract requires of its database and its connection, each capability as its key, such as `sql.returning`. Spread the lists of what the database version and the driver provide, and filter out or leave out what the application does not use: `[...postgres18, ...postgresDriver]`. The list must not be empty.
 */
export type RequiredCapabilities = readonly CapabilityKey[];

/** The capabilities a contract with `Required` records. */
export type PostgresContractCapabilities<Required extends RequiredCapabilities> =
  CapabilitiesFromKeys<Required[number]>;

function isCapabilityKey(key: unknown): key is CapabilityKey {
  if (typeof key !== 'string') return false;
  const dot = key.indexOf('.');
  return dot > 0 && dot < key.length - 1;
}

/** Prisma 8.0 removes it, with the refusal of a retired key. */
function isRetired(key: CapabilityKey): boolean {
  const dot = key.indexOf('.');
  const flags: unknown = Reflect.get(postgresRetiredCapabilities, key.slice(0, dot));
  return typeof flags === 'object' && flags !== null && Object.hasOwn(flags, key.slice(dot + 1));
}

function describeEntry(entry: unknown): string {
  switch (typeof entry) {
    case 'string':
      return JSON.stringify(entry);
    case 'bigint':
      return `${entry}n`;
    case 'function':
      return 'a function';
    case 'object':
      return entry === null ? 'null' : describeObject(entry);
    default:
      return String(entry);
  }
}

function describeObject(entry: object): string {
  try {
    return JSON.stringify(entry) ?? 'an object';
  } catch {
    return 'an object';
  }
}

function refuseList(message: string): never {
  throw postgresError('CONTRACT.ARGUMENT_INVALID', message);
}

/**
 * The capabilities a contract records for `required`, refusing a list that is missing, empty, not a list, or holds an entry that is not a capability key or is a retired one. `where` names where the author writes the list, for the refusal.
 */
export function requiredCapabilitiesFor<const Required extends RequiredCapabilities>(
  required: Required | undefined,
  where: string,
): PostgresContractCapabilities<Required> {
  if (required === undefined) {
    refuseList(
      `State the capabilities your contract requires in requiredCapabilities ${where}. The list is missing.`,
    );
  }
  if (!Array.isArray(required)) {
    refuseList(
      `requiredCapabilities ${where} is not a list. State the capabilities your contract requires as a list of capability keys.`,
    );
  }
  if (required.length === 0) {
    refuseList(
      `State the capabilities your contract requires in requiredCapabilities ${where}. The list is empty.`,
    );
  }
  const notAKey = required.findIndex((key) => !isCapabilityKey(key));
  if (notAKey >= 0) {
    refuseList(
      `requiredCapabilities ${where} lists ${describeEntry(required[notAKey])}, which is not a capability key. A key is a namespace and a flag joined by a dot, as error messages print it.`,
    );
  }
  const retired = required.find(isRetired);
  if (retired !== undefined) {
    refuseList(
      `requiredCapabilities ${where} lists ${JSON.stringify(retired)}, which is a retired capability: nothing reads it any more. Remove it from the list.`,
    );
  }
  return capabilitiesFromKeys<Required[number]>(required);
}

/**
 * The capabilities a PostgreSQL contract records for `requiredCapabilities`. A config that builds its contract source without `defineConfig` passes the result to the source, such as `prismaContract`'s `capabilities` option.
 */
export function postgresContractCapabilities<const Required extends RequiredCapabilities>(
  requiredCapabilities: Required,
): PostgresContractCapabilities<Required> {
  return requiredCapabilitiesFor(requiredCapabilities, 'given to postgresContractCapabilities');
}
