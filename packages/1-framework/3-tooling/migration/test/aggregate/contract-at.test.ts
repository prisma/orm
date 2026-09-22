import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Contract } from '@internal/contract/types';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAggregateContractSpace } from '../../src/aggregate/aggregate';
import { contractSnapshotDir, writeContractSnapshot } from '../../src/contract-snapshot-store';
import { writeRef } from '../../src/refs';
import { createAttestedPackage, createTestContract, writeTestPackage } from '../fixtures';

const HASH_A = `${'a'.repeat(64)}`;
const HASH_B = `${'b'.repeat(64)}`;

function sampleContractDts(label: string): string {
  return `// generated ${label}\nexport type Contract = unknown;\n`;
}

function sampleContractJson(storageHash: string): unknown {
  return {
    schemaVersion: '1',
    targetFamily: 'sql',
    target: 'postgres',
    profileHash: `${'p'.repeat(64)}`,
    storage: { storageHash },
    domain: {
      namespaces: {
        __unbound__: {
          models: {
            User: {
              fields: {
                id: {
                  nullable: false,
                  type: { kind: 'scalar', codecId: 'sql/int4@1' },
                },
              },
              relations: {},
              storage: { namespaceId: '__unbound__', table: 'users', namespace: 'public' },
            },
          },
        },
      },
    },
    roots: {},
  };
}

async function writeEndContract(
  migrationsDir: string,
  storageHash: string,
  dtsLabel: string,
): Promise<void> {
  await writeContractSnapshot(migrationsDir, storageHash, {
    contractJson: sampleContractJson(storageHash),
    contractDts: sampleContractDts(dtsLabel),
  });
}

describe('AggregateContractSpace.contractAt', () => {
  let workDir: string;
  let refsDir: string;
  let packageDir: string;

  const identityDeserialize = (json: unknown): Contract => json as Contract;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'contract-at-'));
    refsDir = join(workDir, 'refs');
    await mkdir(refsDir, { recursive: true });
    packageDir = join(workDir, '20260101T0000_init');
    await writeTestPackage(packageDir, { from: null, to: HASH_B });
    await writeEndContract(workDir, HASH_B, 'bundle');
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  function spaceWithPackages(
    packages: ReturnType<typeof createAttestedPackage>[],
    deserialize: (raw: unknown) => Contract = identityDeserialize,
  ) {
    return createAggregateContractSpace({
      spaceId: 'app',
      packages: packages.map((pkg) => ({ ...pkg, dirPath: packageDir })),
      refs: {},
      headRef: { hash: HASH_B, invariants: [] },
      refsDir,
      migrationsDir: workDir,
      resolveContract: () => createTestContract(),
      deserializeContract: deserialize,
    });
  }

  it('resolves via the ref pointer and its store entry when refName is supplied', async () => {
    await writeEndContract(workDir, HASH_A, 'ref');
    await writeRef(refsDir, 'staging', { hash: HASH_A, invariants: [] });

    const space = spaceWithPackages([
      createAttestedPackage('20260101T0000_init', { from: null, to: HASH_A }),
    ]);

    const result = await space.contractAt(HASH_A, { refName: 'staging' });

    expect(result.hash).toBe(HASH_A);
    expect(result.provenance).toBe('ref');
    expect((result.contractJson as { storage: { storageHash: string } }).storage.storageHash).toBe(
      HASH_A,
    );
  });

  it("returns the pointer's hash, not the hash argument, when they differ", async () => {
    await writeEndContract(workDir, HASH_A, 'ref');
    await writeRef(refsDir, 'staging', { hash: HASH_A, invariants: [] });

    const space = spaceWithPackages([
      createAttestedPackage('20260101T0000_init', { from: null, to: HASH_B }),
    ]);

    const result = await space.contractAt(HASH_B, { refName: 'staging' });

    expect(result.hash).toBe(HASH_A);
    expect(result.provenance).toBe('ref');
  });

  it('reads the destination contract from the matching graph-node package without refName', async () => {
    const space = spaceWithPackages([
      createAttestedPackage('20260101T0000_init', { from: null, to: HASH_B }),
    ]);

    const result = await space.contractAt(HASH_B);

    expect(result.hash).toBe(HASH_B);
    expect(result.provenance).toBe('graph-node');
    if (result.provenance !== 'graph-node') throw new Error('expected graph-node provenance');
    expect((result.contractJson as { storage: { storageHash: string } }).storage.storageHash).toBe(
      HASH_B,
    );
  });

  it('falls back to the graph-node bundle when the ref pointer is absent', async () => {
    const space = spaceWithPackages([
      createAttestedPackage('20260101T0000_init', { from: null, to: HASH_B }),
    ]);

    const result = await space.contractAt(HASH_B, { refName: 'staging' });

    expect(result.provenance).toBe('graph-node');
  });

  it('throws when the hash is a graph node but no bundle ends at that hash', async () => {
    const space = spaceWithPackages([
      createAttestedPackage('20260101T0000_second', { from: HASH_A, to: HASH_B }),
    ]);

    await expect(space.contractAt(HASH_A)).rejects.toMatchObject({
      code: 'MIGRATION.BUNDLE_NOT_FOUND_FOR_GRAPH_NODE',
    });
  });

  it('throws when the matching bundle is missing a store entry', async () => {
    await rm(contractSnapshotDir(workDir, HASH_B), { recursive: true, force: true });

    const space = spaceWithPackages([
      createAttestedPackage('20260101T0000_init', { from: null, to: HASH_B }),
    ]);

    await expect(space.contractAt(HASH_B)).rejects.toMatchObject({
      code: 'MIGRATION.CONTRACT_SNAPSHOT_MISSING',
      meta: { storageHash: HASH_B },
    });
  });

  it('throws contract snapshot missing when the ref pointer exists but the store entry is missing', async () => {
    await writeRef(refsDir, 'staging', { hash: HASH_A, invariants: [] });

    const space = spaceWithPackages([
      createAttestedPackage('20260101T0000_init', { from: null, to: HASH_B }),
    ]);

    await expect(space.contractAt(HASH_A, { refName: 'staging' })).rejects.toMatchObject({
      code: 'MIGRATION.CONTRACT_SNAPSHOT_MISSING',
      meta: { storageHash: HASH_A },
    });
  });

  it('throws when the store entry contract.json is invalid JSON', async () => {
    await writeFile(join(contractSnapshotDir(workDir, HASH_B), 'contract.json'), '{not json');

    const space = spaceWithPackages([
      createAttestedPackage('20260101T0000_init', { from: null, to: HASH_B }),
    ]);

    await expect(space.contractAt(HASH_B)).rejects.toMatchObject({
      code: 'MIGRATION.INVALID_JSON',
    });
  });

  it('throws when deserializeContract rejects the parsed destination contract', async () => {
    const space = spaceWithPackages(
      [createAttestedPackage('20260101T0000_init', { from: null, to: HASH_B })],
      () => {
        throw new Error('bad contract shape');
      },
    );

    await expect(space.contractAt(HASH_B)).rejects.toMatchObject({
      code: 'MIGRATION.CONTRACT_DESERIALIZATION_FAILED',
    });
  });

  it('throws ref not resolvable when refName is set and hash is not a graph node', async () => {
    const space = spaceWithPackages([
      createAttestedPackage('20260101T0000_init', { from: null, to: HASH_B }),
    ]);

    await expect(space.contractAt(HASH_A, { refName: 'staging' })).rejects.toMatchObject({
      code: 'MIGRATION.REF_NOT_RESOLVABLE',
      meta: { refName: 'staging' },
    });
  });

  it('throws hash not in graph when refName is omitted and hash is not a graph node', async () => {
    const space = spaceWithPackages([
      createAttestedPackage('20260101T0000_init', { from: null, to: HASH_B }),
    ]);

    await expect(space.contractAt(HASH_A)).rejects.toMatchObject({
      code: 'MIGRATION.HASH_NOT_IN_GRAPH',
      meta: { hash: HASH_A },
    });
  });

  it('memoises successful resolutions per hash and refName', async () => {
    const space = spaceWithPackages([
      createAttestedPackage('20260101T0000_init', { from: null, to: HASH_B }),
    ]);

    const first = await space.contractAt(HASH_B);
    const second = await space.contractAt(HASH_B);
    expect(second).toBe(first);
  });

  it('memoises ref and bundle resolutions under separate keys', async () => {
    await writeRef(refsDir, 'staging', { hash: HASH_B, invariants: [] });

    const space = spaceWithPackages([
      createAttestedPackage('20260101T0000_init', { from: null, to: HASH_B }),
    ]);

    const fromRef = await space.contractAt(HASH_B, { refName: 'staging' });
    const fromBundle = await space.contractAt(HASH_B);

    expect(fromRef).not.toBe(fromBundle);
    expect(fromRef.provenance).toBe('ref');
    expect(fromBundle.provenance).toBe('graph-node');
    expect(fromRef.contractJson).toEqual(fromBundle.contractJson);
  });
});
