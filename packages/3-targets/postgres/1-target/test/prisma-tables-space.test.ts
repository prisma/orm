import type { Contract } from '@internal/contract/types';
import { PRISMA_SPACE_ID } from '@internal/framework-components/control';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { verifyMigrationHash } from '@internal/migration-tools/hash';
import { findPathWithDecision, reconstructGraph } from '@internal/migration-tools/migration-graph';
import { assertDescriptorSelfConsistency } from '@internal/migration-tools/spaces';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import postgresTargetDescriptor from '../src/exports/control';

function prismaTablesSpace() {
  const space = postgresTargetDescriptor.contractSpace;
  if (space === undefined) throw new Error('the Postgres target carries no contract space');
  return space;
}

describe("the Postgres target's contract space for Prisma's own tables", () => {
  it('describes the tables marker, ledger and contract in schema _prisma', () => {
    const { storage } = prismaTablesSpace().contractJson as Contract<SqlStorage>;
    const prismaNamespace = storage.namespaces[PRISMA_SPACE_ID] as {
      readonly entries: { readonly table: Record<string, unknown> };
    };
    expect(Object.keys(prismaNamespace.entries.table).sort()).toEqual([
      'contract',
      'ledger',
      'marker',
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
    const contract = space.contractJson as Contract<SqlStorage>;
    expect(() =>
      assertDescriptorSelfConsistency({
        extensionId: PRISMA_SPACE_ID,
        target: contract.target,
        targetFamily: contract.targetFamily,
        storage: contract.storage,
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
});
