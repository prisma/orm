import type { Contract } from '@internal/contract/types';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { createContract } from '@repo/test-utils';
import { createAggregateContractSpace } from '../src/aggregate/aggregate';
import type { AggregateContractSpace } from '../src/aggregate/types';
import { EMPTY_CONTRACT_HASH } from '../src/constants';
import { computeMigrationHash } from '../src/hash';
import { deriveProvidedInvariants } from '../src/invariants';
import { writeMigrationPackage } from '../src/io';
import type { MigrationMetadata } from '../src/metadata';
import type { MigrationOps, OnDiskMigrationPackage } from '../src/package';
import type { Refs } from '../src/refs';
import type { ContractSpaceHeadRecord } from '../src/verify-contract-spaces';

export function createTestContract(overrides: Partial<Contract> = {}): Contract {
  return createContract(overrides);
}

/**
 * Build fully-attested test metadata. By default the `migrationHash` is
 * computed over `(metadata, [])` so the package is internally consistent
 * for `verifyMigrationHash`. Pass `ops` when the test cares about
 * matching a specific op list.
 */
export function createTestMetadata(
  overrides: Partial<MigrationMetadata> = {},
  ops: MigrationOps = [],
): MigrationMetadata {
  const baseMetadata: Omit<MigrationMetadata, 'migrationHash'> = {
    from: null,
    to: 'abc123',
    // Auto-derive from ops by default so fixture-built packages
    // round-trip through `readMigrationPackage`'s verify-time check.
    // Tests that need a deliberate mismatch can override the field.
    providedInvariants: deriveProvidedInvariants(ops),
    createdAt: '2026-02-25T14:30:00.000Z',
    ...overrides,
  };
  return {
    ...baseMetadata,
    migrationHash: overrides.migrationHash ?? computeMigrationHash(baseMetadata, ops),
  };
}

/**
 * Build an attested test package (metadata + ops + dir info) with a
 * `migrationHash` computed over the supplied ops.
 */
export function createAttestedPackage(
  dirName: string,
  metadataOverrides: Omit<Partial<MigrationMetadata>, 'migrationHash'> = {},
  ops: MigrationOps = createTestOps(),
): OnDiskMigrationPackage {
  return {
    dirName,
    dirPath: `/tmp/migrations/${dirName}`,
    metadata: createTestMetadata(metadataOverrides, ops),
    ops,
  };
}

/**
 * Build a {@link AggregateContractSpace} for engine tests from the fields a
 * test cares about. `graph()` is reconstructed from `packages` and
 * `contract()` returns the supplied (already-deserialized) contract.
 * Defaults: empty packages / refs, an empty-contract head ref, and a
 * blank SQL/postgres contract.
 */
export function makeAggregateContractSpace(args: {
  spaceId: string;
  contract?: Contract;
  headRef?: ContractSpaceHeadRecord | null;
  packages?: readonly OnDiskMigrationPackage[];
  refs?: Refs;
  refsDir?: string;
  migrationsDir?: string;
  deserializeContract?: (raw: unknown) => Contract;
}): AggregateContractSpace {
  const contract = args.contract ?? createContract();
  const deserializeContract = args.deserializeContract ?? ((raw: unknown) => raw as Contract);
  return createAggregateContractSpace({
    spaceId: args.spaceId,
    packages: args.packages ?? [],
    refs: args.refs ?? {},
    headRef:
      args.headRef === undefined ? { hash: EMPTY_CONTRACT_HASH, invariants: [] } : args.headRef,
    refsDir: args.refsDir ?? '/tmp/refs',
    migrationsDir: args.migrationsDir ?? '/tmp/migrations',
    resolveContract: () => contract,
    deserializeContract,
  });
}

export function createTestOps(): readonly MigrationPlanOperation[] {
  return [
    {
      id: 'table.users',
      label: 'Create table users',
      operationClass: 'additive',
    },
  ];
}

/**
 * Canonical helper for writing a test migration package to disk. Always
 * produces a *consistent* (attested) package: the `migrationHash` is
 * computed over the exact `ops` passed to the writer, so the resulting
 * package round-trips through `readMigrationPackage`'s integrity check.
 *
 * Tampering tests use this same helper and then surgically overwrite the
 * offending file post-hoc (e.g. `fs.writeFile(join(dir, 'ops.json'), ...)`).
 * That keeps the corruption visible (the test names exactly which file is
 * being corrupted) and makes the package's initial state incontrovertibly
 * consistent — there is no path that produces an inconsistent fixture by
 * accident.
 */
export async function writeTestPackage(
  dir: string,
  metadataOverrides: Omit<Partial<MigrationMetadata>, 'migrationHash'> = {},
  ops: MigrationOps = createTestOps(),
): Promise<{ metadata: MigrationMetadata; ops: MigrationOps }> {
  const metadata = createTestMetadata(metadataOverrides, ops);
  await writeMigrationPackage(dir, metadata, ops);
  return { metadata, ops };
}

export function pkgWithHash(
  from: string,
  to: string,
  dirName: string,
  migrationHash: string,
  invariants: readonly string[] = [],
): OnDiskMigrationPackage {
  return {
    dirName,
    dirPath: `/migrations/${dirName}`,
    metadata: createTestMetadata({
      from,
      to,
      createdAt: '2026-02-25T14:00:00.000Z',
      migrationHash,
      providedInvariants: invariants,
    }),
    ops: createTestOps(),
  };
}
