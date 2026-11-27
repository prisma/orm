import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { PrismaConfig } from '@internal/config/config-types';
import { readFormatVersion } from '@internal/contract/format-version';
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

async function writeContractFile(
  path: string,
  storageHash: string,
  version: Record<string, unknown> = { formatVersion: 1 },
): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({
      ...version,
      storage: { storageHash },
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

  it('reads a contract.json a release candidate wrote', async () => {
    await writeContractFile(contractPath, CONTRACT_HASH, { schemaVersion: '1' });
    await writeAppMigration(migrationsDir);

    const result = await buildReadAggregate(makeConfig(contractPath), { migrationsDir });

    expect(result.ok ? result.value.aggregate.app.contract().storage.storageHash : result).toBe(
      CONTRACT_HASH,
    );
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

  it.each([
    ['written by a newer release', { formatVersion: 2 }, 'CONTRACT.FORMAT_VERSION_NEWER'],
    ['with no version field', {}, 'CONTRACT.FORMAT_VERSION_MISSING'],
  ])(
    'reports a contract.json %s instead of falling back to the stand-in',
    async (_label, version, code) => {
      await writeContractFile(contractPath, CONTRACT_HASH, version);
      await writeAppMigration(migrationsDir);

      const result = await buildReadAggregate(makeConfig(contractPath), { migrationsDir });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure).toMatchObject({ code, where: { path: contractPath } });
    },
  );

  it('reports a format version error the family raises while reading contract.json', async () => {
    await writeContractFile(contractPath, CONTRACT_HASH);
    await writeAppMigration(migrationsDir);
    const config = makeConfig(contractPath);
    vi.mocked(config.family.create).mockReturnValue({
      deserializeContract: () =>
        readFormatVersion({ formatVersion: 2 }, { kind: 'contract', knownVersions: [1] }),
    } as unknown as ReturnType<PrismaConfig['family']['create']>);

    const result = await buildReadAggregate(config, { migrationsDir });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({
      code: 'CONTRACT.FORMAT_VERSION_NEWER',
      where: { path: contractPath },
    });
  });

  describe('a ref file that exists but is refused', () => {
    async function writeRefFile(path: string, content: Record<string, unknown>): Promise<void> {
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, JSON.stringify(content));
    }

    it.each([
      ['an app ref', join('app', 'refs', 'db.json')],
      ['an extension head ref', join('pgvector', 'refs', 'head.json')],
    ])('reports %s with a field the format does not know, naming the file', async (_, rel) => {
      await writeContractFile(contractPath, CONTRACT_HASH);
      await writeAppMigration(migrationsDir);
      const refPath = join(migrationsDir, rel);
      await writeRefFile(refPath, {
        formatVersion: 1,
        hash: CONTRACT_HASH,
        invariants: [],
        note: 'x',
      });

      const result = await buildReadAggregate(makeConfig(contractPath), { migrationsDir });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure).toMatchObject({
        code: 'MIGRATION.INVALID_REF_FILE',
        meta: { path: refPath },
      });
    });

    it('loads with the refused ref left out when the caller reports every problem itself', async () => {
      await writeContractFile(contractPath, CONTRACT_HASH);
      await writeAppMigration(migrationsDir);
      await writeRefFile(join(migrationsDir, 'app', 'refs', 'db.json'), {
        formatVersion: 1,
        hash: CONTRACT_HASH,
        invariants: [],
        note: 'x',
      });

      const result = await buildReadAggregate(makeConfig(contractPath), {
        migrationsDir,
        tolerateUnreadableRefs: true,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.aggregate.app.refs).toEqual({});
    });
  });
});
