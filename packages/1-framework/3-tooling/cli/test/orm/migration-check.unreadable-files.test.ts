import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { ContractValidationError } from '@internal/contract/contract-validation-error';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  contractSnapshotDir,
  writeContractSnapshot,
} from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { writeRef } from '@internal/migration-tools/refs';
import { blindCast } from '@internal/utils/casts';
import { APP_UPGRADE_GUIDES_URL } from '@internal/utils/upgrade-guides';
import { createSqlContract } from '@repo/test-utils';
import { join, relative } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import type { MigrationCheckResult } from '../../src/commands/json/schemas';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import { createTestProjectDir } from '../utils/test-project-dir';

const HASH_A = `4cb4256${'0'.repeat(57)}`;
const HASH_B = `5db5367${'2'.repeat(57)}`;

const dirs: string[] = [];

async function projectDir(): Promise<string> {
  const dir = createTestProjectDir('orm-check');
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

const ADDITIVE_OP = blindCast<
  MigrationPlanOperation,
  'The integrity checks read only the operation list length and the metadata hashes'
>({ id: 'schema.add_column', label: 'Add column', operationClass: 'additive' });

const TEST_CONTRACT = createSqlContract({
  target: 'postgres',
  storage: {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        entries: { table: { user: { columns: { id: {} } } } },
      },
    },
  },
});

function ormConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '1.0.0',
      emission: {},
      create: () => ({}),
    },
    target: {
      kind: 'target',
      id: 'postgres',
      familyId: 'sql',
      targetId: 'postgres',
      version: '1.0.0',
      create: () => ({}),
    },
    adapter: {
      kind: 'adapter',
      id: 'pg',
      familyId: 'sql',
      targetId: 'postgres',
      version: '1.0.0',
      create: () => ({}),
    },
    contract: {
      source: { format: 'typescript', inputs: [], load: async () => TEST_CONTRACT },
      output: 'output/contract.json',
    },
    ...overrides,
  };
}

async function seedMigration(
  migrationsDir: string,
  options: {
    readonly dirName?: string;
    readonly from?: string | null;
    readonly to?: string;
  } = {},
): Promise<string> {
  const dirName = options.dirName ?? '20250101T0000_initial';
  const packageDir = join(migrationsDir, 'app', dirName);
  const ops = [ADDITIVE_OP];
  const base = blindCast<
    Omit<MigrationMetadata, 'migrationHash'>,
    'The integrity checks read from/to, createdAt and providedInvariants'
  >({
    from: options.from ?? null,
    to: options.to ?? HASH_A,
    providedInvariants: [],
    createdAt: '2025-01-01T00:00:00.000Z',
  });
  const metadata: MigrationMetadata = { ...base, migrationHash: computeMigrationHash(base, ops) };
  await writeMigrationPackage(packageDir, metadata, ops);
  return packageDir;
}

function harness(config: Record<string, unknown>) {
  return createOrmTestCli({ commands: BIN_COMMANDS, groups: BIN_GROUPS, orm: config });
}

/** A family whose contract reader refuses a contract holding the key `zzz`, as the strict reader does. */
function strictFamilyConfig(): Record<string, unknown> {
  return ormConfig({
    family: {
      ...(ormConfig()['family'] as Record<string, unknown>),
      create: () => ({
        deserializeContract: (json: unknown) => {
          if (json !== null && typeof json === 'object' && 'zzz' in json) {
            throw new ContractValidationError('zzz must be removed', 'structural');
          }
          return json;
        },
      }),
    },
  });
}

async function addUnknownKey(path: string): Promise<void> {
  const json = JSON.parse(await readFile(path, 'utf-8'));
  await writeFile(path, JSON.stringify({ ...json, zzz: 1 }), 'utf-8');
}

function failuresOf(run: { readonly presented?: { readonly data: unknown } | undefined }) {
  return blindCast<MigrationCheckResult, 'migration check presents its check document'>(
    run.presented?.data,
  ).failures;
}

describe('migration check on a file it cannot read', () => {
  it('reports the snapshot the head of the graph ends at when the family refuses it, with the refusal and the advice', async () => {
    const dir = await projectDir();
    const migrationsDir = join(dir, 'migrations');
    await seedMigration(migrationsDir);
    await writeContractSnapshot(migrationsDir, HASH_A, {
      contractJson: {
        formatVersion: 1,
        ...TEST_CONTRACT,
        storage: { ...TEST_CONTRACT.storage, storageHash: HASH_A },
      },
      contractDts: 'export type Contract = never;\n',
    });
    const snapshotPath = join(contractSnapshotDir(migrationsDir, HASH_A), 'contract.json');
    await addUnknownKey(snapshotPath);

    const run = await harness(strictFamilyConfig()).run(['migration', 'check', '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(4);
    expect(
      failuresOf(run).map(({ code, why, nextActions }) => ({ code, why, nextActions })),
    ).toEqual([
      {
        code: 'MIGRATION.CHECK_SNAPSHOT_UNPARSEABLE',
        why: `Migration "20250101T0000_initial" ends at the contract snapshot ${snapshotPath}, which this release of Prisma cannot read: zzz must be removed`,
        nextActions: [
          {
            kind: 'user-choice',
            label: 'If the file was edited by hand, restore it from version control',
          },
          {
            kind: 'open-url',
            label: 'If an earlier release wrote the snapshot, follow the app upgrade instructions',
            url: APP_UPGRADE_GUIDES_URL,
          },
        ],
      },
    ]);
  });

  async function seedSnapshots(migrationsDir: string, hashes: readonly string[]): Promise<void> {
    for (const hash of hashes) {
      await writeContractSnapshot(migrationsDir, hash, {
        contractJson: {
          formatVersion: 1,
          ...TEST_CONTRACT,
          storage: { ...TEST_CONTRACT.storage, storageHash: hash },
        },
        contractDts: 'export type Contract = never;\n',
      });
    }
  }

  it('reads strictly the snapshot a ref names, though another migration starts from it, and advises moving each ref but db', async () => {
    const dir = await projectDir();
    const migrationsDir = join(dir, 'migrations');
    await seedMigration(migrationsDir);
    await seedMigration(migrationsDir, { dirName: '20250102T0000_next', from: HASH_A, to: HASH_B });
    await seedSnapshots(migrationsDir, [HASH_A, HASH_B]);
    for (const name of ['db', 'production']) {
      await writeRef(join(migrationsDir, 'app', 'refs'), name, { hash: HASH_A, invariants: [] });
    }
    await addUnknownKey(join(contractSnapshotDir(migrationsDir, HASH_A), 'contract.json'));

    const run = await harness(strictFamilyConfig()).run(['migration', 'check', '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(4);
    expect(failuresOf(run).map(({ code, nextActions }) => ({ code, nextActions }))).toEqual([
      {
        code: 'MIGRATION.CHECK_SNAPSHOT_UNPARSEABLE',
        nextActions: [
          {
            kind: 'user-choice',
            label: 'If the file was edited by hand, restore it from version control',
          },
          expect.objectContaining({ kind: 'open-url' }),
          {
            kind: 'run-command',
            label: 'Or point the ref "production" at a migration whose snapshot this release reads',
            command: '{bin} migration ref set production <hash>',
          },
        ],
      },
    ]);
  });

  it('reads strictly the snapshot a ref names in a graph that has no last migration', async () => {
    const dir = await projectDir();
    const migrationsDir = join(dir, 'migrations');
    await seedMigration(migrationsDir);
    await seedMigration(migrationsDir, { dirName: '20250102T0000_next', from: HASH_A, to: HASH_B });
    await seedMigration(migrationsDir, { dirName: '20250103T0000_back', from: HASH_B, to: HASH_A });
    await seedSnapshots(migrationsDir, [HASH_A, HASH_B]);
    await writeRef(join(migrationsDir, 'app', 'refs'), 'production', {
      hash: HASH_B,
      invariants: [],
    });
    await addUnknownKey(join(contractSnapshotDir(migrationsDir, HASH_B), 'contract.json'));

    const run = await harness(strictFamilyConfig()).run(['migration', 'check', '--json'], {
      cwd: dir,
    });

    expect(failuresOf(run).map(({ code, where }) => ({ code, where }))).toEqual([
      {
        code: 'MIGRATION.CHECK_SNAPSHOT_UNPARSEABLE',
        where: 'migrations/app/20250102T0000_next',
      },
    ]);
  });

  it('checks only the hash of a snapshot that an already written migration ends at, which nothing plans from', async () => {
    const dir = await projectDir();
    const migrationsDir = join(dir, 'migrations');
    await seedMigration(migrationsDir);
    await seedMigration(migrationsDir, { dirName: '20250102T0000_next', from: HASH_A, to: HASH_B });
    for (const hash of [HASH_A, HASH_B]) {
      await writeContractSnapshot(migrationsDir, hash, {
        contractJson: {
          formatVersion: 1,
          ...TEST_CONTRACT,
          storage: { ...TEST_CONTRACT.storage, storageHash: hash },
        },
        contractDts: 'export type Contract = never;\n',
      });
    }
    await addUnknownKey(join(contractSnapshotDir(migrationsDir, HASH_A), 'contract.json'));

    const run = await harness(strictFamilyConfig()).run(['migration', 'check', '--json'], {
      cwd: dir,
    });

    expect({ exitCode: run.exitCode, failures: failuresOf(run) }).toEqual({
      exitCode: 0,
      failures: [],
    });
  });

  it('reports an unreadable migration.json with the command that rewrites it, and no finding that only follows from it', async () => {
    const dir = await projectDir();
    const migrationsDir = join(dir, 'migrations');
    const first = await seedMigration(migrationsDir);
    await seedMigration(migrationsDir, { dirName: '20250102T0000_next', from: HASH_A, to: HASH_B });
    await addUnknownKey(join(first, 'migration.json'));
    await mkdir(join(dir, 'output'), { recursive: true });
    await writeFile(
      join(dir, 'output', 'contract.json'),
      JSON.stringify({ formatVersion: 1, ...TEST_CONTRACT }),
      'utf-8',
    );

    const run = await harness(strictFamilyConfig()).run(['migration', 'check', '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(4);
    const failures = failuresOf(run);
    expect(failures.map(({ code, nextActions }) => ({ code, nextActions }))).toEqual([
      {
        code: 'MIGRATION.CHECK_PACKAGE_UNLOADABLE',
        nextActions: [
          { kind: 'user-choice', label: 'Restore the migration package from version control' },
          {
            kind: 'run-command',
            label: 'Or write migration.json and ops.json again from its migration.ts',
            command: `node "${relative(dir, join(first, 'migration.ts'))}"`,
          },
        ],
      },
    ]);
    expect(failures[0]?.why).toContain('zzz must be removed');
  });

  it.each([
    ['migration.json', ['MIGRATION.CHECK_FILE_MISSING']],
    ['ops.json', ['MIGRATION.CHECK_FILE_MISSING', 'MIGRATION.CHECK_PACKAGE_UNLOADABLE']],
  ])('reports a missing %s and no finding that only follows from it', async (fileName, codes) => {
    const dir = await projectDir();
    const migrationsDir = join(dir, 'migrations');
    const first = await seedMigration(migrationsDir);
    await seedMigration(migrationsDir, { dirName: '20250102T0000_next', from: HASH_A, to: HASH_B });
    await writeRef(join(migrationsDir, 'app', 'refs'), 'db', { hash: HASH_B, invariants: [] });
    await rm(join(first, fileName));

    const run = await harness(strictFamilyConfig()).run(['migration', 'check', '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(4);
    expect(failuresOf(run).map(({ code }) => code)).toEqual(codes);
  });

  it('reports an unreadable migration.json when no contract has been emitted yet', async () => {
    const dir = await projectDir();
    const migrationsDir = join(dir, 'migrations');
    const first = await seedMigration(migrationsDir);
    await addUnknownKey(join(first, 'migration.json'));

    const run = await harness(strictFamilyConfig()).run(['migration', 'check', '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(4);
    expect(failuresOf(run).map(({ code }) => code)).toEqual(['MIGRATION.CHECK_PACKAGE_UNLOADABLE']);
  });

  it('refuses a contract.json that is not JSON, naming it, instead of passing', async () => {
    const dir = await projectDir();
    await seedMigration(join(dir, 'migrations'));
    await mkdir(join(dir, 'output'), { recursive: true });
    await writeFile(join(dir, 'output', 'contract.json'), '{ not json', 'utf-8');

    const run = await harness(strictFamilyConfig()).run(['migration', 'check', '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: {
          code: 'CONTRACT.VALIDATION_FAILED',
          why: expect.stringContaining(join(dir, 'output', 'contract.json')),
        },
      },
    });
  });
});
