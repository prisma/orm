import { mkdir, rm, writeFile } from 'node:fs/promises';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { writeContractSnapshot } from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { writeRef } from '@internal/migration-tools/refs';
import type { Block } from '@prisma/cli-engine';
import { join } from 'pathe';
import { type Mock, vi } from 'vitest';
import type { ControlClient } from '../../../src/control-api/types';
import { BIN_GROUPS, createBinCommands } from '../../../src/orm/cli';
import { createOrmTestCli } from '../../helpers/orm-test-cli';
import { createTestProjectDir } from '../../utils/test-project-dir';

/** The control-client double every `db migrate --show` test runs against. */
export const mocks: Readonly<Record<'connect' | 'readAllMarkers' | 'migrate' | 'close', Mock>> = {
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

export const EMPTY = 'empty';
export const C1 = '1'.repeat(64);
export const C2 = '2'.repeat(64);
export const EXT_C1 = 'e'.repeat(64);
export const UNKNOWN = 'd'.repeat(64);
const TARGET = 'mock';
const FAMILY = 'mock';

const OPS: readonly MigrationPlanOperation[] = [
  { id: 'table.users', label: 'Create table users', operationClass: 'additive' },
];

export function contractEnvelope(storageHash: string): Record<string, unknown> {
  return {
    storage: { storageHash, namespaces: {} },
    schemaVersion: '1.0.0',
    target: TARGET,
    targetFamily: FAMILY,
  };
}

const tempDirs: string[] = [];

export async function removeMigrateShowProjects(): Promise<void> {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

export function resetMigrateShowMocks(): void {
  mocks.connect.mockReset().mockResolvedValue(undefined);
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.readAllMarkers.mockReset().mockResolvedValue(new Map());
  mocks.migrate.mockReset();
}

export async function writePkg(
  dir: string,
  base: Omit<MigrationMetadata, 'migrationHash'>,
): Promise<string> {
  const dirName = `20260101_100000_${base.to.slice(7, 13)}`;
  const metadata: MigrationMetadata = {
    ...base,
    migrationHash: computeMigrationHash(base, [...OPS]),
  };
  await writeMigrationPackage(join(dir, dirName), metadata, [...OPS]);
  return dirName;
}

/** A linear app history: empty → C1 → C2, with the emitted contract at C2. */
export async function buildProject(): Promise<string> {
  const cwd = createTestProjectDir('orm-migrate-show');
  tempDirs.push(cwd);
  const appDir = join(cwd, 'migrations', 'app');
  await mkdir(appDir, { recursive: true });
  await writePkg(appDir, {
    from: EMPTY,
    to: C1,
    providedInvariants: [],
    createdAt: '2026-01-01T10:00:00.000Z',
  });
  await writePkg(appDir, {
    from: C1,
    to: C2,
    providedInvariants: [],
    createdAt: '2026-01-01T10:01:00.000Z',
  });
  await writeFile(join(cwd, 'contract.json'), JSON.stringify(contractEnvelope(C2)));
  return cwd;
}

/** Adds a declared pgvector space with its own empty → EXT_C1 graph. */
export async function addExtensionSpace(cwd: string): Promise<string> {
  const extDir = join(cwd, 'migrations', 'pgvector');
  const dirName = await writePkg(extDir, {
    from: EMPTY,
    to: EXT_C1,
    providedInvariants: [],
    createdAt: '2026-01-01T09:00:00.000Z',
  });
  await writeRef(join(extDir, 'refs'), 'head', { hash: EXT_C1, invariants: [] });
  await writeContractSnapshot(join(cwd, 'migrations'), EXT_C1, {
    contractJson: contractEnvelope(EXT_C1),
    contractDts: 'export type Contract = unknown;\n',
  });
  return dirName;
}

export function pgvectorExtension(): Record<string, unknown> {
  return {
    kind: 'extension',
    id: 'pgvector',
    familyId: FAMILY,
    targetId: TARGET,
    version: '1.0.0',
    create: () => ({}),
    contractSpace: {
      contractJson: contractEnvelope(EXT_C1),
      headRef: { hash: EXT_C1, invariants: [] },
      migrations: [],
    },
  };
}

export function ormConfig(
  cwd: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
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

export function harness(config: Record<string, unknown>) {
  return createOrmTestCli({ commands, groups: BIN_GROUPS, orm: config });
}

/** Flattens a drawing block's span lines into plain strings. */
export function drawingLines(blocks: readonly Block[]): readonly string[] {
  return blocks
    .filter((block) => block.kind === 'drawing')
    .flatMap((block) =>
      block.lines.map((line) =>
        typeof line === 'string'
          ? line
          : line.map((span) => (typeof span === 'string' ? span : span.text)).join(''),
      ),
    );
}
