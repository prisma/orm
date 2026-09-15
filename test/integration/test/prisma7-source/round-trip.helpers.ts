/**
 * The round-trip assertion for the Prisma 7 to Prisma 8 conversion: two
 * serialized Postgres contracts are the same contract when their storage,
 * execution, and profile hashes agree and their domain planes are deeply
 * equal. The domain plane is compared whole because no hash covers it, and
 * it is what `contract.d.ts` and the user's client code see.
 */
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { expect } from 'vitest';

interface SerializedPostgresContract {
  readonly profileHash?: unknown;
  readonly domain?: unknown;
  readonly storage?: { readonly storageHash?: unknown };
  readonly execution?: { readonly executionHash?: unknown };
}

/** A contract with no generators has no execution section; absence is compared explicitly, never as `undefined`. */
const NO_EXECUTION_SECTION = 'no execution section';

function requireHash(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is missing from the serialized contract; nothing to compare`);
  }
  return value;
}

function comparablePlanes(contract: Contract) {
  const serialized: SerializedPostgresContract = new PostgresContractSerializer().serializeContract(
    contract as Contract<SqlStorage>,
  );
  const domain = serialized.domain;
  if (typeof domain !== 'object' || domain === null || Object.keys(domain).length === 0) {
    throw new Error('domain plane is missing from the serialized contract; nothing to compare');
  }
  return {
    domain,
    storageHash: requireHash(serialized.storage?.storageHash, 'storageHash'),
    executionHash:
      serialized.execution === undefined
        ? NO_EXECUTION_SECTION
        : requireHash(serialized.execution.executionHash, 'executionHash'),
    profileHash: requireHash(serialized.profileHash, 'profileHash'),
  };
}

export function expectSameContract(actual: Contract, expected: Contract): void {
  expect(comparablePlanes(actual)).toEqual(comparablePlanes(expected));
}
