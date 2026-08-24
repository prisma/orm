import { mkdir, rm, writeFile } from 'node:fs/promises';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { writeContractSnapshot } from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { writeRef } from '@internal/migration-tools/refs';
import type { Block } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlClient } from '../../src/control-api/types';
import { BIN_GROUPS, createBinCommands } from '../../src/orm/cli';
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
const EXT_C1 = 'e'.repeat(64);
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
  mocks.readAllMarkers.mockReset().mockResolvedValue(new Map());
  mocks.migrate.mockReset();
});

async function writePkg(
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
async function buildProject(): Promise<string> {
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
async function addExtensionSpace(cwd: string): Promise<string> {
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

function pgvectorExtension(): Record<string, unknown> {
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
  return createTestCli({ commands, groups: BIN_GROUPS, config: { orm: config } });
}

/** Flattens a drawing block's span lines into plain strings. */
function drawingLines(blocks: readonly Block[]): readonly string[] {
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

describe('migrate --show', () => {
  it('shows nothing to run when the from-state is already the target', async () => {
    const cwd = await buildProject();

    const run = await harness(ormConfig(cwd)).run(
      ['db', 'migrate', '--show', '--from', C2.slice(7, 13), '--json'],
      { cwd },
    );

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({ ok: true, migrations: [] });
  });

  it('errors when no path leads from the from-state to the target', async () => {
    const cwd = await buildProject();

    const run = await harness(ormConfig(cwd)).run(
      ['db', 'migrate', '--show', '--from', C2.slice(7, 13), '--to', C1.slice(7, 13), '--json'],
      { cwd },
    );

    expect(run.exitCode).not.toBe(0);
    expect(run.json.at(-1)).toMatchObject({ kind: 'result', envelope: { ok: false } });
  });

  it('requires a connection when --from is omitted and the live marker must be read', async () => {
    const cwd = await buildProject();

    const run = await harness(ormConfig(cwd, { db: undefined })).run(
      ['db', 'migrate', '--show', '--json'],
      { cwd },
    );

    expect(run.exitCode).not.toBe(0);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'CONFIG.DB_CONNECTION_REQUIRED' } },
    });
  });

  it('errors structurally for --from @db without a connection', async () => {
    const cwd = await buildProject();

    const run = await harness(ormConfig(cwd, { db: undefined })).run(
      ['db', 'migrate', '--show', '--from', '@db', '--json'],
      { cwd },
    );

    expect(run.exitCode).not.toBe(0);
    const terminal = run.json.at(-1) as
      | { kind: string; envelope?: { ok: boolean; error?: { code: string } } }
      | undefined;
    expect(terminal?.envelope?.error?.code).toMatch(/^[A-Z]+\.[A-Z_]+$/);
  });

  it('previews a ref target whose invariants ride the ref, not the contract head', async () => {
    const cwd = await buildProject();
    await writeRef(join(cwd, 'migrations', 'app', 'refs'), 'prod', {
      hash: C2,
      invariants: ['inv-a'],
    });
    const appDir = join(cwd, 'migrations', 'app');
    await rm(join(appDir, `20260101_100000_${C1.slice(7, 13)}`), { recursive: true });
    await writePkg(appDir, {
      from: EMPTY,
      to: C1,
      providedInvariants: ['inv-a'],
      createdAt: '2026-01-01T10:00:00.000Z',
    });

    const run = await harness(ormConfig(cwd)).run(
      ['db', 'migrate', '--show', '--from', EMPTY, '--to', 'prod', '--json'],
      { cwd },
    );

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({
      ok: true,
      migrations: [
        expect.objectContaining({ from: EMPTY, to: C1 }),
        expect.objectContaining({ from: C1, to: C2 }),
      ],
    });
  });

  describe('the @contract marker', () => {
    it('marks the working contract, not the --to target', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(
        ['db', 'migrate', '--show', '--from', EMPTY, '--to', C1.slice(7, 13)],
        { cwd, isTty: { stdout: true } },
      );
      const lines = drawingLines(run.presented?.presentation.human ?? []);
      const contractLines = lines.filter((line) => line.includes('@contract'));

      expect(run.exitCode).toBe(0);
      expect(contractLines).toHaveLength(1);
      expect(contractLines[0]).toContain(C2.slice(7, 13));
      expect(contractLines[0]).not.toContain(C1.slice(7, 13));
    });

    it('never appears in extension spaces', async () => {
      const cwd = await buildProject();
      await addExtensionSpace(cwd);

      const run = await harness(ormConfig(cwd, { extensions: [pgvectorExtension()] })).run(
        ['db', 'migrate', '--show', '--from', EMPTY],
        { cwd, isTty: { stdout: true } },
      );
      const lines = drawingLines(run.presented?.presentation.human ?? []);

      expect(run.exitCode).toBe(0);
      const contractLines = lines.filter((line) => line.includes('@contract'));
      expect(contractLines).toHaveLength(1);
      expect(contractLines[0]).not.toContain(EXT_C1.slice(7, 13));
    });
  });

  describe('extension spaces', () => {
    it('plans extensions from their own state, never from the app --from hash', async () => {
      const cwd = await buildProject();
      const extDirName = await addExtensionSpace(cwd);

      const run = await harness(ormConfig(cwd, { extensions: [pgvectorExtension()] })).run(
        ['db', 'migrate', '--show', '--from', C1.slice(7, 13), '--to', C2.slice(7, 13), '--json'],
        { cwd },
      );
      const document = run.presented?.data as {
        migrations: ReadonlyArray<{ spaceId: string; dirName: string; from: string }>;
      };

      expect(run.exitCode).toBe(0);
      expect(document.migrations).toContainEqual(
        expect.objectContaining({ spaceId: 'pgvector', dirName: extDirName, from: EMPTY }),
      );
      expect(document.migrations).not.toContainEqual(
        expect.objectContaining({ spaceId: 'app', from: EMPTY }),
      );
    });

    it('orders extension migrations before app migrations, matching the runner', async () => {
      const cwd = await buildProject();
      await addExtensionSpace(cwd);

      const run = await harness(ormConfig(cwd, { extensions: [pgvectorExtension()] })).run(
        ['db', 'migrate', '--show', '--from', EMPTY, '--json'],
        { cwd },
      );
      const document = run.presented?.data as {
        migrations: ReadonlyArray<{ spaceId: string }>;
      };

      expect(run.exitCode).toBe(0);
      expect(document.migrations.map((migration) => migration.spaceId)).toEqual([
        'pgvector',
        'app',
        'app',
      ]);
    });
  });
});
