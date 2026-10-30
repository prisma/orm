import { mkdir, rm, writeFile } from 'node:fs/promises';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { writeContractSnapshot } from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { writeRef } from '@internal/migration-tools/refs';
import { ok } from '@internal/utils/result';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlClient } from '../../src/control-api/types';
import { BIN_GROUPS, createBinCommands } from '../../src/orm/cli';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import { createTestProjectDir } from '../utils/test-project-dir';

const mocks = {
  connect: vi.fn(),
  readAllMarkers: vi.fn(),
  migrate: vi.fn(),
  close: vi.fn(),
};

const commands = createBinCommands(
  () =>
    ({
      connect: mocks.connect,
      readAllMarkers: mocks.readAllMarkers,
      migrate: mocks.migrate,
      close: mocks.close,
    }) as unknown as ControlClient,
);

const EMPTY = 'empty';
const C1 = '1'.repeat(64);
const C2 = '2'.repeat(64);
const TARGET = 'mock';
const FAMILY = 'mock';

const OPS: readonly MigrationPlanOperation[] = [
  { id: 'table.users', label: 'Create table users', operationClass: 'additive' },
];

function contractEnvelope(storageHash: string): Record<string, unknown> {
  return {
    storage: { storageHash, namespaces: {} },
    schemaVersion: '1.0.0',
    target: TARGET,
    targetFamily: FAMILY,
  };
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

beforeEach(() => {
  mocks.connect.mockReset().mockResolvedValue(undefined);
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.readAllMarkers
    .mockReset()
    .mockResolvedValue(new Map([['app', { storageHash: C2, invariants: [], meta: {} }]]));
  mocks.migrate
    .mockReset()
    .mockResolvedValue(
      ok({ migrationsApplied: 1, markerHash: C1, applied: [], summary: 'applied', perSpace: [] }),
    );
});

async function writeBundle(
  migrationsDir: string,
  dir: string,
  base: Omit<MigrationMetadata, 'migrationHash'>,
  endContractHash: string,
): Promise<void> {
  const metadata: MigrationMetadata = {
    ...base,
    migrationHash: computeMigrationHash(base, [...OPS]),
  };
  await writeMigrationPackage(dir, metadata, [...OPS]);
  await writeContractSnapshot(migrationsDir, endContractHash, {
    contractJson: contractEnvelope(endContractHash),
    contractDts: 'export type Contract = unknown;\n',
  });
}

/** Applied state empty → C1 → C2 with the emitted contract and marker at C2. */
async function buildAppliedProject(): Promise<string> {
  const cwd = createTestProjectDir('orm-migrate-to');
  tempDirs.push(cwd);
  const migrationsDir = join(cwd, 'migrations');
  const appDir = join(migrationsDir, 'app');
  await mkdir(join(appDir, 'refs'), { recursive: true });
  await writeBundle(
    migrationsDir,
    join(appDir, '00001_init'),
    { from: EMPTY, to: C1, providedInvariants: [], createdAt: '2026-02-25T14:00:00.000Z' },
    C1,
  );
  await writeBundle(
    migrationsDir,
    join(appDir, '00002_add_phone'),
    { from: C1, to: C2, providedInvariants: [], createdAt: '2026-02-25T14:01:00.000Z' },
    C2,
  );
  await writeFile(join(cwd, 'contract.json'), JSON.stringify(contractEnvelope(C2)));
  return cwd;
}

function ormConfig(cwd: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    family: {
      kind: 'family',
      id: FAMILY,
      familyId: FAMILY,
      version: '1.0.0',
      emission: {},
      create: () => ({ deserializeContract: (json: unknown) => json }),
    },
    target: {
      kind: 'target',
      id: TARGET,
      familyId: FAMILY,
      targetId: TARGET,
      version: '1.0.0',
      create: () => ({}),
      migrations: {},
    },
    adapter: {
      kind: 'adapter',
      id: 'mock',
      familyId: FAMILY,
      targetId: TARGET,
      version: '1.0.0',
      create: () => ({}),
    },
    driver: {
      kind: 'driver',
      id: 'mock',
      familyId: FAMILY,
      targetId: TARGET,
      version: '1.0.0',
      create: () => ({}),
    },
    db: { connection: 'postgres://user:secret@localhost:5432/appdb' },
    contract: {
      source: { format: 'typescript', inputs: [], load: async () => ({}) },
      output: join(cwd, 'contract.json'),
    },
    migrations: { dir: 'migrations' },
    ...overrides,
  };
}

function harness(config: Record<string, unknown>) {
  return createOrmTestCli({ commands, groups: BIN_GROUPS, orm: config });
}

const PRODUCTION_POLICIES = { change: ['migrate'] } as const;

async function projectWithProductionRef(): Promise<string> {
  const cwd = await buildAppliedProject();
  await writeRef(join(cwd, 'migrations', 'app', 'refs'), 'production', {
    hash: C2,
    invariants: [],
    policies: PRODUCTION_POLICIES,
  });
  return cwd;
}

describe('db migrate --permit-policy-change', () => {
  it('leaves the policy check to the control client, handing it the ref without consent', async () => {
    const cwd = await projectWithProductionRef();

    await harness(ormConfig(cwd)).run(['db', 'migrate', '--to', 'production', '--json'], { cwd });

    expect(mocks.migrate).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: { name: 'production', hash: C2, invariants: [], policies: PRODUCTION_POLICIES },
      }),
    );
    expect(mocks.migrate.mock.calls[0]?.[0]).not.toHaveProperty('permitPolicyChange');
  });

  it('hands the client the ref and the consent, and reports the policies it updated', async () => {
    const cwd = await projectWithProductionRef();
    const databasePoliciesUpdated = [
      { setting: 'change', declared: ['migrate'], inForce: ['migrate', 'reconcile'] },
    ];
    mocks.migrate.mockResolvedValue(
      ok({
        migrationsApplied: 0,
        markerHash: C2,
        applied: [],
        summary: 'Policies updated: change: migrate',
        perSpace: [],
        databasePoliciesUpdated,
      }),
    );

    const run = await harness(ormConfig(cwd)).run(
      ['db', 'migrate', '--to', 'production', '--permit-policy-change', '--json'],
      { cwd },
    );

    expect(run.exitCode).toBe(0);
    expect(mocks.migrate).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: { name: 'production', hash: C2, invariants: [], policies: PRODUCTION_POLICIES },
        permitPolicyChange: true,
        invocation: expect.objectContaining({
          rerunArgs: ['--to', 'production', '--permit-policy-change'],
        }),
      }),
    );
    expect(run.presented?.data).toMatchObject({
      summary: 'Policies updated: change: migrate',
      databasePoliciesUpdated,
    });
  });

  it('gives no consent when the flag is absent', async () => {
    const cwd = await buildAppliedProject();

    await harness(ormConfig(cwd)).run(['db', 'migrate', '--json'], { cwd });

    expect(mocks.migrate.mock.calls[0]?.[0]).not.toHaveProperty('permitPolicyChange');
    expect(mocks.migrate.mock.calls[0]?.[0].invocation.rerunArgs).toEqual([]);
  });
});
