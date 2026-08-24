import { mkdir, rm, writeFile } from 'node:fs/promises';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import {
  contractSnapshotDir,
  writeContractSnapshot,
} from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { ok } from '@internal/utils/result';
import { createTestCli } from '@prisma/cli-engine/testing';
import { join, relative } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlClient } from '../../src/control-api/types';
import { BIN_GROUPS, createBinCommands } from '../../src/orm/cli';
import { createTestProjectDir } from '../utils/test-project-dir';

/**
 * `migrate --to <node>` applies against the target bundle's destination
 * contract, resolved from the contract snapshot store keyed by the bundle's
 * `to` hash — not the emitted `contract.json`. That is what lets a rollback
 * or arbitrary-target migrate succeed without re-emitting the contract.
 * The control client is a double so the assertion is purely about which
 * contract `migrate` hands to `client.migrate`.
 */

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
    .mockResolvedValue(new Map([['app', { storageHash: C2, invariants: [] }]]));
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

function ormConfig(cwd: string): Record<string, unknown> {
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
  };
}

function harness(config: Record<string, unknown>) {
  return createTestCli({ commands, groups: BIN_GROUPS, config: { orm: config } });
}

function appliedContractHash(): string {
  const firstCall = mocks.migrate.mock.calls[0];
  expect(firstCall, 'migrate was invoked').toBeDefined();
  const arg = firstCall![0] as { contract: { storage: { storageHash: string } } };
  return arg.contract.storage.storageHash;
}

function errorOf(run: { readonly json: ReadonlyArray<{ readonly kind: string }> }) {
  const terminal = run.json.at(-1) as
    | {
        kind: string;
        envelope?: {
          ok: boolean;
          error?: { code: string; summary: string; why?: string; where?: { path?: string } };
        };
      }
    | undefined;
  return terminal?.envelope?.error;
}

describe('migrate --to resolves the apply contract', () => {
  it('applies the target bundle destination contract when --to names an older node', async () => {
    const cwd = await buildAppliedProject();

    const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--to', C1, '--json'], {
      cwd,
    });

    expect(run.exitCode).toBe(0);
    expect(appliedContractHash()).toBe(C1);
  });

  it('applies the emitted contract when --to is omitted', async () => {
    const cwd = await buildAppliedProject();

    const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--json'], { cwd });

    expect(run.exitCode).toBe(0);
    expect(appliedContractHash()).toBe(C2);
  });

  it('errors naming a corrupt target snapshot store entry', async () => {
    const cwd = await buildAppliedProject();
    const snapshotPath = join(contractSnapshotDir(join(cwd, 'migrations'), C1), 'contract.json');
    await writeFile(snapshotPath, '{ not json');
    const snapshotRelative = relative(cwd, snapshotPath);

    const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--to', C1, '--json'], {
      cwd,
    });
    const error = errorOf(run);

    expect(run.exitCode).not.toBe(0);
    expect(error?.code).toBe('CONTRACT.VALIDATION_FAILED');
    expect(error?.summary).toContain('Contract validation failed');
    expect(error?.where?.path).toContain(snapshotRelative);
    expect(error?.why).toContain(snapshotRelative);
    expect(mocks.migrate).not.toHaveBeenCalled();
  });

  it('errors with file-not-found when the top-level contract.json is absent', async () => {
    const cwd = await buildAppliedProject();
    await rm(join(cwd, 'contract.json'));

    const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--json'], { cwd });
    const error = errorOf(run);

    expect(run.exitCode).not.toBe(0);
    expect(error?.code).toBe('CLI.FILE_NOT_FOUND');
    expect(error?.summary).toContain('File not found');
    expect(error?.where?.path).toContain('contract.json');
    expect(mocks.migrate).not.toHaveBeenCalled();
  });

  it('errors with validation-failed when the top-level contract.json is unparseable', async () => {
    const cwd = await buildAppliedProject();
    await writeFile(join(cwd, 'contract.json'), '{ not json');

    const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--json'], { cwd });
    const error = errorOf(run);

    expect(run.exitCode).not.toBe(0);
    expect(error?.code).toBe('CONTRACT.VALIDATION_FAILED');
    expect(error?.where?.path).toContain('contract.json');
    expect(mocks.migrate).not.toHaveBeenCalled();
  });
});
