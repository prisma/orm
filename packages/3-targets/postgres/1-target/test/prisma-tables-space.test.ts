import type { Contract } from '@internal/contract/types';
import { type MigrationPackage, PRISMA_SPACE_ID } from '@internal/framework-components/control';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { verifyMigrationHash } from '@internal/migration-tools/hash';
import { findPathWithDecision, reconstructGraph } from '@internal/migration-tools/migration-graph';
import { assertDescriptorSelfConsistency } from '@internal/migration-tools/spaces';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import postgresTargetDescriptor from '../src/exports/control';

/** Within a major version, a migration after the first may only add, and provides no invariant: an earlier release of the same major version keeps using a database a later one brought further, and an invariant on the row is how a later major version tells an earlier one to stop. */
function migrationsThatDoMoreThanAdd(migrations: readonly MigrationPackage[]): readonly string[] {
  return migrations
    .filter((pkg) => pkg.metadata.from !== null)
    .filter(
      (pkg) =>
        pkg.metadata.providedInvariants.length > 0 ||
        pkg.ops.some((op) => op.operationClass !== 'additive'),
    )
    .map((pkg) => pkg.dirName);
}

function prismaTablesSpace() {
  const space = postgresTargetDescriptor.contractSpace;
  if (space === undefined) throw new Error('the Postgres target carries no contract space');
  return space;
}

describe("the Postgres target's contract space for Prisma's own tables", () => {
  it('describes the tables signatures, config, ledger and contract in schema _prisma', () => {
    const { storage } = prismaTablesSpace().contractJson as Contract<SqlStorage>;
    const prismaNamespace = storage.namespaces[PRISMA_SPACE_ID] as {
      readonly entries: { readonly table: Record<string, unknown> };
    };
    expect(Object.keys(prismaNamespace.entries.table).sort()).toEqual([
      'config',
      'contract',
      'ledger',
      'signatures',
    ]);
  });

  it('points its head ref at its contract and requires no invariant', () => {
    const space = prismaTablesSpace();
    expect(space.headRef).toEqual({
      hash: (space.contractJson as Contract<SqlStorage>).storage.storageHash,
      invariants: [],
    });
  });

  it('passes the self-consistency check', () => {
    const space = prismaTablesSpace();
    expect(() =>
      assertDescriptorSelfConsistency({
        extensionId: PRISMA_SPACE_ID,
        contractJson: space.contractJson,
        headRefHash: space.headRef.hash,
        ...sqlContractCanonicalizationHooks,
      }),
    ).not.toThrow();
  });

  it('records the hash of each migration over its contents', () => {
    const failures = prismaTablesSpace().migrations.filter((pkg) => !verifyMigrationHash(pkg).ok);
    expect(failures.map((pkg) => pkg.dirName)).toEqual([]);
  });

  it('reaches its head from an empty database', () => {
    const space = prismaTablesSpace();
    const outcome = findPathWithDecision(
      reconstructGraph(space.migrations),
      EMPTY_CONTRACT_HASH,
      space.headRef.hash,
      { required: new Set(space.headRef.invariants) },
    );
    expect(outcome.kind).toBe('ok');
  });

  it('has a first migration that starts from an empty database', () => {
    expect(prismaTablesSpace().migrations[0]?.metadata.from).toBeNull();
  });

  it('only adds, and provides no invariant, in every migration after the first', () => {
    expect(migrationsThatDoMoreThanAdd(prismaTablesSpace().migrations)).toEqual([]);
  });

  it('would name a later migration that does more than add, or provides an invariant', () => {
    const [first] = prismaTablesSpace().migrations;
    if (first === undefined) throw new Error('the space has no migration');
    const later = (
      dirName: string,
      change: Partial<MigrationPackage['metadata']>,
      ops = first.ops,
    ) => ({
      ...first,
      dirName,
      metadata: { ...first.metadata, from: first.metadata.to, ...change },
      ops,
    });
    expect(
      migrationsThatDoMoreThanAdd([
        first,
        later('widens', {}),
        later('provides', { providedInvariants: ['_prisma:major-9'] }, []),
        later('adds', {}, []),
      ]),
    ).toEqual(['widens', 'provides']);
  });
});
