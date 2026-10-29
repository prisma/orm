import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { findPathWithDecision, reconstructGraph } from '@internal/migration-tools/migration-graph';
import { assertDescriptorSelfConsistency } from '@internal/migration-tools/spaces';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { describe, expect, it } from 'vitest';
import { VECTOR_CODEC_ID } from '../src/core/constants';
import {
  PGVECTOR_BASELINE_MIGRATION_NAME,
  PGVECTOR_INSTALL_MIGRATION_NAME,
  PGVECTOR_INVARIANTS,
  PGVECTOR_NATIVE_TYPE,
  PGVECTOR_SPACE_ID,
  PGVECTOR_UPGRADE_MIGRATION_NAME,
} from '../src/core/contract-space-constants';
import pgvectorExtensionDescriptor from '../src/exports/control';

const space = pgvectorExtensionDescriptor.contractSpace!;
const headHash = space.contractJson.storage.storageHash;

function migration(dirName: string) {
  const found = space.migrations.find((m) => m.dirName === dirName);
  if (found === undefined) throw new Error(`no migration ${dirName}`);
  return found;
}

describe('pgvector extension descriptor', () => {
  it('declares the vector extension and the parameterised vector type', () => {
    const publicNamespace = space.contractJson.storage.namespaces['public'] as {
      readonly entries: Record<string, Record<string, unknown>>;
    };
    expect(publicNamespace.entries).toEqual({
      extension: { vector: { kind: 'extension', name: 'vector' } },
      table: {},
    });
    expect(space.contractJson.storage.types?.[PGVECTOR_NATIVE_TYPE]).toMatchObject({
      codecId: VECTOR_CODEC_ID,
    });
  });

  it('keeps the old install migration, which records the install invariant', () => {
    const baseline = migration(PGVECTOR_BASELINE_MIGRATION_NAME);
    expect(baseline.metadata.from).toBeNull();
    expect(baseline.metadata.to).not.toBe(headHash);
    expect(baseline.metadata.providedInvariants).toEqual([PGVECTOR_INVARIANTS.installVector]);
  });

  it('moves the old head to the new head by creating the extension if missing', () => {
    const upgrade = migration(PGVECTOR_UPGRADE_MIGRATION_NAME);
    expect(upgrade.metadata).toMatchObject({
      from: migration(PGVECTOR_BASELINE_MIGRATION_NAME).metadata.to,
      to: headHash,
      providedInvariants: [],
    });
    expect(upgrade.ops.map((op) => [op.id, op.invariantId])).toEqual([
      ['extension.vector', undefined],
    ]);
  });

  it('builds a new database in one migration that records no invariant', () => {
    const install = migration(PGVECTOR_INSTALL_MIGRATION_NAME);
    expect(install.metadata).toMatchObject({ from: null, to: headHash, providedInvariants: [] });
    expect(install.ops.map((op) => op.id)).toEqual(['schema.public', 'extension.vector']);
  });

  it('takes an empty database to the head through the one-step migration', () => {
    const graph = reconstructGraph(space.migrations.map((m) => ({ ...m, dirPath: m.dirName })));
    const outcome = findPathWithDecision(graph, EMPTY_CONTRACT_HASH, headHash, {
      required: new Set(space.headRef.invariants),
    });
    expect(
      outcome.kind === 'ok' ? outcome.decision.selectedPath.map((edge) => edge.dirName) : outcome,
    ).toEqual([PGVECTOR_INSTALL_MIGRATION_NAME]);
  });

  it('points the head ref at the contract and requires no invariant', () => {
    expect(space.headRef).toEqual({ hash: headHash, invariants: [] });
  });

  it("records each migration's hash of its contents", () => {
    const hashes = (hash: (m: (typeof space.migrations)[number]) => string) =>
      Object.fromEntries(space.migrations.map((m) => [m.dirName, hash(m)]));
    expect(space.migrations).toHaveLength(3);
    expect(hashes((m) => computeMigrationHash(m.metadata, m.ops))).toEqual(
      hashes((m) => m.metadata.migrationHash),
    );
  });

  it('passes the self-consistency check', () => {
    expect(() =>
      assertDescriptorSelfConsistency({
        extensionId: PGVECTOR_SPACE_ID,
        target: space.contractJson.target,
        targetFamily: space.contractJson.targetFamily,
        storage: space.contractJson.storage,
        headRefHash: space.headRef.hash,
        ...sqlContractCanonicalizationHooks,
      }),
    ).not.toThrow();
  });
});
