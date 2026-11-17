import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { PrismaConfig } from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appContractStandInFromIdentity,
  buildReadAggregate,
} from '../../src/control-api/operations/contract-space-aggregate-loader';

const TARGET = 'postgres';
const TARGET_FAMILY = 'sql';
const CONTRACT_HASH = `${'b'.repeat(64)}`;
const HEAD_HASH = `${'a'.repeat(64)}`;

const ADDITIVE_OPS: readonly MigrationPlanOperation[] = [
  { id: 'table.users', label: 'Create users', operationClass: 'additive' },
];

function makeConfig(contractOutput: string): PrismaConfig {
  return {
    family: {
      familyId: TARGET_FAMILY,
      create: vi.fn().mockReturnValue({
        deserializeContract: (json: unknown) => json as Contract,
      }),
    },
    target: {
      id: TARGET,
      familyId: TARGET_FAMILY,
      targetId: TARGET,
      kind: 'target',
      migrations: {},
    },
    adapter: { kind: 'adapter', familyId: TARGET_FAMILY, targetId: TARGET },
    contract: { output: contractOutput },
  } as unknown as PrismaConfig;
}

async function writeContractFile(path: string, storageHash: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({
      storage: { storageHash },
      schemaVersion: '1.0.0',
      target: TARGET,
      targetFamily: TARGET_FAMILY,
    }),
  );
}

async function writeAppMigration(migrationsDir: string): Promise<void> {
  const appDir = join(migrationsDir, 'app', '20260101T0000_init');
  const metadataBase: Omit<MigrationMetadata, 'migrationHash'> = {
    from: HEAD_HASH,
    to: CONTRACT_HASH,
    providedInvariants: [],
    createdAt: '2026-02-25T14:30:00.000Z',
  };
  const metadata: MigrationMetadata = {
    ...metadataBase,
    migrationHash: computeMigrationHash(metadataBase, ADDITIVE_OPS),
  };
  await writeMigrationPackage(appDir, metadata, ADDITIVE_OPS);
}

describe('buildReadAggregate', () => {
  let projectDir: string;
  let migrationsDir: string;
  let contractPath: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'build-read-aggregate-'));
    migrationsDir = join(projectDir, 'migrations');
    contractPath = join(projectDir, 'contract.json');
    await mkdir(join(migrationsDir, 'app'), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns contractHash from a readable contract and loads the app graph', async () => {
    await writeContractFile(contractPath, CONTRACT_HASH);
    await writeAppMigration(migrationsDir);

    const result = await buildReadAggregate(makeConfig(contractPath), { migrationsDir });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contractHash).toBe(CONTRACT_HASH);
    expect(result.value.aggregate.app.graph().migrationByHash.size).toBe(1);
    expect(result.value.aggregate.app.contract().storage.storageHash).toBe(CONTRACT_HASH);
  });

  it('falls back to the identity-only stand-in contract when contract.json is missing', async () => {
    await writeAppMigration(migrationsDir);

    const result = await buildReadAggregate(makeConfig(contractPath), { migrationsDir });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contractHash).toBe(EMPTY_CONTRACT_HASH);
    const standIn = appContractStandInFromIdentity({
      contractHash: EMPTY_CONTRACT_HASH,
      targetId: TARGET,
      targetFamily: TARGET_FAMILY,
    });
    expect(result.value.aggregate.app.contract().storage.storageHash).toBe(
      standIn.storage.storageHash,
    );
    expect(result.value.aggregate.app.graph().migrationByHash.size).toBe(1);
  });
});
