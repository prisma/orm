import { mkdir, rm, writeFile } from 'node:fs/promises';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { writeContractSnapshot } from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { formatMigrationDirName, writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { ok } from '@internal/utils/result';
import { createTestCli } from '@prisma/cli-engine/testing';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlClient } from '../../src/control-api/types';
import { BIN_GROUPS, createBinCommands } from '../../src/orm/cli';
import { createTestProjectDir, writeProjectManifest } from '../utils/test-project-dir';

/**
 * `db update --to <bundle>` resolves the destination contract through the
 * on-disk aggregate: the migration package names the `to` hash, and the
 * contract handed to the control client comes from the snapshot store entry
 * for that hash — not the emitted contract.json.
 */

const mocks = {
  connect: vi.fn(),
  dbUpdate: vi.fn(),
  renderContractDts: vi.fn(),
  close: vi.fn(),
};

const commands = createBinCommands(
  () =>
    ({
      connect: mocks.connect,
      dbUpdate: mocks.dbUpdate,
      renderContractDts: mocks.renderContractDts,
      close: mocks.close,
    }) as unknown as ControlClient,
);

const HASH_A = `${'a'.repeat(64)}`;
const HASH_B = `${'b'.repeat(64)}`;
const ADDITIVE_OP: MigrationPlanOperation = {
  id: 'table.users',
  label: 'Create users',
  operationClass: 'additive',
};

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

beforeEach(() => {
  mocks.connect.mockReset().mockResolvedValue(undefined);
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.dbUpdate.mockReset();
  mocks.renderContractDts
    .mockReset()
    .mockResolvedValue(ok({ contractDts: 'export type Contract = unknown;\n' }));
});

interface Fixture {
  readonly cwd: string;
  readonly dirNext: string;
  readonly endContract: Record<string, unknown>;
}

async function setupFixture(): Promise<Fixture> {
  const cwd = createTestProjectDir('orm-db-update-to');
  tempDirs.push(cwd);
  writeProjectManifest(cwd);
  const endContract = {
    storage: { storageHash: HASH_B },
    schemaVersion: '1.0.0',
    target: 'postgres',
    targetFamily: 'sql',
  };
  await writeFile(
    join(cwd, 'contract.json'),
    JSON.stringify({
      storage: { storageHash: HASH_A },
      schemaVersion: '1.0.0',
      target: 'postgres',
      targetFamily: 'sql',
    }),
  );
  const appDir = join(cwd, 'migrations', 'app');
  await mkdir(appDir, { recursive: true });
  const dirInit = formatMigrationDirName(new Date('2026-01-01T10:00:00Z'), 'init');
  const dirNext = formatMigrationDirName(new Date('2026-01-02T10:00:00Z'), 'add_users');
  for (const [dirName, from, to] of [
    [dirInit, null, HASH_A] as const,
    [dirNext, HASH_A, HASH_B] as const,
  ]) {
    const metadataBase: Omit<MigrationMetadata, 'migrationHash'> = {
      from,
      to,
      providedInvariants: [],
      createdAt: '2026-01-01T10:00:00.000Z',
    };
    const metadata: MigrationMetadata = {
      ...metadataBase,
      migrationHash: computeMigrationHash(metadataBase, [ADDITIVE_OP]),
    };
    await writeMigrationPackage(join(appDir, dirName), metadata, [ADDITIVE_OP]);
  }
  await writeContractSnapshot(join(cwd, 'migrations'), HASH_B, {
    contractJson: endContract,
    contractDts: 'export type Contract = unknown;\n',
  });
  return { cwd, dirNext, endContract };
}

const DESCRIPTOR = { familyId: 'sql', targetId: 'postgres', version: '1.0.0', create: () => ({}) };

function ormConfig(cwd: string): Record<string, unknown> {
  return {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '1.0.0',
      emission: {},
      create: () => ({ deserializeContract: (json: unknown) => json }),
    },
    target: { ...DESCRIPTOR, kind: 'target', id: 'postgres', migrations: {} },
    adapter: { ...DESCRIPTOR, kind: 'adapter', id: 'pg' },
    driver: { ...DESCRIPTOR, kind: 'driver', id: 'pg-driver' },
    db: { connection: 'postgres://user:secret@localhost:5432/appdb' },
    contract: {
      source: { format: 'typescript', inputs: [], load: async () => ({}) },
      output: join(cwd, 'contract.json'),
    },
  };
}

function harness(cwd: string) {
  return createTestCli({ commands, groups: BIN_GROUPS, config: { orm: ormConfig(cwd) } });
}

describe('db update --to bundle resolution', () => {
  it('errors on an invalid --advance-ref name with the structured ref envelope', async () => {
    const { cwd, dirNext } = await setupFixture();
    mocks.dbUpdate.mockResolvedValue(
      ok({
        ok: true,
        mode: 'apply',
        destination: { storageHash: HASH_B },
        summary: 'Applied',
      }),
    );

    const run = await harness(cwd).run(
      ['db', 'update', '--to', dirNext, '--advance-ref', 'BAD NAME', '--json'],
      { cwd },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: {
          code: 'MIGRATION.INVALID_REF_NAME',
          summary: 'Invalid ref name',
          why: expect.stringContaining('"BAD NAME" is invalid'),
          meta: { refName: 'BAD NAME' },
        },
      },
    });
  });

  it('hands the snapshot-store contract for the bundle destination to the client on --dry-run', async () => {
    const { cwd, dirNext, endContract } = await setupFixture();
    mocks.dbUpdate.mockResolvedValue(
      ok({
        ok: true,
        mode: 'plan',
        plan: {
          operations: [{ id: 'table.users', label: 'Create users', operationClass: 'additive' }],
          preview: undefined,
        },
        destination: { storageHash: HASH_B },
        summary: 'Plan ready',
      }),
    );

    const run = await harness(cwd).run(['db', 'update', '--to', dirNext, '--dry-run', '--json'], {
      cwd,
    });

    expect(run.exitCode).toBe(0);
    const callContract = mocks.dbUpdate.mock.calls[0]![0].contract as Record<string, unknown>;
    expect(callContract).toEqual(endContract);
    expect(mocks.renderContractDts).toHaveBeenCalledWith(
      expect.objectContaining({ contract: endContract }),
    );
    expect(run.presented?.data).toEqual({
      ok: true,
      mode: 'plan',
      plan: {
        targetId: 'postgres',
        destination: { storageHash: HASH_B },
        operations: [{ id: 'table.users', label: 'Create users', operationClass: 'additive' }],
      },
      advancedRef: null,
      plannedAdvanceRef: { name: 'db', hash: HASH_B },
      summary: 'Plan ready',
      timings: { total: expect.any(Number) },
    });
  });
});
