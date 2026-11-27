import { postgresDriverCapabilities } from '@internal/driver-postgres/capabilities';
import {
  type CapabilitiesFromKeys,
  type CapabilityKey,
  capabilitiesFromKeys,
  capabilityKeysOf,
} from '@internal/sql-contract-ts/contract-builder';
import { postgresCapabilitiesByVersion } from '@internal/target-postgres/server-version';
import { postgresError } from '../errors';

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

/**
 * Everything a contract requires of its database and its connection, each capability as its key, such as `sql.returning`. Spread the lists of what the database version and the driver provide, and filter out or leave out what the application does not use: `[...postgres18, ...postgresDriver]`. The list must not be empty.
 */
export type RequiredCapabilities = readonly CapabilityKey[];

/** The capabilities a contract with `Required` records. */
export type PostgresContractCapabilities<Required extends RequiredCapabilities> =
  CapabilitiesFromKeys<Required[number]>;

function isListed<Required extends RequiredCapabilities>(
  required: Required | undefined,
): required is Required {
  return Array.isArray(required) && required.length > 0;
}

function isCapabilityKey(key: unknown): key is CapabilityKey {
  return typeof key === 'string' && key.indexOf('.') > 0;
}

/**
 * The capabilities a contract records for `required`, refusing a list that is missing or empty. `where` names where the author writes the list, for the refusal.
 */
export function requiredCapabilitiesFor<const Required extends RequiredCapabilities>(
  required: Required | undefined,
  where: string,
): PostgresContractCapabilities<Required> {
  if (!isListed(required)) {
    throw postgresError(
      'CONTRACT.ARGUMENT_INVALID',
      `State the capabilities your contract requires in requiredCapabilities ${where}. The list is missing or empty.`,
    );
  }
  const notAKey = required.find((key) => !isCapabilityKey(key));
  if (notAKey !== undefined) {
    throw postgresError(
      'CONTRACT.ARGUMENT_INVALID',
      `requiredCapabilities ${where} lists ${JSON.stringify(notAKey)}, which is not a capability key. A key is a namespace and a flag joined by a dot, as error messages print it.`,
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
